// Lembretes de prazo: quem está vinculado ao caso (membros; sem membros, o responsável; sem ninguém, os admins) é avisado
// no painel (sino), por e-mail e por push, na antecedência escolhida em cada prazo. Roda a cada minuto no servidor.
// Horário sempre de Brasília (UTC-3, sem horário de verão desde 2019). O servidor roda em UTC.
import { all, get, run, now } from './db.mjs';
import { enviaEmail, emailConfigurado } from './email.mjs';
import { enviaPush } from './push.mjs';

export const ANTECEDENCIAS = [0, 15, 60, 1440, 2880]; // na hora, 15 min, 1 hora, 1 dia, 2 dias
const JANELA_APOS_MS = 6 * 3600e3; // depois de 6 h do vencimento, aviso atrasado não faz mais sentido
const PAINEL_URL = () => process.env.PAINEL_URL || 'https://brunocamilloadvogado.com.br/painel';

export const vencimentoMs = (data, hora) => Date.parse(`${data}T${/^\d{2}:\d{2}$/.test(hora || '') ? hora : '09:00'}:00-03:00`);
export const hojeBRT = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const fmtBR = (data, hora) => `${String(data).split('-').reverse().join('/')} às ${hora}`;

export function normalizaAntecedencias(v) {
  const l = (Array.isArray(v) ? v : []).map(Number).filter((n) => ANTECEDENCIAS.includes(n));
  return [...new Set(l)].sort((a, b) => b - a);
}
const lista = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };

/** Quem recebe: membros ativos da equipe; senão o responsável; senão os admins. */
export function destinatarios(casoId) {
  const q = (sql, ...p) => all(sql, ...p);
  let r = q(`SELECT u.id, u.nome, u.email, u.avisos_email, u.avisos_push FROM casos_membros m JOIN users u ON u.id=m.user_id
             WHERE m.caso_id=? AND u.ativo=1 AND u.role IN ('admin','funcionario')`, casoId);
  if (!r.length) r = q(`SELECT u.id, u.nome, u.email, u.avisos_email, u.avisos_push FROM casos c JOIN users u ON u.id=c.responsavel_id
                        WHERE c.id=? AND u.ativo=1 AND u.role IN ('admin','funcionario')`, casoId);
  if (!r.length) r = q("SELECT id, nome, email, avisos_email, avisos_push FROM users WHERE role='admin' AND ativo=1");
  return r;
}

const quando = (min) => (min === 0 ? 'agora' : min === 15 ? 'em 15 minutos' : min === 60 ? 'em 1 hora' : min === 1440 ? 'amanhã' : 'em 2 dias');
const linkCaso = (casoId) => `/painel#/casos/${casoId}/prazos`;

async function avisa(prazo, minutos) {
  const titulo = `Prazo ${quando(minutos)}: ${prazo.titulo}`.slice(0, 160);
  const detalhe = `${fmtBR(prazo.data, prazo.hora)} · ${prazo.caso_titulo}`;
  for (const u of destinatarios(prazo.caso_id)) {
    run('INSERT INTO notificacoes(user_id, prazo_id, caso_id, titulo, corpo, criado_em) VALUES(?,?,?,?,?,?)', u.id, prazo.id, prazo.caso_id, titulo, detalhe, now());
    if (u.avisos_email && emailConfigurado()) {
      // e-mail sem o nome do caso (que costuma ser o nome do cliente): quem lê vê o prazo e abre o painel para o resto
      enviaEmail({ para: u.email, assunto: `[Painel] ${titulo}`.slice(0, 200),
        texto: `${u.nome.split(' ')[0]}, lembrete de prazo:\n\n${prazo.titulo}\nVence: ${fmtBR(prazo.data, prazo.hora)}\n\nAbra o painel para ver o caso: ${PAINEL_URL()}#/casos/${prazo.caso_id}/prazos\n\nÉ um lembrete interno. Confira sempre o prazo oficial no tribunal. Para parar de receber estes e-mails, desligue em "Avisos" no painel.` })
        .catch((e) => console.warn(`Lembrete por e-mail falhou: ${e.message}`));
    }
    if (u.avisos_push) {
      for (const s of all('SELECT * FROM push_subs WHERE user_id=?', u.id)) {
        enviaPush(s, { titulo, corpo: detalhe, url: linkCaso(prazo.caso_id), tag: `prazo-${prazo.id}-${minutos}` }).catch((e) => console.warn(`Push falhou: ${e.message}`));
      }
    }
  }
}

/** Procura avisos vencidos e dispara. Marca como enviado ANTES de enviar: no pior caso perde um aviso, nunca repete. */
export async function verificaLembretes(agora = Date.now()) {
  const limiteData = new Date(agora - 3 * 3600e3 - 2 * 864e5).toISOString().slice(0, 10); // ignora prazos antigos
  let n = 0;
  for (const p of all(`SELECT pz.*, c.titulo caso_titulo FROM prazos pz JOIN casos c ON c.id=pz.caso_id WHERE pz.concluido=0 AND pz.data>=?`, limiteData)) {
    const venc = vencimentoMs(p.data, p.hora);
    if (!Number.isFinite(venc) || agora > venc + JANELA_APOS_MS) continue;
    const enviados = new Set(lista(p.avisos_enviados));
    // dispara só o aviso mais próximo do vencimento que já venceu (se o servidor ficou fora do ar, não manda 3 de uma vez)
    const devidos = normalizaAntecedencias(lista(p.avisar)).filter((m) => !enviados.has(m) && agora >= venc - m * 60e3);
    if (!devidos.length) continue;
    const mais = Math.min(...devidos);
    run('UPDATE prazos SET avisos_enviados=? WHERE id=?', JSON.stringify([...enviados, ...devidos]), p.id);
    await avisa(p, mais); n++;
  }
  return n;
}

let timer = null;
export function iniciaLembretes() {
  if (timer) return;
  const passo = () => verificaLembretes().catch((e) => console.error('Falha nos lembretes', e));
  passo();
  timer = setInterval(passo, 60e3); timer.unref();
}
