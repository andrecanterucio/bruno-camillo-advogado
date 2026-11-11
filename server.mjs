// Servidor único: site estático do escritório + painel (/login, /painel, /portal) + API.
// Sem dependências externas: Node 22+ (node:sqlite). Dados em ./data (fora do git).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// .env.local simples (não sobrescreve variáveis já definidas no ambiente)
try {
  for (const l of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* sem .env.local */ }

const { all, get, run, now, audit, UPLOAD_DIR, tx } = await import('./lib/db.mjs');
const { hashPassword, verifyPassword, createSession, destroySession, userFromReq, loginBloqueado, loginFalhou, loginOk, isStaff } = await import('./lib/auth.mjs');
const I = await import('./lib/integracoes.mjs');
const { bootstrap, DEMO } = await import('./lib/seed.mjs');
const { rid, digits, formatCnj, sha256, parseCookies } = await import('./lib/util.mjs');
const { ipDoCliente, dentroDoLimite, validaSenha, cpfValido } = await import('./lib/ratelimit.mjs');
const T = await import('./lib/termos.mjs');
const { avisoSemNovidade } = await import('./lib/avisos.mjs');
const { descreve: descreveAuditoria } = await import('./lib/auditoria.mjs');
const { avisaInteresse } = await import('./lib/email.mjs');
const { r2Config, r2Apaga } = await import('./lib/r2.mjs');
// Apaga também a cópia cifrada no R2 (backup). Falha no R2 não impede a exclusão local, mas fica registrada.
async function apagaNoR2(arquivos) {
  const cfg = r2Config();
  if (!cfg || !arquivos.length) return;
  const rs = await Promise.allSettled(arquivos.map((a) => r2Apaga(cfg, `uploads/${a}.enc`)));
  const falhas = rs.filter((r) => r.status === 'rejected');
  if (falhas.length) console.warn(`R2: ${falhas.length} de ${rs.length} arquivo(s) não foram apagados no backup: ${falhas[0].reason?.message}`);
}
const SENHA_FALSA = hashPassword('senha-falsa-para-igualar-o-tempo-de-resposta');

const PORT = +(process.env.PORT || 3000);
const PROD = process.env.NODE_ENV === 'production';
if (PROD && process.argv.includes('--demo')) { console.error('Recusado: --demo (dados fictícios e senha conhecida) não pode rodar em produção.'); process.exit(1); }
const MODO_DEMO = process.argv.includes('--demo');
const criado = bootstrap({ demo: MODO_DEMO });
const demoCreds = MODO_DEMO ? criado : null; // só o modo demo mostra credenciais de demonstração
if (!MODO_DEMO && criado) console.log(`Administrador criado a partir do ambiente: ${criado.email} (troca de senha obrigatória no primeiro login)`);

/* ------------------------------------------------------------ helpers HTTP */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.ico': 'image/x-icon' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' };

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m) => new HttpError(400, m);

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...BASE_HEADERS, ...headers });
  res.end(body);
}
const sendJson = (res, data, status = 200) => send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP });

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    const parts = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new HttpError(413, 'Arquivo ou corpo grande demais.')); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}
async function readJson(req, limit) {
  const b = await readBody(req, limit);
  if (!b.length) return {};
  try { return JSON.parse(b.toString('utf8')); } catch { throw bad('JSON inválido.'); }
}

function servirArquivo(res, file, { csp = false, cache = 'no-cache' } = {}) {
  let st; try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const h = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache };
  if (csp) h['Content-Security-Policy'] = CSP;
  send(res, 200, fs.readFileSync(file), h);
  return true;
}

/* ------------------------------------------------------- site estático (whitelist) */
const SITE_OK = /^(index\.html|robots\.txt|sitemap\.xml|llms\.txt|google[\w]+\.html|assets|cartao|privacidade|direito-[\w-]+)$/;
function servirSite(res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname).replace(/^\/+/, ''); } catch { return false; } // %-escape malformado: não é arquivo do site
  // Nenhum segmento ".." (nem "\" nem NUL) depois de decodificar: "..%2f" só vira "../" aqui, depois da normalização da URL.
  if (/(^|[\/])\.\.([\/]|$)|\|\0/.test(rel)) return false;
  const top = rel.split('/')[0];
  if (rel === '') rel = 'index.html';
  else if (!SITE_OK.test(top)) return false;
  let file = path.resolve(ROOT, rel);
  // o arquivo precisa ficar DENTRO da pasta pública (ou ser um dos arquivos soltos da raiz), não em qualquer lugar de ROOT
  const base = path.resolve(ROOT, rel === 'index.html' ? 'index.html' : top);
  if (rel.includes('/') ? !file.startsWith(base + path.sep) : file !== base) return false;
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  const cache = rel.startsWith('assets/') ? 'public, max-age=3600' : 'no-cache';
  return servirArquivo(res, file, { cache });
}

/* ------------------------------------------------------------- autorização */
const ASSET_UI = path.join(ROOT, 'painel');
function exigeStaff(u) { if (!isStaff(u)) throw new HttpError(401, 'Faça login.'); }
function exigeAdmin(u) { exigeStaff(u); if (u.role !== 'admin') throw new HttpError(403, 'Apenas o advogado (admin) pode fazer isso.'); }
function casoOuErro(u, id) {
  const c = get(`SELECT c.*, f.nome AS fase, cl.nome AS cliente_nome FROM casos c
                 JOIN fases f ON f.id=c.fase_id LEFT JOIN clientes cl ON cl.id=c.cliente_id WHERE c.id=?`, id);
  if (!c) throw new HttpError(404, 'Caso não encontrado.');
  if (u.role === 'funcionario' && c.responsavel_id !== u.id) throw new HttpError(403, 'Este caso não está atribuído a você.');
  return c;
}
// Empresa (cliente) que a pessoa enxerga: o admin vê todas; a funcionária, as que criou ou onde tem caso sob sua responsabilidade
// (a MESMA regra da listagem em GET /api/clientes). Toda escrita que aponta para um cliente confere isto, para a regra
// "ter caso sob responsabilidade" não virar escada de privilégio.
function exigeClienteVisivel(u, clienteId) {
  if (u.role === 'admin') return;
  const ok = get('SELECT 1 x FROM clientes cl WHERE cl.id=? AND (cl.criado_por=? OR cl.id IN (SELECT cliente_id FROM casos WHERE responsavel_id=?))', clienteId, u.id, u.id);
  if (!ok) throw new HttpError(403, 'Este cliente não está sob sua responsabilidade.');
}
const filtroCaso = (u) => (u.role === 'admin' ? ['1=1', []] : ['c.responsavel_id=?', [u.id]]);
const bool = (v) => (v ? 1 : 0);

/* ------------------------------------------------------------------- rotas */
const routes = [];
const R = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });

// --- auth
R('POST', '/api/auth/login', async ({ req, body, res }) => {
  const email = String(body.email || '').trim().toLowerCase();
  const ip = ipDoCliente(req);
  const key = `${ip}|${email}`;
  if (!dentroDoLimite('login-ip', ip, 20, 60e3) || loginBloqueado(key)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
  const u = get('SELECT * FROM users WHERE email=? AND ativo=1', email);
  // compara sempre uma senha, para o tempo de resposta não revelar se o e-mail existe
  const okSenha = verifyPassword(String(body.senha || ''), u ? u.senha_hash : SENHA_FALSA);
  if (!u || !okSenha) { loginFalhou(key); throw new HttpError(401, 'E-mail ou senha incorretos.'); }
  loginOk(key);
  const s = createSession(u.id);
  audit(u.id, 'login');
  const secure = PROD || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `sid=${s.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${s.maxAge}${secure ? '; Secure' : ''}`);
  return { role: u.role, destino: u.role === 'cliente' ? '/portal' : '/painel' };
}, true);
R('POST', '/api/auth/logout', ({ req, res }) => { destroySession(req); res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); return { ok: true }; }, true);
// Ficha do Plano exibida no aceite e gravada junto com ele (como o plan_sheet do zacda-app).
// No piloto nada é cobrado; os valores do plano pago só aparecem antes de qualquer cobrança.
const fichaAtual = () => ({
  plano: PLANO.nome, mensalidade: 'R$ 0: piloto gratuito, nada é cobrado',
  itens: [['Processos acompanhados', 'ilimitados (uso justo)'], ['Usuários da equipe', 'ilimitados (uso justo)'], ['Armazenamento de documentos', `${PLANO.armazenamento_gb} GB`],
    ['Resumos de andamento por IA, por mês', String(PLANO.resumos_mes)], ['Clientes com acesso ao Portal', 'ilimitados'], ['Fonte de publicações', 'DJEN']],
  nota: 'Depois do piloto, os valores do plano pago serão apresentados antes de qualquer cobrança e só valem com novo aceite.',
  capturada_em: now(),
});
const contratoAceito = () => !!get('SELECT 1 x FROM contratos_aceite WHERE versao=?', T.contratoGestao().versao);
// Autorização de uso de IA (antes chamada Opção B): 'pendente' (ainda não decidiu), 'aceita' (IA liberada caso a caso) ou 'recusada' (IA totalmente desativada).
const estadoOpcaoB = () => {
  const a = get('SELECT criado_em FROM ia_termo_aceite WHERE versao=? ORDER BY id DESC LIMIT 1', T.IA_TERMO.versao);
  const r = get('SELECT criado_em FROM ia_opcao_recusa WHERE versao=? ORDER BY id DESC LIMIT 1', T.IA_TERMO.versao);
  if (!a && !r) return 'pendente';
  return a && (!r || a.criado_em >= r.criado_em) ? 'aceita' : 'recusada';
};
const iaGlobalAceita = () => estadoOpcaoB() === 'aceita';
R('GET', '/api/me', ({ user }) => {
  if (!user) throw new HttpError(401, 'Sem sessão.');
  const { expira_em, ...u } = user;
  return { ...u, must_change: !!u.must_change, ia: I.iaAtiva(), datajud: I.datajudAtivo(), demo: !!demoCreds, contrato_aceito: isStaff(user) ? contratoAceito() : null, ia_global_aceita: isStaff(user) ? iaGlobalAceita() : null, ia_opcao_b: isStaff(user) ? estadoOpcaoB() : null };
});
R('POST', '/api/auth/aceite', ({ user }) => { if (!user) throw new HttpError(401, 'Faça login.'); run('UPDATE users SET aceite_em=? WHERE id=?', now(), user.id); audit(user.id, 'aceite.termos'); return { ok: true }; });
R('POST', '/api/auth/senha', ({ req, user, body }) => {
  if (!user) throw new HttpError(401, 'Faça login.');
  if (!dentroDoLimite('senha', String(user.id), 10, 15 * 60e3)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
  const full = get('SELECT senha_hash FROM users WHERE id=?', user.id);
  if (!verifyPassword(String(body.atual || ''), full.senha_hash)) throw bad('Senha atual incorreta.');
  const erroSenha = validaSenha(body.nova);
  if (erroSenha) throw bad(erroSenha);
  if (body.nova === body.atual) throw bad('A nova senha precisa ser diferente da atual.');
  run('UPDATE users SET senha_hash=?, must_change=0 WHERE id=?', hashPassword(body.nova), user.id);
  // encerra as outras sessões (se a senha vazou, quem a tinha perde o acesso)
  run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', user.id, sha256(parseCookies(req.headers.cookie).sid || ''));
  audit(user.id, 'senha.alterar');
  return { ok: true };
});

// --- contrato (aceite por clique, com rolagem, identificação e três ciências separadas)
R('GET', '/api/contrato', ({ user }) => {
  exigeStaff(user);
  const c = T.contratoGestao();
  const ac = get('SELECT nome, criado_em FROM contratos_aceite WHERE versao=? ORDER BY id DESC LIMIT 1', c.versao);
  return { versao: c.versao, hash: c.hash, texto: c.texto, titulo: c.titulo, corpo: c.corpo, resumo: c.resumo, ficha: fichaAtual(), ciencias: T.cienciasContrato(), aceito: !!ac, aceito_por: ac?.nome ?? null, aceito_em: ac?.criado_em ?? null };
});
R('POST', '/api/contrato/aceite', ({ req, user, body }) => {
  exigeAdmin(user);
  const c = T.contratoGestao();
  const nome = String(body.nome || '').trim().slice(0, 150), oab = String(body.oab || '').trim().slice(0, 30);
  if (nome.length < 3) throw bad('Informe o nome completo.');
  if (!cpfValido(body.documento)) throw bad('Informe um CPF válido.');
  if (oab.length < 3) throw bad('Informe o número da OAB.');
  const ciencias = body.ciencias || {};
  for (const x of T.cienciasContrato()) if (ciencias[x.id] !== true) throw bad('Marque as três ciências para aceitar.');
  if (body.rolou !== true) throw bad('Leia o contrato até o fim.');
  if (body.concordo !== true) throw bad('Marque que você leu e concorda com o contrato.');
  const id = run(`INSERT INTO contratos_aceite(user_id,nome,documento,oab,versao,hash,ip,user_agent,ciencias,ficha,criado_em) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    user.id, nome, digits(body.documento), oab, c.versao, c.hash, ipDoCliente(req), String(req.headers['user-agent'] || '').slice(0, 300), JSON.stringify(ciencias), JSON.stringify(fichaAtual()), now()).id;
  audit(user.id, 'contrato.aceitar', `${c.versao} #${id}`);
  return { ok: true, versao: c.versao };
});

// --- termo global de IA (uma vez por escritório) e habilitação por caso
R('GET', '/api/ia/termo', ({ user }) => {
  exigeStaff(user);
  const ac = get('SELECT nome, criado_em FROM ia_termo_aceite WHERE versao=? ORDER BY id DESC LIMIT 1', T.IA_TERMO.versao);
  return { versao: T.IA_TERMO.versao, titulo: T.IA_TERMO.titulo, paragrafos: T.IA_TERMO.paragrafos, se_autorizar: T.IA_TERMO.se_autorizar, se_nao_autorizar: T.IA_TERMO.se_nao_autorizar, ciencias: T.IA_TERMO.ciencias, decisao: estadoOpcaoB(), aceito: !!ac, aceito_por: ac?.nome ?? null, aceito_em: ac?.criado_em ?? null };
});
R('POST', '/api/ia/termo/aceite', ({ req, user, body }) => {
  exigeAdmin(user);
  const nome = String(body.nome || '').trim().slice(0, 150);
  if (nome.length < 3) throw bad('Informe o nome completo.');
  const ciencias = body.ciencias || {};
  for (const x of T.IA_TERMO.ciencias) if (ciencias[x.id] !== true) throw bad('Marque as duas confirmações para autorizar.');
  const hash = sha256(JSON.stringify([T.IA_TERMO.paragrafos, T.IA_TERMO.se_autorizar, T.IA_TERMO.se_nao_autorizar, T.IA_TERMO.ciencias]));
  run('INSERT INTO ia_termo_aceite(user_id,nome,versao,hash,ip,user_agent,ciencias,criado_em) VALUES(?,?,?,?,?,?,?,?)', user.id, nome, T.IA_TERMO.versao, hash, ipDoCliente(req), String(req.headers['user-agent'] || '').slice(0, 300), JSON.stringify(ciencias), now());
  audit(user.id, 'ia.termo.aceitar', T.IA_TERMO.versao);
  return { ok: true };
});
R('POST', '/api/ia/termo/recusar', ({ req, user }) => {
  exigeAdmin(user);
  tx(() => {
    run('INSERT INTO ia_opcao_recusa(user_id,nome,versao,ip,user_agent,criado_em) VALUES(?,?,?,?,?,?)', user.id, user.nome, T.IA_TERMO.versao, ipDoCliente(req), String(req.headers['user-agent'] || '').slice(0, 300), now());
    // IA totalmente desativada: desliga em todos os casos e revoga as habilitações
    run('UPDATE ia_caso_consentimento SET revogado_em=?, revogado_por=? WHERE revogado_em IS NULL', now(), user.id);
    run('UPDATE casos SET ia_habilitada=0 WHERE ia_habilitada=1');
  });
  audit(user.id, 'ia.opcao_b.recusar', T.IA_TERMO.versao);
  return { ok: true };
});
R('GET', '/api/ia/caso-termo', ({ user }) => { exigeStaff(user); return T.CASO_IA_TERMO; });
R('POST', '/api/casos/:id/ia/habilitar', ({ req, user, params, body }) => {
  exigeAdmin(user);
  const c = casoOuErro(user, params.id);
  if (c.segredo) throw new HttpError(409, T.CASO_IA_TERMO.aviso_segredo);
  if (!iaGlobalAceita()) throw new HttpError(409, 'ia_opcao_b');
  const ciencias = body.ciencias || {};
  // cláusula 9A.3/9A.5 do contrato: confirmações separadas, mais a reforçada nos casos sensíveis
  const exigidas = [...T.CASO_IA_TERMO.ciencias, ...(T.ehSensivel(c) ? [T.CASO_IA_TERMO.ciencia_sensivel] : [])];
  for (const x of exigidas) if (ciencias[x.id] !== true) throw bad('Marque todas as confirmações.');
  const papel = body.papel_cliente || c.papel_cliente;
  if (!['autor', 'reu', 'outro'].includes(papel)) throw bad('Informe a posição do cliente no processo (autor, réu ou outro).');
  const dt = String(body.consentimento_em || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dt) || dt > now().slice(0, 10)) throw bad('Informe a data em que o cliente consentiu (não pode ser futura).');
  const hash = sha256(JSON.stringify([T.CASO_IA_TERMO.intro, exigidas]));
  tx(() => {
    run('INSERT INTO ia_caso_consentimento(caso_id,user_id,consentimento_em,versao,hash,ip,ciencias,criado_em) VALUES(?,?,?,?,?,?,?,?)', c.id, user.id, dt, T.CASO_IA_TERMO.versao, hash, ipDoCliente(req), JSON.stringify({ ...ciencias, papel_cliente: papel }), now());
    run('UPDATE casos SET ia_habilitada=1, papel_cliente=?, atualizado_em=? WHERE id=?', papel, now(), c.id);
  });
  audit(user.id, 'ia.caso.habilitar', String(c.id));
  return { ok: true };
});
R('POST', '/api/casos/:id/ia/desabilitar', ({ user, params }) => {
  exigeAdmin(user);
  const c = casoOuErro(user, params.id);
  run('UPDATE ia_caso_consentimento SET revogado_em=?, revogado_por=? WHERE caso_id=? AND revogado_em IS NULL', now(), user.id, c.id);
  run('UPDATE casos SET ia_habilitada=0, atualizado_em=? WHERE id=?', now(), c.id);
  audit(user.id, 'ia.caso.desabilitar', String(c.id));
  return { ok: true };
});

// --- resumo / kanban
R('GET', '/api/resumo', ({ user }) => {
  exigeStaff(user);
  const [w, p] = filtroCaso(user);
  const hoje = new Date().toISOString().slice(0, 10);
  const em7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  return {
    casos_ativos: get(`SELECT COUNT(*) n FROM casos c JOIN fases f ON f.id=c.fase_id WHERE ${w} AND f.nome<>'Encerrado'`, ...p).n,
    prazos_7d: all(`SELECT pz.*, c.titulo caso FROM prazos pz JOIN casos c ON c.id=pz.caso_id WHERE ${w} AND pz.concluido=0 AND pz.data<=? ORDER BY pz.data LIMIT 12`, ...p, em7).map((x) => ({ ...x, atrasado: x.data < hoje })),
    rascunhos: get(`SELECT COUNT(*) n FROM andamentos a JOIN casos c ON c.id=a.caso_id WHERE ${w} AND a.status='rascunho'`, ...p).n,
    publicacoes_novas: user.role === 'admin' ? get('SELECT COUNT(*) n FROM publicacoes WHERE lida=0').n : null,
    leads: user.role === 'admin' ? get("SELECT COUNT(*) n FROM clientes WHERE status='lead'").n : null,
  };
});
R('GET', '/api/kanban', ({ user }) => {
  exigeStaff(user);
  const [w, p] = filtroCaso(user);
  return {
    fases: all('SELECT * FROM fases ORDER BY ordem'),
    casos: all(`SELECT c.id, c.titulo, c.area, c.fase_id, c.numero_cnj, c.segredo, c.ia_habilitada, c.etiquetas, cl.nome cliente,
                  (SELECT MIN(data) FROM prazos WHERE caso_id=c.id AND concluido=0) proximo_prazo,
                  (SELECT COUNT(*) FROM andamentos WHERE caso_id=c.id AND status='rascunho') rascunhos
                FROM casos c LEFT JOIN clientes cl ON cl.id=c.cliente_id WHERE ${w} ORDER BY c.ordem, c.id DESC`, ...p).map((c) => ({ ...c, sensivel: T.ehSensivel(c) })),
  };
});
R('POST', '/api/fases', ({ user, body }) => {
  exigeAdmin(user);
  const nome = String(body.nome || '').trim().slice(0, 60);
  if (!nome) throw bad('Informe o nome da coluna.');
  if (get('SELECT 1 x FROM fases WHERE nome=?', nome)) throw bad('Já existe uma coluna com esse nome.');
  return { id: run('INSERT INTO fases(nome, ordem) VALUES(?,?)', nome, get('SELECT COALESCE(MAX(ordem),-1)+1 o FROM fases').o).id };
});

// --- casos
R('POST', '/api/casos', ({ user, body }) => {
  exigeStaff(user);
  if (body.cliente_id) exigeClienteVisivel(user, body.cliente_id);
  const titulo = String(body.titulo || '').trim().slice(0, 200);
  if (!titulo) throw bad('Informe o título do caso.');
  const fase = body.fase_id || get('SELECT id FROM fases ORDER BY ordem LIMIT 1').id;
  const cnj = body.numero_cnj ? formatCnj(body.numero_cnj) : null;
  const id = run(`INSERT INTO casos(titulo,cliente_id,numero_cnj,area,fase_id,segredo,responsavel_id,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,?,?,?)`,
    titulo, body.cliente_id || null, cnj, body.area || null, fase, bool(body.segredo), user.role === 'funcionario' ? user.id : (body.responsavel_id || null), now(), now()).id;
  audit(user.id, 'caso.criar', String(id));
  return { id };
});
R('GET', '/api/casos/:id', ({ user, params }) => {
  exigeStaff(user);
  const c = casoOuErro(user, params.id);
  audit(user.id, 'caso.ver', String(c.id));
  return {
    caso: { ...c, sensivel: T.ehSensivel(c) },
    consentimento_ia: get('SELECT consentimento_em, criado_em, versao FROM ia_caso_consentimento WHERE caso_id=? AND revogado_em IS NULL ORDER BY id DESC LIMIT 1', c.id) ?? null,
    andamentos: all('SELECT * FROM andamentos WHERE caso_id=? ORDER BY data DESC, id DESC', c.id),
    documentos: all('SELECT id, nome, mime, tamanho, visivel_cliente, criado_em FROM documentos WHERE caso_id=? ORDER BY id DESC', c.id),
    prazos: all('SELECT * FROM prazos WHERE caso_id=? ORDER BY concluido, data', c.id),
    publicacoes: all('SELECT id, tribunal, orgao, tipo, data_disp, substr(texto,1,300) resumo FROM publicacoes WHERE caso_id=? ORDER BY data_disp DESC LIMIT 20', c.id),
  };
});
R('PATCH', '/api/casos/:id', ({ user, params, body }) => {
  exigeStaff(user);
  casoOuErro(user, params.id);
  if ('cliente_id' in body && body.cliente_id) exigeClienteVisivel(user, body.cliente_id);
  const campos = ['titulo', 'cliente_id', 'area', 'fase_id', 'segredo', 'etiquetas', 'notas', 'ordem', 'papel_cliente'];
  if (user.role === 'admin') campos.push('responsavel_id');
  if ('papel_cliente' in body && body.papel_cliente && !['autor', 'reu', 'outro'].includes(body.papel_cliente)) throw bad('Posição do cliente inválida.');
  const sets = [], vals = [];
  for (const k of campos) if (k in body) { sets.push(`${k}=?`); vals.push(k === 'segredo' ? bool(body[k]) : (body[k] === '' ? null : body[k])); }
  // segredo de justiça: bloqueio total da IA, inclusive revogando habilitação anterior
  if (body.segredo) {
    sets.push('ia_habilitada=0');
    run('UPDATE ia_caso_consentimento SET revogado_em=?, revogado_por=? WHERE caso_id=? AND revogado_em IS NULL', now(), user.id, params.id);
  }
  if ('numero_cnj' in body) { sets.push('numero_cnj=?'); vals.push(body.numero_cnj ? formatCnj(body.numero_cnj) : null); }
  if (!sets.length) throw bad('Nada para atualizar.');
  run(`UPDATE casos SET ${sets.join(',')}, atualizado_em=? WHERE id=?`, ...vals, now(), params.id);
  audit(user.id, 'caso.editar', params.id);
  return { ok: true };
});
R('DELETE', '/api/casos/:id', async ({ user, params }) => {
  exigeAdmin(user);
  const caso = get('SELECT titulo FROM casos WHERE id=?', params.id);
  if (!caso) throw new HttpError(404, 'Caso não encontrado.');
  const arquivos = all('SELECT arquivo FROM documentos WHERE caso_id=?', params.id).map((d) => d.arquivo);
  for (const a of arquivos) fs.rmSync(path.join(UPLOAD_DIR, a), { force: true });
  run('DELETE FROM casos WHERE id=?', params.id);
  audit(user.id, 'caso.excluir', `${params.id} ${caso.titulo}`);
  await apagaNoR2(arquivos);
  return { ok: true, documentos_apagados: arquivos.length };
});
R('POST', '/api/casos/:id/datajud', async ({ user, params }) => {
  exigeStaff(user);
  const c = casoOuErro(user, params.id);
  if (!c.numero_cnj) throw bad('O caso não tem número CNJ.');
  const r = await I.datajudSincronizar(c);
  audit(user.id, 'datajud.sync', params.id);
  return r;
});

// --- andamentos
R('POST', '/api/casos/:id/andamentos', ({ user, params, body }) => {
  exigeStaff(user);
  const c = casoOuErro(user, params.id);
  const texto = String(body.texto || '').trim().slice(0, 8000);
  if (!texto) throw bad('Descreva o andamento.');
  const id = run(`INSERT INTO andamentos(caso_id,data,origem,texto_original,status,criado_por,criado_em) VALUES(?,?,?,?,'rascunho',?,?)`,
    c.id, body.data || now().slice(0, 10), 'manual', texto, user.id, now()).id;
  return { id };
});
function andamentoOuErro(user, id) {
  const a = get('SELECT * FROM andamentos WHERE id=?', id);
  if (!a) throw new HttpError(404, 'Andamento não encontrado.');
  return { a, c: casoOuErro(user, a.caso_id) };
}
R('PATCH', '/api/andamentos/:id', ({ user, params, body }) => {
  exigeStaff(user);
  const { a } = andamentoOuErro(user, params.id);
  if ('texto_simples' in body) {
    run('UPDATE andamentos SET texto_simples=?, status=?, visivel_cliente=0, aprovado_por=NULL WHERE id=?', String(body.texto_simples || '').slice(0, 4000) || null, 'rascunho', a.id);
  }
  if (body.aprovar !== undefined) {
    exigeAdmin(user);
    const atual = get('SELECT texto_simples FROM andamentos WHERE id=?', a.id);
    if (body.aprovar && !atual.texto_simples) throw bad('Escreva ou gere o texto em linguagem simples antes de aprovar.');
    run('UPDATE andamentos SET status=?, visivel_cliente=?, aprovado_por=? WHERE id=?', body.aprovar ? 'aprovado' : 'rascunho', bool(body.aprovar), body.aprovar ? user.id : null, a.id);
    audit(user.id, body.aprovar ? 'andamento.aprovar' : 'andamento.reprovar', String(a.id));
  }
  return { ok: true };
});
R('POST', '/api/andamentos/:id/traduzir', async ({ user, params }) => {
  exigeStaff(user);
  const { a, c } = andamentoOuErro(user, params.id);
  if (c.segredo) throw new HttpError(409, 'Caso em segredo de justiça: a IA fica desligada. Escreva o texto manualmente.');
  if (!iaGlobalAceita()) throw new HttpError(409, estadoOpcaoB() === 'recusada' ? 'IA totalmente desativada: o escritório não autorizou o uso de IA. Só é possível ligar depois de autorizar.' : 'A IA ainda depende da decisão do advogado sobre a autorização de uso de IA.');
  if (!c.ia_habilitada) throw new HttpError(409, 'A IA está desligada neste caso. O advogado precisa habilitá-la, com o consentimento do cliente.');
  if (!c.papel_cliente) throw new HttpError(409, 'Informe a posição do cliente no processo (autor, réu ou outro) na aba Resumo antes de gerar.');
  if (!dentroDoLimite('ia-user', String(user.id), 20, 60e3)) throw new HttpError(429, 'Muitos resumos em pouco tempo. Aguarde um minuto.');
  const texto = await I.traduzirAndamento({ texto: a.texto_original, area: c.area, casoId: c.id, papel: c.papel_cliente });
  run("UPDATE andamentos SET texto_simples=?, ia=1, status='rascunho', visivel_cliente=0, aprovado_por=NULL WHERE id=?", texto, a.id);
  audit(user.id, 'ia.traduzir', String(a.id));
  return { texto_simples: texto };
});
R('DELETE', '/api/andamentos/:id', ({ user, params }) => {
  exigeAdmin(user);
  run('DELETE FROM andamentos WHERE id=?', params.id);
  return { ok: true };
});

// --- prazos
R('POST', '/api/casos/:id/prazos', ({ user, params, body }) => {
  exigeStaff(user);
  const c = casoOuErro(user, params.id);
  if (!body.titulo || !/^\d{4}-\d{2}-\d{2}$/.test(body.data || '')) throw bad('Informe título e data.');
  return { id: run('INSERT INTO prazos(caso_id,titulo,data,criado_em) VALUES(?,?,?,?)', c.id, String(body.titulo).slice(0, 200), body.data, now()).id };
});
R('PATCH', '/api/prazos/:id', ({ user, params, body }) => {
  exigeStaff(user);
  const p = get('SELECT caso_id FROM prazos WHERE id=?', params.id);
  if (!p) throw new HttpError(404, 'Prazo não encontrado.');
  casoOuErro(user, p.caso_id);
  run('UPDATE prazos SET concluido=? WHERE id=?', bool(body.concluido), params.id);
  return { ok: true };
});

// --- documentos (arquivos ficam fora da pasta pública, com download autenticado)
const EXT_OK = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'doc', 'docx', 'xls', 'xlsx', 'odt', 'txt']);
R('POST', '/api/casos/:id/documentos', async ({ req, user, params }) => {
  exigeStaff(user);
  const c = casoOuErro(user, params.id);
  if (!dentroDoLimite('upload', String(user.id), 30, 10 * 60e3)) throw new HttpError(429, 'Muitos envios em pouco tempo. Aguarde alguns minutos.');
  const nome = (() => { const v = String(req.headers['x-filename'] || 'arquivo'); try { return decodeURIComponent(v); } catch { return v; } })().replace(/[\\/\0]/g, '_').slice(0, 150);
  const ext = nome.includes('.') ? nome.split('.').pop().toLowerCase() : '';
  if (!EXT_OK.has(ext)) throw bad(`Tipo de arquivo não permitido (.${ext || '?'}).`);
  const buf = await readBody(req, 15 * 1024 * 1024);
  if (!buf.length) throw bad('Arquivo vazio.');
  if (ext === 'pdf' && buf.subarray(0, 5).toString() !== '%PDF-') throw bad('O arquivo não é um PDF válido.');
  const arquivo = `${rid(16)}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, arquivo), buf);
  const id = run('INSERT INTO documentos(caso_id,nome,arquivo,mime,tamanho,enviado_por,criado_em) VALUES(?,?,?,?,?,?,?)', c.id, nome, arquivo, MIME[`.${ext}`] || 'application/octet-stream', buf.length, user.id, now()).id;
  audit(user.id, 'documento.enviar', String(id));
  return { id };
});
R('PATCH', '/api/documentos/:id', ({ user, params, body }) => {
  exigeAdmin(user);
  run('UPDATE documentos SET visivel_cliente=? WHERE id=?', bool(body.visivel_cliente), params.id);
  audit(user.id, 'documento.visibilidade', params.id);
  return { ok: true };
});
R('DELETE', '/api/documentos/:id', async ({ user, params }) => {
  exigeAdmin(user);
  const d = get('SELECT arquivo, nome FROM documentos WHERE id=?', params.id);
  if (d) { fs.rmSync(path.join(UPLOAD_DIR, d.arquivo), { force: true }); run('DELETE FROM documentos WHERE id=?', params.id); }
  audit(user.id, 'documento.excluir', `${params.id} ${d?.nome || ''}`.trim());
  if (d) await apagaNoR2([d.arquivo]);
  return { ok: true };
});
R('GET', '/api/documentos/:id/download', ({ user, params, res }) => {
  if (!user) throw new HttpError(401, 'Faça login.');
  const d = get('SELECT * FROM documentos WHERE id=?', params.id);
  if (!d) throw new HttpError(404, 'Documento não encontrado.');
  if (isStaff(user)) casoOuErro(user, d.caso_id);
  else {
    if (!user.aceite_em) throw new HttpError(403, 'aceite');
    const ok = get('SELECT 1 x FROM casos WHERE id=? AND cliente_id=?', d.caso_id, user.cliente_id);
    if (!ok || !d.visivel_cliente) throw new HttpError(403, 'Sem acesso a este documento.');
  }
  audit(user.id, 'documento.baixar', String(d.id));
  const file = path.join(UPLOAD_DIR, d.arquivo);
  if (!fs.existsSync(file)) throw new HttpError(404, 'Arquivo ausente no servidor.');
  send(res, 200, fs.readFileSync(file), { 'Content-Type': d.mime || 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(d.nome)}`, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'" });
  return undefined;
});

// --- exportar tudo (portabilidade: o advogado leva os dados dele)
const nomeSeguro = (s) => String(s || 'arquivo').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'arquivo';
R('GET', '/api/exportar-tudo', async ({ user, res }) => {
  exigeAdmin(user);
  if (!dentroDoLimite('exportar-tudo', String(user.id), 3, 600e3)) throw new HttpError(429, 'Você já exportou várias vezes agora há pouco. Aguarde alguns minutos.');
  const { ZipStream } = await import('./lib/zip.mjs');
  const quando = now();
  const tabelas = {
    clientes: all('SELECT * FROM clientes'), fases: all('SELECT * FROM fases'), casos: all('SELECT * FROM casos'),
    andamentos: all('SELECT * FROM andamentos'), prazos: all('SELECT * FROM prazos'), publicacoes: all('SELECT * FROM publicacoes'),
    documentos: all('SELECT id, caso_id, nome, mime, tamanho, visivel_cliente, enviado_por, criado_em FROM documentos'),
    usuarios: all('SELECT id, nome, email, role, ativo, cliente_id, aceite_em, criado_em FROM users'), // sem senha
    contratos_aceite: all('SELECT * FROM contratos_aceite'), ia_termo_aceite: all('SELECT * FROM ia_termo_aceite'),
    ia_opcao_recusa: all('SELECT * FROM ia_opcao_recusa'), ia_caso_consentimento: all('SELECT * FROM ia_caso_consentimento'),
    auditoria: all('SELECT * FROM auditoria'),
  };
  const docs = all('SELECT d.id, d.nome, d.arquivo, d.caso_id, c.titulo FROM documentos d LEFT JOIN casos c ON c.id=d.caso_id ORDER BY d.id');
  audit(user.id, 'dados.exportar_tudo', `${docs.length} documento(s)`);
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="dados-escritorio-${quando.slice(0, 10)}.zip"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
  const zip = new ZipStream(res);
  const leiame = `Exportação completa dos dados do escritório, gerada em ${quando}.\r\n\r\nCONTEÚDO\r\n- dados.json: clientes, casos, andamentos, prazos, publicações, documentos (lista), usuários (sem senhas), aceites e registro de auditoria.\r\n- documentos/: os arquivos enviados, em uma pasta por caso.\r\n\r\nCUIDADOS\r\n- Este arquivo contém dados pessoais e sigilosos de clientes. Guarde em local protegido e não envie por e-mail comum.\r\n- Os arquivos dos documentos estão sem criptografia neste pacote.\r\n- Senhas e sessões não são exportadas.\r\n`;
  try {
    await zip.adiciona('LEIA-ME.txt', Buffer.from(leiame, 'utf8'));
    await zip.adiciona('dados.json', Buffer.from(JSON.stringify({ exportado_em: quando, ...tabelas }, null, 2), 'utf8'));
    let ausentes = 0;
    for (const d of docs) {
      const file = path.join(UPLOAD_DIR, d.arquivo);
      if (!fs.existsSync(file)) { ausentes++; continue; }
      await zip.adiciona(`documentos/caso-${d.caso_id}-${nomeSeguro(d.titulo)}/${d.id}-${nomeSeguro(d.nome)}`, fs.createReadStream(file));
    }
    if (ausentes) await zip.adiciona('ARQUIVOS-AUSENTES.txt', Buffer.from(`${ausentes} documento(s) listados em dados.json não foram encontrados no servidor.\r\n`, 'utf8'));
    await zip.fecha();
  } catch (e) { console.warn(`Exportação interrompida: ${e.message}`); res.destroy(); }
  return undefined;
});

// --- clientes (CRM leve) e acessos
R('GET', '/api/clientes', ({ user }) => {
  exigeStaff(user);
  const base = `SELECT cl.*, (SELECT COUNT(*) FROM casos WHERE cliente_id=cl.id) casos,
                (SELECT id FROM users WHERE cliente_id=cl.id LIMIT 1) user_id FROM clientes cl`;
  if (user.role === 'admin') return all(`${base} ORDER BY cl.status='lead' DESC, cl.nome`);
  return all(`${base} WHERE cl.criado_por=? OR cl.id IN (SELECT cliente_id FROM casos WHERE responsavel_id=?) ORDER BY cl.nome`, user.id, user.id);
});
R('POST', '/api/clientes', ({ user, body }) => {
  exigeStaff(user);
  const nome = String(body.nome || '').trim().slice(0, 150);
  if (!nome) throw bad('Informe o nome.');
  const st = ['lead', 'ativo', 'inativo'].includes(body.status) ? body.status : 'lead';
  return { id: run('INSERT INTO clientes(nome,telefone,email,origem,status,notas,criado_por,criado_em) VALUES(?,?,?,?,?,?,?,?)', nome, body.telefone || null, body.email || null, body.origem || null, st, body.notas || null, user.id, now()).id };
});
R('PATCH', '/api/clientes/:id', ({ user, params, body }) => {
  exigeStaff(user);
  exigeClienteVisivel(user, params.id);
  const sets = [], vals = [];
  for (const k of ['nome', 'telefone', 'email', 'origem', 'status', 'notas']) if (k in body) { sets.push(`${k}=?`); vals.push(body[k] === '' ? null : body[k]); }
  if (!sets.length) throw bad('Nada para atualizar.');
  run(`UPDATE clientes SET ${sets.join(',')} WHERE id=?`, ...vals, params.id);
  return { ok: true };
});
R('POST', '/api/clientes/:id/acesso', ({ user, params, body }) => {
  exigeAdmin(user);
  const cl = get('SELECT * FROM clientes WHERE id=?', params.id);
  if (!cl) throw new HttpError(404, 'Cliente não encontrado.');
  const email = String(body.email || cl.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Informe um e-mail válido para o acesso.');
  if (get('SELECT 1 x FROM users WHERE email=?', email)) throw bad('Já existe um usuário com este e-mail.');
  const senha = `${rid(6)}Aa1!`; // senha temporária forte, mostrada uma única vez; troca obrigatória no 1º acesso
  run('INSERT INTO users(nome,email,role,senha_hash,cliente_id,must_change,criado_em) VALUES(?,?,?,?,?,1,?)', cl.nome, email, 'cliente', hashPassword(senha), cl.id, now());
  if (cl.status === 'lead') run("UPDATE clientes SET status='ativo' WHERE id=?", cl.id);
  audit(user.id, 'cliente.acesso', String(cl.id));
  return { email, senha_temporaria: senha };
});

// --- direitos do titular (LGPD): exportar e anonimizar os dados de um cliente
R('GET', '/api/clientes/:id/exportar', ({ user, params, res }) => {
  exigeAdmin(user);
  const cl = get('SELECT id, nome, telefone, email, origem, status, notas, criado_em FROM clientes WHERE id=?', params.id);
  if (!cl) throw new HttpError(404, 'Cliente não encontrado.');
  const casos = all('SELECT id, titulo, numero_cnj, area, segredo, ia_habilitada, papel_cliente, notas, criado_em FROM casos WHERE cliente_id=?', cl.id);
  const dados = {
    exportado_em: now(), cliente: cl,
    casos: casos.map((c) => ({
      ...c,
      andamentos: all("SELECT data, origem, texto_original, texto_simples, status FROM andamentos WHERE caso_id=? ORDER BY data", c.id),
      prazos: all('SELECT titulo, data, concluido FROM prazos WHERE caso_id=?', c.id),
      documentos: all('SELECT nome, mime, tamanho, visivel_cliente, criado_em FROM documentos WHERE caso_id=?', c.id),
      consentimentos_ia: all('SELECT consentimento_em, criado_em, revogado_em, versao FROM ia_caso_consentimento WHERE caso_id=?', c.id),
    })),
    acesso_portal: all('SELECT email, aceite_em, criado_em FROM users WHERE cliente_id=?', cl.id),
  };
  audit(user.id, 'cliente.exportar', String(cl.id));
  send(res, 200, JSON.stringify(dados, null, 2), { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="cliente-${cl.id}.json"`, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'" });
  return undefined;
});
R('POST', '/api/clientes/:id/anonimizar', ({ user, params }) => {
  exigeAdmin(user);
  const cl = get('SELECT id FROM clientes WHERE id=?', params.id);
  if (!cl) throw new HttpError(404, 'Cliente não encontrado.');
  tx(() => {
    run("UPDATE clientes SET nome=?, telefone=NULL, email=NULL, origem=NULL, notas=NULL, status='inativo' WHERE id=?", `Cliente removido #${cl.id}`, cl.id);
    run('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE cliente_id=?)', cl.id);
    run('DELETE FROM users WHERE cliente_id=?', cl.id);
    run("UPDATE casos SET ia_habilitada=0 WHERE cliente_id=?", cl.id);
  });
  audit(user.id, 'cliente.anonimizar', String(cl.id));
  return { ok: true };
});

// --- usuários da equipe (admin)
R('GET', '/api/usuarios', ({ user }) => { exigeAdmin(user); return all('SELECT id,nome,email,role,ativo,aceite_em,criado_em FROM users ORDER BY role, nome'); });
R('POST', '/api/usuarios', ({ user, body }) => {
  exigeAdmin(user);
  const email = String(body.email || '').trim().toLowerCase();
  if (!body.nome || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Informe nome e e-mail válidos.');
  if (get('SELECT 1 x FROM users WHERE email=?', email)) throw bad('Já existe um usuário com este e-mail.');
  const senha = `${rid(6)}Aa1!`;
  run('INSERT INTO users(nome,email,role,senha_hash,must_change,criado_em) VALUES(?,?,?,?,1,?)', String(body.nome).slice(0, 100), email, 'funcionario', hashPassword(senha), now());
  audit(user.id, 'usuario.criar', email);
  return { email, senha_temporaria: senha };
});
R('PATCH', '/api/usuarios/:id', ({ user, params, body }) => {
  exigeAdmin(user);
  if (+params.id === user.id) throw bad('Você não pode desativar o próprio acesso.');
  run('UPDATE users SET ativo=? WHERE id=?', bool(body.ativo), params.id);
  if (!body.ativo) run('DELETE FROM sessions WHERE user_id=?', params.id);
  audit(user.id, body.ativo ? 'usuario.ativar' : 'usuario.desativar', params.id);
  return { ok: true };
});

// --- DJEN / publicações
R('POST', '/api/djen/sync', async ({ user, body }) => {
  exigeAdmin(user);
  if (!dentroDoLimite('djen-sync', 'global', 4, 10 * 60e3)) throw new HttpError(429, 'Sincronizações demais em pouco tempo; o DJEN limita requisições por IP. Aguarde alguns minutos.');
  const dias = Math.min(Math.max(+body.dias || 30, 1), 180);
  const r = await I.djenSincronizar({ dias });
  audit(user.id, 'djen.sync', `${r.novas} novas`);
  return r;
});
R('GET', '/api/publicacoes', ({ user, req }) => {
  exigeAdmin(user);
  const u = new URL(req.url, 'http://x');
  const so = u.searchParams.get('so');
  const where = so === 'novas' ? 'WHERE p.lida=0' : so === 'sem_caso' ? 'WHERE p.caso_id IS NULL' : '';
  return {
    config: I.djenConfig(),
    total: get('SELECT COUNT(*) n FROM publicacoes').n,
    itens: all(`SELECT p.*, c.titulo caso_titulo FROM publicacoes p LEFT JOIN casos c ON c.id=p.caso_id ${where} ORDER BY p.data_disp DESC, p.id DESC LIMIT 150`),
  };
});
R('PATCH', '/api/publicacoes/:id', ({ user, params, body }) => {
  exigeAdmin(user);
  const p = get('SELECT * FROM publicacoes WHERE id=?', params.id);
  if (!p) throw new HttpError(404, 'Publicação não encontrada.');
  if ('lida' in body) run('UPDATE publicacoes SET lida=? WHERE id=?', bool(body.lida), p.id);
  if ('caso_id' in body && body.caso_id) {
    run('UPDATE publicacoes SET caso_id=? WHERE id=?', body.caso_id, p.id);
    run(`INSERT OR IGNORE INTO andamentos(caso_id,data,origem,ref,texto_original,status,criado_em) VALUES(?,?,?,?,?,'rascunho',?)`, body.caso_id, p.data_disp, 'djen', `djen:${p.hash}`, (p.texto || '').slice(0, 8000), now());
  }
  return { ok: true };
});
R('POST', '/api/publicacoes/:id/criar-caso', ({ user, params }) => {
  exigeAdmin(user);
  const p = get('SELECT * FROM publicacoes WHERE id=?', params.id);
  if (!p) throw new HttpError(404, 'Publicação não encontrada.');
  const existente = p.numero_processo && get("SELECT id FROM casos WHERE REPLACE(REPLACE(REPLACE(numero_cnj,'-',''),'.',''),' ','')=?", p.numero_processo);
  const id = existente?.id ?? tx(() => {
    const cid = run('INSERT INTO casos(titulo,numero_cnj,fase_id,criado_em,atualizado_em) VALUES(?,?,?,?,?)', `${p.classe || 'Processo'} (${p.tribunal || '?'})`, formatCnj(p.numero_processo), get('SELECT id FROM fases ORDER BY ordem LIMIT 1').id, now(), now()).id;
    run('UPDATE publicacoes SET caso_id=? WHERE numero_processo=? AND caso_id IS NULL', cid, p.numero_processo);
    for (const x of all('SELECT * FROM publicacoes WHERE caso_id=?', cid))
      run(`INSERT OR IGNORE INTO andamentos(caso_id,data,origem,ref,texto_original,status,criado_em) VALUES(?,?,?,?,?,'rascunho',?)`, cid, x.data_disp, 'djen', `djen:${x.hash}`, (x.texto || '').slice(0, 8000), now());
    return cid;
  });
  run('UPDATE publicacoes SET lida=1 WHERE id=?', p.id);
  return { caso_id: id };
});

// --- Trello
R('POST', '/api/trello/importar', async ({ user, req }) => {
  exigeAdmin(user);
  return I.importarTrello(await readJson(req, 8e6), user.id);
});

// --- add-ons (validação de interesse, sem cobrança)
const ADDONS = [
  { id: 'whatsapp', nome: 'Aviso automático ao cliente por WhatsApp', desc: 'Envia ao cliente o andamento aprovado, pela API oficial do WhatsApp (sem risco de banimento).', preco: 'Referência: setup R$ 150 + mensagens repassadas', custo: 'Meta: aprox. R$ 0,035 por mensagem de utilidade' },
  { id: 'ia_avancada', nome: 'IA avançada: documentos, chat com o processo e minutas', desc: 'Resume PDFs e peças longas, conversa com o processo e sugere rascunho de minuta. Você revisa tudo antes de usar. Pode usar a chave de IA do próprio escritório.', preco: 'Referência: R$ 79/mês (ou R$ 0 com chave própria)', custo: 'Com chave própria, o uso é cobrado direto pelo fornecedor' },
  { id: 'armazenamento', nome: '+50 GB de armazenamento', desc: 'Mais espaço para documentos dos casos.', preco: 'Referência: R$ 29/mês', custo: 'Valor fixo mensal' },
  { id: 'assinatura', nome: 'Assinatura eletrônica de contratos', desc: 'Contrato de honorários e procuração assinados pelo cliente no portal.', preco: 'Referência: sob consulta', custo: 'Depende do provedor' },
  { id: 'fonte_dados', nome: 'Fonte de dados própria (Escavador, Judit ou Vigilant)', desc: 'O escritório contrata a API de um fornecedor e informa a chave no painel; a ZACDA integra e mantém a conexão. Cobre mais tribunais e diários oficiais que o DJEN.', preco: 'Valor definido após validar o interesse', custo: 'O fornecedor é pago direto pelo escritório' },
];
// Complementos extras e detalhes por serviço (alimentam a página de cada card).
ADDONS.push(
  { id: 'resumos_extra', nome: '+100 resumos de andamento por IA', desc: 'Pacote extra de resumos em linguagem simples, quando a franquia do mês acaba.', preco: 'Referência: R$ 19 por pacote', custo: 'Valor fixo por pacote' },
  { id: 'atendente', nome: 'ZACDA Atendente: triagem no WhatsApp e dossiê', desc: 'Atende por WhatsApp quem procura o escritório, organiza o caso e entrega o dossiê para o advogado revisar. É o produto ZACDA Advocacia atual.', preco: 'A partir de R$ 397/mês + implantação R$ 1.197', custo: 'Franquia de conversas e dossiês; excedente R$ 2,00 por conversa e R$ 9,00 por dossiê' },
);
const DETALHES = {
  whatsapp: {
    como: ['Quando o advogado aprova um andamento, o cliente recebe um aviso por WhatsApp.', 'Usa a API oficial da Meta, em número dedicado do escritório.', 'Só mensagens de utilidade a clientes que já contrataram. Não envia marketing nem fala com quem não é cliente (Provimento 205).'],
    custos: [['Implantação de referência', 'R$ 150'], ['Mensagem de utilidade (Meta)', 'cerca de R$ 0,035 por mensagem'], ['Mensagem de marketing', 'não oferecida']],
    limites: 'Tabela da Meta muda; os valores acima precisam ser conferidos na tabela oficial antes de vender.' },
  ia_avancada: {
    como: ['Resume PDFs e peças longas, conversa com o processo e sugere rascunho de minuta.', 'O advogado revisa tudo antes de usar (Recomendação 001/2024 da OAB).', 'Pode usar a chave de IA do próprio escritório: o custo vai direto ao fornecedor.'],
    custos: [['Referência', 'R$ 79/mês'], ['Com a chave de IA do próprio escritório', 'R$ 0 de mensalidade; o uso é cobrado direto pelo fornecedor da chave'], ['Resumo simples de andamento', 'já incluído no plano']],
    limites: 'Em segredo de justiça a IA continua desligada.' },
  armazenamento: {
    como: ['Mais espaço para os documentos dos casos.', 'Os arquivos ficam fora da área pública e só baixam com login.'],
    custos: [['+50 GB', 'R$ 29/mês']], limites: 'Limite de 15 MB por arquivo.' },
  assinatura: {
    como: ['Contrato de honorários e procuração assinados pelo cliente dentro do portal.'],
    custos: [['Referência', 'sob consulta']], limites: 'Depende da escolha do provedor.' },
  fonte_dados: {
    como: ['O escritório contrata a API do fornecedor (Escavador, Judit ou Vigilant) e informa a chave no painel.', 'A ZACDA integra e mantém a conexão; não revende o acesso nem o dado.', 'Útil para monitorar tribunais além do DJEN, como a Justiça do Trabalho (que o Vigilant não cobre) e diários oficiais.'],
    custos: [['Integração e manutenção ZACDA', 'valor definido após validar o interesse (taxa única mais mensalidade pequena)'], ['Escavador (pago pelo escritório)', 'preço por negociação de volume'], ['Judit (pago pelo escritório)', 'a partir de R$ 1.000/mês'], ['Vigilant (pago pelo escritório)', 'por consulta: 1 crédito (R$ 0,07 a R$ 0,10) por tribunal a cada 10 processos; monitoramento custa 5 créditos por verificação']],
    limites: 'Cada fornecedor tem formato e termos próprios e o contrato é do escritório. Sem SLA do fornecedor: o prazo continua sendo conferido pelo advogado.' },
  resumos_extra: {
    como: ['Libera mais resumos em linguagem simples depois que a franquia do mês acaba.', 'Todos passam pela aprovação do advogado antes de aparecer no portal.'],
    custos: [['Pacote de +100 resumos', 'R$ 19']], limites: 'Franquia renova todo mês.' },
  atendente: {
    como: ['Atende por WhatsApp quem procura o escritório, 24 horas, e se apresenta como assistente virtual.', 'Organiza fatos, documentos e áudios e avisa o advogado em caso de urgência.', 'Gera o dossiê do caso, um rascunho que o advogado confere antes de usar.', 'Não dá parecer, não fala de honorários nem de prazo, e não faz captação ativa.'],
    custos: [['Solo', 'R$ 397/mês + R$ 1.197 (100 conversas, 25 dossiês)'], ['Escritório', 'R$ 697/mês + R$ 1.997 (250 conversas, 60 dossiês)'], ['Banca', 'R$ 1.297/mês + R$ 2.997 (500 conversas, 125 dossiês)'], ['Excedente', 'R$ 2,00 por conversa; dossiê avulso R$ 9,00 (R$ 19,00 com anexo de viabilidade)']],
    limites: 'Contrato próprio (ZACDA Advocacia). O número de WhatsApp é dedicado e a conexão não é oficial: há risco de bloqueio pelo WhatsApp.' },
};

// Plano do piloto e limites (referência: Gestão e Portal "Solo"). Ajustável por ambiente.
const PLANO = { nome: 'Piloto gratuito (Gestão e Portal)', referencia: 'Depois do piloto, referência Solo: R$ 147/mês', processos: null, usuarios: null, armazenamento_gb: 10, resumos_mes: 300 };
R('GET', '/api/plano', ({ user }) => {
  exigeAdmin(user);
  const mes = now().slice(0, 7);
  const u = {
    processos: get('SELECT COUNT(*) n FROM casos').n,
    usuarios: get("SELECT COUNT(*) n FROM users WHERE role<>'cliente' AND ativo=1").n,
    bytes: get('SELECT COALESCE(SUM(tamanho),0) n FROM documentos').n,
    resumos: get('SELECT COUNT(*) n FROM ia_uso WHERE substr(criado_em,1,7)=?', mes).n,
    clientes_portal: get("SELECT COUNT(*) n FROM users WHERE role='cliente' AND ativo=1").n,
    publicacoes: get('SELECT COUNT(*) n FROM publicacoes').n,
  };
  const cfg = I.djenConfig();
  return {
    plano: PLANO, mes,
    cobertos: [
      { nome: 'Processos acompanhados', usado: u.processos, limite: null, unidade: 'processos', extra: 'Sem limite (uso justo)', addon: null },
      { nome: 'Usuários da equipe', usado: u.usuarios, limite: null, unidade: 'usuários', extra: 'Sem limite (uso justo)', addon: null },
      { nome: 'Armazenamento de documentos', usado: u.bytes, limite: PLANO.armazenamento_gb * 1073741824, unidade: 'bytes', extra: 'Acima do limite: +50 GB por R$ 29/mês', addon: 'armazenamento' },
      { nome: 'Resumos de andamento por IA (este mês)', usado: u.resumos, limite: PLANO.resumos_mes, unidade: 'resumos', extra: 'Acima do limite: +100 resumos por R$ 19', addon: 'resumos_extra' },
      { nome: 'Clientes com acesso ao portal', usado: u.clientes_portal, limite: null, unidade: 'clientes', extra: 'Sem limite', addon: null },
      { nome: `Publicações do DJEN (OAB ${cfg.oab}/${cfg.uf})`, usado: u.publicacoes, limite: null, unidade: 'publicações', extra: 'Fonte pública do CNJ, sem custo por consulta', addon: null },
    ],
    inclusos: ['Kanban de casos e importação do Trello', 'CRM leve (leads e clientes)', 'Documentos por caso, com download autenticado', 'Prazos e agenda de lembretes internos', 'Portal do cliente com linha do tempo em linguagem simples', 'Auditoria de acessos', 'Aprovação do advogado antes de qualquer texto aparecer ao cliente'],
    fora: ADDONS.map((a) => ({ id: a.id, nome: a.nome, preco: a.preco, custo: a.custo })),
  };
});
R('GET', '/api/addons', ({ user }) => {
  exigeAdmin(user);
  const meus = new Set(all('SELECT DISTINCT addon FROM addon_interesse WHERE user_id=?', user.id).map((x) => x.addon));
  const cont = Object.fromEntries(all('SELECT addon, COUNT(*) n FROM addon_interesse GROUP BY addon').map((x) => [x.addon, x.n]));
  return ADDONS.map((a) => ({ ...a, ...(DETALHES[a.id] || {}), tenho_interesse: meus.has(a.id), cliques: cont[a.id] || 0 }));
});
R('POST', '/api/addons/:id/interesse', ({ user, params }) => {
  exigeAdmin(user);
  if (!ADDONS.some((a) => a.id === params.id)) throw new HttpError(404, 'Add-on desconhecido.');
  run('INSERT INTO addon_interesse(addon,user_id,criado_em) VALUES(?,?,?)', params.id, user.id, now());
  audit(user.id, 'addon.interesse', params.id);
  // sinal de venda para a ZACDA: e-mail em segundo plano, sem atrasar nem derrubar a resposta
  const add = ADDONS.find((a) => a.id === params.id);
  avisaInteresse({ addon: add.nome, quem: user.nome, total: get('SELECT COUNT(*) n FROM addon_interesse WHERE addon=?', params.id).n, totalGeral: get('SELECT COUNT(*) n FROM addon_interesse').n });
  return { ok: true };
});
R('GET', '/api/auditoria', ({ user }) => { exigeAdmin(user); return all('SELECT a.*, u.nome FROM auditoria a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200').map(descreveAuditoria); });

// --- portal do cliente
function exigeCliente(u) {
  if (!u || u.role !== 'cliente') throw new HttpError(401, 'Faça login.');
  if (!u.aceite_em) throw new HttpError(403, 'aceite');
}
R('GET', '/api/portal/casos', ({ user }) => {
  exigeCliente(user);
  return all(`SELECT c.id, c.titulo, c.area, f.nome fase, c.numero_cnj,
                (SELECT MAX(data) FROM andamentos WHERE caso_id=c.id AND status='aprovado' AND visivel_cliente=1) ultimo
              FROM casos c JOIN fases f ON f.id=c.fase_id WHERE c.cliente_id=? ORDER BY c.atualizado_em DESC`, user.cliente_id);
});
R('GET', '/api/portal/casos/:id', ({ user, params }) => {
  exigeCliente(user);
  const c = get('SELECT c.id, c.titulo, c.area, c.numero_cnj, f.nome fase FROM casos c JOIN fases f ON f.id=c.fase_id WHERE c.id=? AND c.cliente_id=?', params.id, user.cliente_id);
  if (!c) throw new HttpError(404, 'Caso não encontrado.');
  audit(user.id, 'portal.ver_caso', params.id);
  return {
    caso: c,
    aviso_sem_novidade: avisoSemNovidade(c.id),
    andamentos: all("SELECT id, data, texto_simples, ia FROM andamentos WHERE caso_id=? AND status='aprovado' AND visivel_cliente=1 ORDER BY data DESC, id DESC", c.id),
    documentos: all('SELECT id, nome, tamanho, criado_em FROM documentos WHERE caso_id=? AND visivel_cliente=1 ORDER BY id DESC', c.id),
  };
});

/* ----------------------------------------------------------------- servidor */
const PAGINAS = { '/login': 'login.html', '/painel': 'equipe.html', '/portal': 'portal.html' };
const LIVRES_TROCA = new Set(['/api/me', '/api/auth/senha', '/api/auth/logout']);
const LIVRES_CONTRATO = new Set([...LIVRES_TROCA, '/api/contrato', '/api/contrato/aceite']);

// Retenção: sessões vencidas e auditoria antiga (Marco Civil, art. 15: registros de acesso por no mínimo 6 meses).
const AUDITORIA_DIAS = Math.max(+process.env.AUDIT_RETENTION_DAYS || 365, 183);
function limpezaPeriodica() {
  try {
    const s = run('DELETE FROM sessions WHERE expira_em < ?', now()).changes;
    const a = run('DELETE FROM auditoria WHERE criado_em < ?', new Date(Date.now() - AUDITORIA_DIAS * 864e5).toISOString()).changes;
    if (s || a) console.log(`Limpeza: ${s} sessões vencidas, ${a} registros de auditoria com mais de ${AUDITORIA_DIAS} dias.`);
  } catch (e) { console.error('Falha na limpeza periódica', e); }
}
limpezaPeriodica();
setInterval(limpezaPeriodica, 6 * 3600e3).unref();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  if (PROD || req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  try {
    // arquivos de interface do painel (públicos, sem dados)
    if (pathname.startsWith('/painel-assets/')) {
      const f = path.resolve(ASSET_UI, pathname.slice('/painel-assets/'.length));
      if (f.startsWith(ASSET_UI + path.sep) && servirArquivo(res, f, { csp: true })) return;
      return send(res, 404, 'Não encontrado');
    }
    // páginas
    if (PAGINAS[pathname]) {
      const u = userFromReq(req);
      if (pathname === '/login' && u) return send(res, 302, '', { Location: u.role === 'cliente' ? '/portal' : '/painel' });
      if (pathname === '/painel' && !isStaff(u)) return send(res, 302, '', { Location: '/login' });
      if (pathname === '/portal' && (!u || u.role !== 'cliente')) return send(res, 302, '', { Location: '/login' });
      servirArquivo(res, path.join(ASSET_UI, PAGINAS[pathname]), { csp: true });
      return;
    }
    // API
    if (pathname.startsWith('/api/')) {
      const rota = routes.find((r) => r.method === req.method && r.re.test(pathname));
      if (!rota) throw new HttpError(404, 'Rota não encontrada.');
      if (req.method !== 'GET') {
        const origin = req.headers.origin;
        if (req.headers['x-requested-with'] !== 'fetch' || (origin && (() => { try { return new URL(origin).host !== req.headers.host; } catch { return true; } })())) throw new HttpError(403, 'Requisição bloqueada (CSRF).');
      }
      if (!dentroDoLimite('api', ipDoCliente(req), 300, 60e3)) throw new HttpError(429, 'Muitas requisições. Aguarde um minuto.');
      const user = userFromReq(req);
      // senha temporária: só trocar a senha, ver a sessão e sair
      if (user?.must_change && !LIVRES_TROCA.has(pathname)) throw new HttpError(403, 'trocar_senha');
      // equipe: o contrato precisa estar aceito (pelo advogado) antes de usar o painel
      if (isStaff(user) && !LIVRES_CONTRATO.has(pathname) && !contratoAceito()) throw new HttpError(403, 'contrato');
      const params = rota.re.exec(pathname).groups || {};
      const body = req.method === 'POST' || req.method === 'PATCH' ? (/json/.test(req.headers['content-type'] || '') && !/importar$/.test(pathname) ? await readJson(req) : {}) : {};
      const out = await rota.fn({ req, res, user, params, body });
      if (out === undefined) return;
      return sendJson(res, out);
    }
    // site estático do escritório
    if (req.method === 'GET' && servirSite(res, pathname)) return;
    send(res, 404, 'Página não encontrada', { 'Content-Type': 'text/plain; charset=utf-8' });
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (res.headersSent) return res.end();
    sendJson(res, { erro: status === 500 ? 'Erro interno.' : e.message }, status);
  }
});

server.listen(PORT, () => {
  console.log(`\nPainel do escritório em http://localhost:${PORT}/login   (site: http://localhost:${PORT}/)`);
  console.log(`IA: ${I.iaAtiva() ? `ativa (${I.IA_MODELO})` : 'DESATIVADA (sem ANTHROPIC_API_KEY)'} | DataJud: ${I.datajudAtivo() ? 'ativo' : 'desativado (sem DATAJUD_API_KEY)'} | DJEN: OAB ${I.djenConfig().oab}/${I.djenConfig().uf}`);
  if (demoCreds) console.log(`\nDADOS FICTÍCIOS CRIADOS. Senha de todos: ${DEMO.senha}\n  admin: ${DEMO.admin}\n  funcionário: ${DEMO.funcionario}\n  cliente: ${DEMO.cliente}\n`);
});
