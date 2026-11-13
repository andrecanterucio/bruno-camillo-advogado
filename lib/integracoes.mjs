import { all, get, run, now, tx } from './db.mjs';
import { digits, formatCnj, aliasDatajud, stripHtml, sleep } from './util.mjs';

/** Erro de integração externa ou de configuração: a mensagem é segura para mostrar ao usuário. */
export class ErroInteg extends Error { constructor(m, status = 502) { super(m); this.status = status; } }

/** Segredo de justiça indicado pela fonte pública: marca o caso e bloqueia a IA (cláusula 9A.4 do contrato). */
const RE_SIGILO = /segredo\s+de\s+justi[cç]a|tramita(?:ndo)?\s+(?:em|sob)\s+sigilo|processo\s+sigiloso|sigilo\s+(?:de\s+justi[cç]a|processual)/i;
export function marcaSegredo(casoId, motivo) {
  const c = get('SELECT segredo FROM casos WHERE id=?', casoId);
  if (!c || c.segredo) return false;
  run('UPDATE casos SET segredo=1, ia_habilitada=0, atualizado_em=? WHERE id=?', now(), casoId);
  run('UPDATE ia_caso_consentimento SET revogado_em=? WHERE caso_id=? AND revogado_em IS NULL', now(), casoId);
  run('INSERT INTO auditoria(user_id, acao, alvo, criado_em) VALUES(NULL,?,?,?)', 'caso.segredo_automatico', `${casoId}: ${motivo}`, now());
  return true;
}
export const indicaSigilo = (t) => RE_SIGILO.test(String(t || ''));

/* ------------------------------------------------------------------ DJEN */
// API pública do CNJ (Comunica PJe). Grátis, sem login. Bloqueia IP fora do Brasil
// (403) e limita ~20 req por janela por IP. A mesma OAB aparece com sufixos diferentes.
const DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';

export const djenConfig = () => ({
  oab: process.env.DJEN_OAB || '56739',
  uf: process.env.DJEN_UF || 'DF',
  variantes: (process.env.DJEN_OAB_VARIANTES || ',A').split(',').map((s) => s.trim()), // '' = sem sufixo
});

async function djenPagina(params, tentativa = 0) {
  const r = await fetch(`${DJEN}?${new URLSearchParams(params)}`, {
    headers: { 'user-agent': 'painel-advogado/1.0' }, signal: AbortSignal.timeout(30000),
  });
  if (r.status === 429 && tentativa < 2) { await sleep(61000); return djenPagina(params, tentativa + 1); }
  if (r.status === 403) throw new ErroInteg('DJEN bloqueou o acesso (403): o servidor precisa ter IP do Brasil.');
  if (!r.ok) throw new ErroInteg(`DJEN respondeu HTTP ${r.status}`);
  return r.json();
}

export async function djenSincronizar({ dias = 30 } = {}) {
  const { oab, uf, variantes } = djenConfig();
  const fim = new Date().toISOString().slice(0, 10);
  const ini = new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10);
  let lidas = 0, novas = 0, vinculadas = 0;
  for (const v of variantes) {
    for (let pagina = 1; pagina <= 100; pagina++) {
      const j = await djenPagina({
        numeroOab: oab + v, ufOab: uf, dataDisponibilizacaoInicio: ini, dataDisponibilizacaoFim: fim,
        pagina, itensPorPagina: 100,
      });
      const itens = j.items || [];
      for (const it of itens) {
        lidas++;
        if (it.ativo === false || it.status === 'C' || it.data_cancelamento) continue;
        const hash = it.hash || `djen:${it.id}`;
        if (get('SELECT 1 x FROM publicacoes WHERE hash=?', hash)) continue;
        const proc = digits(it.numero_processo);
        const caso = proc ? get("SELECT id FROM casos WHERE REPLACE(REPLACE(REPLACE(numero_cnj,'-',''),'.',''),' ','')=?", proc) : null;
        run(`INSERT INTO publicacoes(hash, numero_processo, tribunal, orgao, tipo, classe, data_disp, texto, link, caso_id, criado_em)
             VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          hash, proc, it.siglaTribunal, it.nomeOrgao, it.tipoComunicacao, it.nomeClasse,
          it.data_disponibilizacao, stripHtml(it.texto || '').slice(0, 20000), it.link, caso?.id ?? null, now());
        novas++;
        if (caso) {
          vinculadas++;
          if (indicaSigilo(it.texto) || indicaSigilo(it.nomeClasse)) marcaSegredo(caso.id, 'DJEN indica sigilo');
          run(`INSERT OR IGNORE INTO andamentos(caso_id, data, origem, ref, texto_original, status, criado_em)
               VALUES(?,?,?,?,?,'rascunho',?)`,
            caso.id, it.data_disponibilizacao, 'djen', `djen:${hash}`, stripHtml(it.texto || '').slice(0, 8000), now());
        }
      }
      if (itens.length < 100 || pagina * 100 >= (j.count || 0)) break;
      await sleep(1200);
    }
    await sleep(1200);
  }
  return { lidas, novas, vinculadas, janela: `${ini} a ${fim}`, oab: `${oab} (${variantes.map((v) => oab + v).join(', ')})` };
}

/* --------------------------------------------------------------- DataJud */
// Exige chave pública do CNJ (DATAJUD_API_KEY). Metadados e movimentações, com defasagem.
// O Termo de Uso da API Pública (CNJ, V1.2) veda uso comercial e exploração comercial de informação derivada
// (itens 3.3 e 3.8) sem autorização escrita do CNJ. Por isso a chave sozinha não basta: é preciso
// DATAJUD_AUTORIZADO=1, que só deve ser definido depois de obter essa autorização.
export const datajudAtivo = () => !!process.env.DATAJUD_API_KEY && process.env.DATAJUD_AUTORIZADO === '1';
export const datajudBloqueadoPorTermo = () => !!process.env.DATAJUD_API_KEY && process.env.DATAJUD_AUTORIZADO !== '1';

export async function datajudSincronizar(caso) {
  if (!datajudAtivo()) throw new ErroInteg(datajudBloqueadoPorTermo()
    ? 'DataJud desativado: o Termo de Uso do CNJ (itens 3.3 e 3.8) proíbe uso comercial sem autorização escrita. Defina DATAJUD_AUTORIZADO=1 só depois de obtê-la.'
    : 'DataJud desativado: defina DATAJUD_API_KEY (chave pública do CNJ) em .env.local.', 503);
  const alias = aliasDatajud(caso.numero_cnj);
  if (!alias) throw new ErroInteg('Número CNJ inválido ou tribunal sem alias no DataJud.', 400);
  const r = await fetch(`https://api-publica.datajud.cnj.jus.br/api_publica_${alias}/_search`, {
    method: 'POST',
    headers: { Authorization: `APIKey ${process.env.DATAJUD_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ size: 10, query: { match: { numeroProcesso: digits(caso.numero_cnj) } } }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new ErroInteg(`DataJud respondeu HTTP ${r.status}`);
  const j = await r.json();
  if (j._shards?.failed > 0) throw new ErroInteg('DataJud devolveu resposta parcial; tente de novo.');
  const fontes = (j.hits?.hits || []).map((h) => h._source).filter(Boolean);
  if (!fontes.length) return { encontrados: 0, novos: 0 };
  if (fontes.some((f) => Number(f.nivelSigilo) > 0)) marcaSegredo(caso.id, 'DataJud nivelSigilo>0');
  let novos = 0, total = 0;
  for (const src of fontes) {
    for (const m of src.movimentos || []) {
      total++;
      const compl = (m.complementosTabelados || []).map((c) => c.nome).filter(Boolean).join('; ');
      const texto = compl ? `${m.nome} (${compl})` : m.nome;
      const ref = `datajud:${digits(caso.numero_cnj)}:${src.grau || ''}:${m.codigo}:${m.dataHora}`;
      const res = run(`INSERT OR IGNORE INTO andamentos(caso_id, data, origem, ref, texto_original, status, criado_em)
                       VALUES(?,?,?,?,?,'rascunho',?)`, caso.id, String(m.dataHora).slice(0, 10), 'datajud', ref, texto, now());
      novos += res.changes;
    }
  }
  const p = fontes[0];
  return { encontrados: total, novos, graus: fontes.map((f) => f.grau).filter(Boolean).join(', '), classe: p.classe?.nome, orgao: p.orgaoJulgador?.nome };
}

/* ----------------------------------------------------------------- IA (Haiku) */
export const IA_MODELO = process.env.AI_MODEL || 'claude-haiku-5-5';
export const iaAtiva = () => !!process.env.ANTHROPIC_API_KEY;

// Remove identificadores antes de enviar ao modelo (melhor esforço, não é anonimização total).
export function mascarar(t = '') {
  return String(t)
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[CNPJ]')
    .replace(/\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[TELEFONE]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[EMAIL]')
    .replace(
      /\b(EXEQUENTE|EXECUTADO|EXECUTADA|AUTOR|AUTORA|RÉU|REU|RÉ|REQUERENTE|REQUERIDO|REQUERIDA|IMPETRANTE|IMPETRADO|RECLAMANTE|RECLAMADO|RECLAMADA|APELANTE|APELADO|AGRAVANTE|AGRAVADO|EMBARGANTE|EMBARGADO|INTERESSADO|ASSISTIDO|SENTENCIADO|APENADO|REEDUCANDO|PACIENTE|ADVOGADO|ADVOGADA)(\(A\))?\s*:\s*[^:\n]{1,120}?(?=\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{4,}\s*:|\n|$)/gi,
      (_m, l) => `${l}: [parte]`)
    .slice(0, 6000);
}

const SISTEMA = `Você explica andamentos de processos judiciais brasileiros para o cliente do advogado, uma pessoa leiga.
Regras:
- Português do Brasil, linguagem simples, 2 a 4 frases curtas, sem juridiquês (se um termo técnico for inevitável, explique entre parênteses).
- Diga o que aconteceu e o que isso significa na prática. Se houver prazo ou algo que o cliente deva fazer, diga que o advogado vai orientar.
- Nunca prometa resultado, nunca estime chance de ganhar, nunca invente fatos ou datas que não estejam no texto.
- Use a "Posição do cliente no processo" informada para falar corretamente com ele ("você propôs" só se for autor; "você foi processado" só se for réu). Nunca presuma a posição do cliente a partir do texto.
- Não repita nomes, CPF, CNPJ, valores sigilosos ou dados pessoais; use "você" ou "a outra parte".
- Se o texto for rotina (juntada, conclusão, remessa), diga isso com naturalidade e tranquilize sem exagero.
- Responda somente com o texto para o cliente, sem títulos, listas nem aviso de IA.`;

const PAPEIS = { autor: 'autor (quem propôs a ação)', reu: 'réu (quem foi processado)', outro: 'outra posição (terceiro, interessado, assistido ou apenado)' };

export async function traduzirAndamento({ texto, area, casoId, papel }) {
  if (!iaAtiva()) throw new ErroInteg('IA desativada: defina ANTHROPIC_API_KEY em .env.local.', 503);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: IA_MODELO, max_tokens: 400, system: SISTEMA,
      messages: [{ role: 'user', content: `Área do caso: ${area || 'não informada'}\nPosição do cliente no processo: ${PAPEIS[papel] || 'não informada'}\n\nAndamento (texto do tribunal):\n${mascarar(texto)}` }],
    }),
    signal: AbortSignal.timeout(45000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErroInteg(`IA respondeu HTTP ${r.status}: ${j.error?.message || 'erro'}`);
  const out = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!out) throw new ErroInteg('A IA não devolveu texto.');
  run('INSERT INTO ia_uso(caso_id, modelo, tokens_in, tokens_out, criado_em) VALUES(?,?,?,?,?)',
    casoId, IA_MODELO, j.usage?.input_tokens ?? 0, j.usage?.output_tokens ?? 0, now());
  return out;
}

export function iaResumoUso() {
  const u = get('SELECT COUNT(*) n, COALESCE(SUM(tokens_in),0) tin, COALESCE(SUM(tokens_out),0) tout FROM ia_uso');
  const usd = (u.tin * 0.10 + u.tout * 0.50) / 1e6; // Haiku 5.5 (≤100K de contexto)
  return { resumos: u.n, tokens_in: u.tin, tokens_out: u.tout, custo_estimado_brl: +(usd * 5.5).toFixed(4), modelo: IA_MODELO };
}

/* ----------------------------------------------------------------- Trello */
const CNJ_FIND = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}|\b\d{20}\b/;
const AREAS = [['penal', 'Penal'], ['execu', 'Penal'], ['trabalh', 'Trabalho'], ['famíl', 'Família e Sucessões'], ['famil', 'Família e Sucessões'],
  ['sucess', 'Família e Sucessões'], ['invent', 'Família e Sucessões'], ['consum', 'Civil e Consumidor'], ['cível', 'Civil e Consumidor'], ['civel', 'Civil e Consumidor']];

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// "2026-11-17T12:00:00.000Z" (UTC, como o Trello exporta) -> data e hora de Brasília
function dueBRT(due) {
  const t = Date.parse(due);
  if (!Number.isFinite(t)) return null;
  const iso = new Date(t - 3 * 3600e3).toISOString();
  return { data: iso.slice(0, 10), hora: iso.slice(11, 16) };
}

export function importarTrello(board, userId) {
  if (!board || !Array.isArray(board.lists) || !Array.isArray(board.cards)) throw new ErroInteg('Arquivo não parece uma exportação JSON do Trello.', 400);
  return tx(() => {
    // colunas: reaproveita a existente com o mesmo nome (sem diferenciar maiúsculas, acentos e pontuação)
    const existentes = new Map(all('SELECT id, nome FROM fases ORDER BY ordem').map((f) => [norm(f.nome), f.id]));
    const listas = new Map();
    let ordem = (get('SELECT COALESCE(MAX(ordem),-1) m FROM fases').m) + 1;
    for (const l of board.lists.filter((x) => !x.closed)) {
      let id = existentes.get(norm(l.name));
      if (!id) { id = run('INSERT INTO fases(nome, ordem) VALUES(?,?)', String(l.name).trim().slice(0, 60), ordem++).id; existentes.set(norm(l.name), id); }
      listas.set(l.id, id);
    }
    // membros do Trello -> pessoas da equipe, pelo nome (o Trello não exporta e-mail)
    const equipe = all("SELECT id, nome FROM users WHERE ativo=1 AND role IN ('admin','funcionario')");
    const porNome = new Map(equipe.map((u) => [norm(u.nome), u.id]));
    const membroDe = new Map(); const naoReconhecidos = new Set();
    for (const m of board.members || []) {
      const id = porNome.get(norm(m.fullName)) ?? porNome.get(norm(m.username));
      if (id) membroDe.set(m.id, id); else naoReconhecidos.add(m.fullName || m.username);
    }
    let casos = 0, prazos = 0, sensiveis = 0, ignorados = 0;
    for (const c of board.cards.filter((x) => !x.closed && listas.has(x.idList))) {
      // importar o mesmo arquivo de novo não duplica: o cartão do Trello já importado é pulado
      if (c.id && get('SELECT 1 x FROM casos WHERE trello_id=?', String(c.id))) { ignorados++; continue; }
      const base = `${c.name} ${c.desc || ''}`;
      const cnj = (base.match(CNJ_FIND) || [])[0];
      const etiquetas = (c.labels || []).map((l) => l.name).filter(Boolean).join(', ');
      const low = `${base} ${etiquetas}`.toLowerCase();
      const area = (AREAS.find(([k]) => low.includes(k)) || [])[1] || null;
      const id = run(`INSERT INTO casos(titulo, numero_cnj, area, fase_id, etiquetas, notas, ordem, trello_id, criado_em, atualizado_em)
                      VALUES(?,?,?,?,?,?,?,?,?,?)`,
        String(c.name).slice(0, 200), cnj ? formatCnj(cnj) : null, area, listas.get(c.idList), etiquetas || null,
        (c.desc || '').slice(0, 4000) || null, casos, c.id ? String(c.id) : null, now(), now()).id;
      casos++;
      if (area === 'Penal' || area === 'Família e Sucessões') sensiveis++;
      for (const mid of new Set((c.idMembers || []).map((x) => membroDe.get(x)).filter(Boolean))) run('INSERT OR IGNORE INTO casos_membros(caso_id, user_id) VALUES(?,?)', id, mid);
      const d = c.due ? dueBRT(c.due) : null;
      if (d) {
        run('INSERT INTO prazos(caso_id, titulo, data, hora, avisar, concluido, criado_em) VALUES(?,?,?,?,?,?,?)', id, String(c.name).slice(0, 200), d.data, d.hora, '[1440]', c.dueComplete ? 1 : 0, now()); prazos++;
      }
    }
    run('INSERT INTO auditoria(user_id, acao, alvo, criado_em) VALUES(?,?,?,?)', userId, 'trello.importar', `${casos} casos, ${ignorados} já importados`, now());
    return { casos, prazos, colunas: listas.size, sensiveis, ignorados, membros_nao_reconhecidos: [...naoReconhecidos].slice(0, 20) };
  });
}
