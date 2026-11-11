// Envio de e-mail por SMTP (Brevo, porta 587 com STARTTLS), sem dependências.
// Usa as mesmas variáveis do zacda-app: BREVO_SMTP_USER e BREVO_SMTP_PASS (segredos; host e porta têm padrão).
// Sem credenciais, não envia e só registra um aviso: o painel nunca falha por causa de e-mail.
import net from 'node:net';
import tls from 'node:tls';

const HOST = () => process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com';
const PORT = () => +(process.env.BREVO_SMTP_PORT || 587);
export const emailConfigurado = () => !!(process.env.BREVO_SMTP_USER && process.env.BREVO_SMTP_PASS);

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const assunto = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const limpa = (s) => String(s).replace(/[\r\n]+/g, ' ').trim(); // evita injeção de cabeçalho

/** Lê respostas SMTP (inclusive de várias linhas) de um socket. */
function leitor(socket) {
  let buf = '';
  const espera = [];
  const tenta = () => {
    while (espera.length) {
      const linhas = buf.split('\r\n');
      const fim = linhas.findIndex((l) => /^\d{3} /.test(l));
      if (fim < 0) return;
      const resp = linhas.slice(0, fim + 1);
      buf = linhas.slice(fim + 1).join('\r\n');
      espera.shift().resolve({ codigo: +resp[fim].slice(0, 3), texto: resp.join('\n') });
    }
  };
  socket.on('data', (d) => { buf += d.toString('utf8'); tenta(); });
  socket.on('error', (e) => espera.splice(0).forEach((w) => w.reject(e)));
  socket.on('close', () => espera.splice(0).forEach((w) => w.reject(new Error('Conexão SMTP encerrada.'))));
  return () => new Promise((resolve, reject) => { espera.push({ resolve, reject }); tenta(); });
}

export async function enviaEmail({ para, de, assunto: subj, texto }) {
  if (!emailConfigurado()) { console.warn('E-mail não enviado: BREVO_SMTP_USER/BREVO_SMTP_PASS não definidos.'); return false; }
  const host = HOST();
  let socket = await new Promise((res, rej) => { const s = net.connect(PORT(), host, () => res(s)); s.once('error', rej); s.setTimeout(20000, () => s.destroy(new Error('Tempo esgotado no SMTP.'))); });
  let le = leitor(socket);
  const diz = async (linha, esperado) => {
    socket.write(`${linha}\r\n`);
    const r = await le();
    if (!esperado.includes(r.codigo)) throw new Error(`SMTP ${r.codigo} após "${linha.split(' ')[0]}"`);
    return r;
  };
  try {
    const ola = await le();
    if (ola.codigo !== 220) throw new Error(`SMTP recusou a conexão (${ola.codigo}).`);
    await diz('EHLO painel.brunocamilloadvogado.com.br', [250]);
    await diz('STARTTLS', [220]);
    socket.removeAllListeners('data');
    socket = tls.connect({ socket, servername: host });
    await new Promise((res, rej) => { socket.once('secureConnect', res); socket.once('error', rej); });
    le = leitor(socket);
    await diz('EHLO painel.brunocamilloadvogado.com.br', [250]);
    await diz('AUTH LOGIN', [334]);
    await diz(b64(process.env.BREVO_SMTP_USER), [334]);
    await diz(b64(process.env.BREVO_SMTP_PASS), [235]);
    const remetente = de || process.env.EMAIL_FROM || 'atendimento@zacda.com.br';
    await diz(`MAIL FROM:<${limpa(remetente)}>`, [250]);
    await diz(`RCPT TO:<${limpa(para)}>`, [250, 251]);
    await diz('DATA', [354]);
    const corpo = String(texto).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    const msg = [`From: Painel ZACDA <${limpa(remetente)}>`, `To: ${limpa(para)}`, `Subject: ${assunto(limpa(subj))}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', (b64(corpo).match(/.{1,76}/g) || []).join('\r\n')].join('\r\n');
    await diz(`${msg}\r\n.`, [250]);
    await diz('QUIT', [221]).catch(() => {});
    return true;
  } finally { socket.destroy(); }
}

/** Avisa a ZACDA que o escritório clicou em "Tenho interesse". Nunca lança erro. */
export async function avisaInteresse({ addon, quem, total, totalGeral }) {
  const para = process.env.ALERT_EMAIL_TO || 'andre.canterucio@zacda.com.br';
  try {
    const ok = await enviaEmail({
      para,
      assunto: `[Painel Bruno] Interesse: ${addon}`,
      texto: `${quem} marcou "Tenho interesse" em: ${addon}.\n\nCliques neste add-on: ${total}\nTotal de cliques em todos os add-ons: ${totalGeral}\nQuando: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n\nÉ um sinal de venda do piloto (nada é cobrado). Veja o contexto no painel, em Add-ons.`,
    });
    if (ok) console.log(`Aviso de interesse enviado (${addon}).`);
  } catch (e) { console.warn(`Aviso de interesse falhou: ${e.message}`); }
}
