// Utilidades de interface. Nada de innerHTML com dado do servidor: tudo vira nó de texto.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'draggable') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) return c.forEach(add);
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

export async function api(path, { method = 'GET', body, raw, headers } = {}) {
  const opt = { method, headers: { 'x-requested-with': 'fetch', ...(headers || {}) }, credentials: 'same-origin' };
  if (raw !== undefined) opt.body = raw;
  else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['content-type'] = 'application/json'; }
  const r = await fetch(path, opt);
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.startsWith('/api/auth/login')) { location.href = '/login'; throw new Error('Sessão expirada.'); }
  if (!r.ok) { const e = new Error(j.erro || `Erro ${r.status}`); e.status = r.status; throw e; }
  return j;
}

export function toast(msg, tipo = '') {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
  const t = h('div', { class: `toast ${tipo}`, role: 'status' }, msg);
  box.append(t);
  setTimeout(() => t.remove(), tipo === 'bad' ? 7000 : 4000);
}

export const fmtData = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
export const fmtBytes = (n) => (n >= 1073741824 ? `${+(n / 1073741824).toFixed(1)} GB` : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const AREAS = ['Penal', 'Civil e Consumidor', 'Família e Sucessões', 'Trabalho', 'Outros'];

/** Caixa de diálogo acessível. acoes: [{texto, classe, onclick: async () => true|false}] (true fecha). */
export function modal({ titulo, corpo, acoes = [], fechavel = true, larga = false, foco = true }) {
  const anterior = document.activeElement;
  const shade = h('div', { class: 'shade modal-shade' });
  const msg = h('p', { class: 'notice bad small', role: 'alert', hidden: true });
  const botoes = h('div', { class: 'row modal-acoes' });
  const box = h('div', { class: `modal ${larga ? 'larga' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
    h('header', {}, h('h2', {}, titulo), fechavel ? h('button', { class: 'btn sm ghost right', type: 'button', 'aria-label': 'Fechar', onclick: () => fechar() }, 'Fechar') : null),
    h('div', { class: 'modal-corpo' }, corpo), msg, botoes);
  function fechar() { document.removeEventListener('keydown', tecla); shade.remove(); box.remove(); anterior?.focus?.(); }
  function tecla(e) { if (e.key === 'Escape' && fechavel) fechar(); }
  const btns = acoes.map((a) => h('button', { type: 'button', class: `btn ${a.classe || ''}`, disabled: a.desabilitado, onclick: async (e) => {
    // guarda o botão: e.currentTarget vira null depois do primeiro await e travava o botão após um erro
    const btn = e.currentTarget;
    msg.hidden = true; btn.disabled = true;
    try { if (await a.onclick?.()) fechar(); }
    catch (err) { msg.textContent = err.message || String(err); msg.hidden = false; msg.scrollIntoView?.({ block: 'nearest' }); }
    finally { if (document.body.contains(box)) btn.disabled = false; }
  } }, a.texto));
  botoes.append(...btns);
  if (fechavel) shade.addEventListener('click', fechar);
  document.addEventListener('keydown', tecla);
  document.body.append(shade, box);
  // foco no 1º campo; em diálogos longos (contrato) não, para não rolar o texto para longe do começo
  if (foco) (box.querySelector('input,select,textarea,button:not(.ghost)') || box).focus?.();
  else box.querySelector('.modal-corpo')?.scrollTo?.(0, 0);
  return { fechar, caixa: box, botoes: btns, erro: (t) => { msg.textContent = t; msg.hidden = false; } };
}

/** Confirmação simples. Devolve Promise<boolean>. */
export function confirmar(titulo, texto, rotulo = 'Confirmar', perigo = false) {
  return new Promise((resolve) => {
    let feito = false;
    const m = modal({ titulo, corpo: h('p', {}, texto), acoes: [
      { texto: rotulo, classe: perigo ? 'danger' : 'gold', onclick: async () => { feito = true; resolve(true); return true; } },
      { texto: 'Cancelar', classe: 'ghost', onclick: async () => true }], fechavel: true });
    const obs = new MutationObserver(() => { if (!document.body.contains(m.caixa)) { obs.disconnect(); if (!feito) resolve(false); } });
    obs.observe(document.body, { childList: true });
  });
}

/** Negrito, itálico e código em linha, como nós de texto seguros (sem innerHTML). */
export function inlineMd(texto) {
  return String(texto).split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g).filter(Boolean).map((p) =>
    p.startsWith('**') ? h('strong', {}, p.slice(2, -2)) : p.startsWith('`') ? h('code', {}, p.slice(1, -1)) : /^\*[^*]/.test(p) && p.endsWith('*') ? h('em', {}, p.slice(1, -1)) : p);
}

/** Markdown mínimo e seguro (títulos, parágrafos, listas, citações, tabelas, negrito, itálico, código). */
export function renderMarkdown(texto) {
  const raiz = h('div', { class: 'doc' });
  const inline = (s) => String(s).split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g).filter(Boolean).map((p) =>
    p.startsWith('**') ? h('strong', {}, p.slice(2, -2)) : p.startsWith('`') ? h('code', {}, p.slice(1, -1)) : /^\*[^*]/.test(p) && p.endsWith('*') ? h('em', {}, p.slice(1, -1)) : p);
  const linhas = String(texto).replace(/\r/g, '').split('\n');
  let i = 0;
  while (i < linhas.length) {
    const l = linhas[i];
    if (!l.trim() || /^-{3,}$/.test(l.trim())) { i++; continue; }
    const t = l.match(/^(#{1,3})\s+(.*)$/);
    if (t) { raiz.append(h(`h${t[1].length + 1}`, {}, inline(t[2]))); i++; continue; }
    if (l.trim().startsWith('|')) {
      const bloco = [];
      while (i < linhas.length && linhas[i].trim().startsWith('|')) bloco.push(linhas[i++]);
      const cel = (x) => x.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const dados = bloco.filter((x) => !/^\|\s*:?-{2,}/.test(x.trim()));
      const [cab, ...resto] = dados;
      raiz.append(h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, cel(cab).map((c) => h('th', {}, inline(c))))), h('tbody', {}, resto.map((r) => h('tr', {}, cel(r).map((c) => h('td', {}, inline(c)))))))));
      continue;
    }
    if (/^\s*-\s+/.test(l)) {
      const ul = h('ul', {});
      while (i < linhas.length && /^\s*-\s+/.test(linhas[i])) ul.append(h('li', {}, inline(linhas[i++].replace(/^\s*-\s+/, ''))));
      raiz.append(ul); continue;
    }
    if (l.trim().startsWith('>')) {
      const q = [];
      while (i < linhas.length && linhas[i].trim().startsWith('>')) q.push(linhas[i++].replace(/^\s*>\s?/, ''));
      raiz.append(h('blockquote', {}, inline(q.join(' ')))); continue;
    }
    const par = [];
    while (i < linhas.length && linhas[i].trim() && !/^(#{1,3}\s|\||\s*-\s+|>)/.test(linhas[i])) par.push(linhas[i++]);
    raiz.append(h('p', {}, inline(par.join(' '))));
  }
  return raiz;
}

/** Troca de senha. Em modo forçado (senha temporária) não dá para fechar. */
export function senhaDialog({ forcado = false } = {}) {
  const atual = h('input', { type: 'password', autocomplete: 'current-password' });
  const nova = h('input', { type: 'password', autocomplete: 'new-password' });
  modal({
    titulo: forcado ? 'Defina a sua senha' : 'Alterar senha', fechavel: !forcado,
    corpo: h('div', { class: 'stack' },
      forcado ? h('p', { class: 'notice small' }, 'Você entrou com uma senha temporária. Defina uma senha só sua para continuar.') : null,
      h('div', {}, h('label', {}, 'Senha atual'), atual),
      h('div', {}, h('label', {}, 'Nova senha'), nova, h('p', { class: 'small muted' }, 'Mínimo de 10 caracteres, com maiúscula, minúscula, número e caractere especial.'))),
    acoes: [
      { texto: 'Salvar', classe: 'gold', onclick: async () => { await api('/api/auth/senha', { method: 'POST', body: { atual: atual.value, nova: nova.value } }); toast('Senha alterada.', 'ok'); if (forcado) location.reload(); return true; } },
      ...(forcado ? [{ texto: 'Sair', classe: 'ghost', onclick: async () => { await sair(); return true; } }] : [{ texto: 'Cancelar', classe: 'ghost', onclick: async () => true }])],
  });
}

export async function sair() { await api('/api/auth/logout', { method: 'POST' }); location.href = '/login'; }
