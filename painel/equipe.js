import { h, api, toast, fmtData, fmtBytes, AREAS, senhaDialog, sair, modal, confirmar, renderMarkdown, inlineMd } from './common.js';

const main = document.getElementById('main');
let me;

const ROTAS = [
  ['inicio', 'Início', null], ['casos', 'Casos (kanban)', null], ['clientes', 'Clientes e leads', null],
  ['publicacoes', 'Publicações DJEN', 'admin'], ['trello', 'Importar do Trello', 'admin'], ['plano', 'Meu plano e consumo', 'admin'], ['addons', 'Add-ons', 'admin'],
  ['equipe', 'Equipe e acessos', 'admin'], ['auditoria', 'Auditoria', 'admin'],
];

const erro = (e) => toast(e.message || String(e), 'bad');
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { erro(e); } };
const secao = (titulo, ...extra) => h('div', { class: 'head' }, h('h1', {}, titulo), h('div', { class: 'row right' }, ...extra));
const campo = (rotulo, el) => h('div', {}, h('label', {}, rotulo), el);
const opt = (v, t, sel) => h('option', { value: v ?? '', selected: sel }, t);
const loading = () => main.replaceChildren(h('p', { class: 'muted' }, 'Carregando...'));

/* ------------------------------------------------------------- navegação */
function montaNav() {
  const nav = document.getElementById('nav');
  nav.replaceChildren(...ROTAS.filter(([, , r]) => !r || r === me.role).map(([id, t]) => h('a', { href: `#/${id}`, 'data-r': id }, t)));
}
async function rota() {
  const id = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'inicio';
  const def = ROTAS.find(([r, , papel]) => r === id && (!papel || papel === me.role)) || ROTAS[0];
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === def[0]));
  loading();
  try { await VIEWS[def[0]](); } catch (e) { main.replaceChildren(h('p', { class: 'notice bad' }, e.message)); }
}

/* --------------------------------------------- contrato e termos (aceite por clique) */
const hojeISO = () => new Date().toISOString().slice(0, 10);

/** Pronto para avançar? Habilita o botão principal só quando tudo está preenchido (como o aceite do zacda-app). */
const prontoPara = (botao, fn) => () => { if (botao) botao.disabled = !fn(); };
const todosMarcados = (checks) => Object.values(checks).every((k) => k.checked);

/**
 * Contrato de Gestão, no mesmo desenho do aceite do zacda-app: resumo em destaque, contrato em caixa rolável,
 * identificação, concordância e as três ciências separadas. O botão só habilita com tudo pronto.
 */
async function contratoDialog() {
  const c = await api('/api/contrato');
  const caixa = h('div', { class: 'docbox', tabindex: 0, 'aria-label': 'Texto do contrato' }, renderMarkdown(c.corpo || c.texto));
  const status = h('p', { class: 'small muted' }, '↓ Role o contrato até o fim para habilitar o aceite');
  const nome = h('input', { autocomplete: 'name', placeholder: 'Seu nome completo' }), cpf = h('input', { inputmode: 'numeric', placeholder: '000.000.000-00' }), oab = h('input', { placeholder: 'OAB/UF nº' });
  const geral = h('input', { type: 'checkbox', disabled: true });
  const checks = Object.fromEntries(c.ciencias.map((x) => [x.id, h('input', { type: 'checkbox', disabled: true })]));
  let rolou = false, botao = null;
  const pronto = () => rolou && nome.value.trim().length >= 3 && cpf.value.replace(/\D/g, '').length === 11 && oab.value.trim().length >= 3 && geral.checked && todosMarcados(checks);
  const atualiza = prontoPara(null, pronto); // substituído abaixo, quando o botão existir
  const refresh = () => { if (botao) botao.disabled = !pronto(); };
  const libera = () => { rolou = true; status.textContent = '✓ Contrato lido. Preencha seus dados e marque as confirmações.'; status.className = 'small ok-text'; [geral, ...Object.values(checks)].forEach((k) => { k.disabled = false; }); refresh(); };
  caixa.addEventListener('scroll', () => { if (!rolou && caixa.scrollHeight - caixa.scrollTop <= caixa.clientHeight + 40) libera(); });
  [nome, cpf, oab].forEach((i) => i.addEventListener('input', refresh));
  [geral, ...Object.values(checks)].forEach((i) => i.addEventListener('change', refresh));
  const corpo = h('div', { class: 'stack' },
    h('div', { class: 'banner' }, h('h3', {}, 'Resumo antes de ler o contrato'),
      c.resumo?.length ? h('ul', { class: 'dots small' }, c.resumo.map((t) => h('li', {}, inlineMd(t)))) : null,
      h('p', { class: 'small muted' }, `Versão ${c.versao} (texto de teste, em revisão jurídica). Seu aceite registra data, hora, IP, navegador, versão e hash do texto.`)),
    c.ficha ? h('div', { class: 'card stack' }, h('h3', {}, 'Ficha do Plano'),
      h('p', { class: 'small' }, h('b', {}, c.ficha.plano), ' · ', c.ficha.mensalidade),
      h('div', { class: 'tablewrap' }, h('table', {}, h('tbody', {}, c.ficha.itens.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v)))))),
      h('p', { class: 'small muted' }, c.ficha.nota)) : null,
    h('div', {}, h('p', { class: 'small muted' }, 'Role o contrato até o final para habilitar o aceite:'), caixa, status),
    h('div', { class: 'grid2' }, h('div', {}, h('label', {}, 'Nome completo'), nome), h('div', {}, h('label', {}, 'CPF'), cpf), h('div', {}, h('label', {}, 'OAB'), oab)),
    h('div', { class: 'checks' },
      h('label', { class: 'row' }, geral, 'Li e concordo com todos os termos do contrato acima.'),
      c.ciencias.map((x) => h('label', { class: 'row' }, checks[x.id], x.texto))));
  const m = modal({ titulo: (c.titulo || 'Contrato ZACDA Gestão e Portal do Cliente').replace(/^CONTRATO/, 'Contrato').replace(/ZACDA GESTÃO E PORTAL DO CLIENTE/, 'ZACDA Gestão e Portal do Cliente'), corpo, larga: true, fechavel: false, foco: false, acoes: [
    { texto: 'Assinar e continuar', classe: 'gold', desabilitado: true, onclick: async () => {
      await api('/api/contrato/aceite', { method: 'POST', body: { nome: nome.value, documento: cpf.value, oab: oab.value, rolou, concordo: geral.checked, ciencias: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v.checked])) } });
      toast('Contrato assinado. Registro salvo.', 'ok'); location.reload(); return true;
    } },
    { texto: 'Sair', classe: 'ghost', onclick: async () => { await sair(); return true; } }] });
  botao = m.botoes[0]; atualiza();
  // só dá para medir a rolagem depois que a caixa está na tela
  requestAnimationFrame(() => { if (caixa.scrollHeight <= caixa.clientHeight + 40) libera(); });
}

/**
 * Autorização de IA: o advogado decide uma vez. Autorizar libera a IA caso a caso;
 * não autorizar deixa a IA TOTALMENTE desativada, sem como ligar até autorizar depois.
 * Devolve 'aceita' | 'recusada' | null (fechou sem decidir).
 */
async function autorizacaoIaDialog({ forcado = false } = {}) {
  const t = await api('/api/ia/termo');
  return new Promise((resolve) => {
    const nome = h('input', { autocomplete: 'name', placeholder: 'Nome completo' });
    const checks = Object.fromEntries(t.ciencias.map((x) => [x.id, h('input', { type: 'checkbox' })]));
    let decidido = null, botao = null;
    const refresh = () => { if (botao) botao.disabled = !(nome.value.trim().length >= 3 && todosMarcados(checks)); };
    nome.addEventListener('input', refresh); Object.values(checks).forEach((k) => k.addEventListener('change', refresh));
    const m = modal({ titulo: t.titulo, fechavel: !forcado, larga: true, corpo: h('div', { class: 'stack' },
      t.decisao === 'recusada' ? h('p', { class: 'notice small' }, 'Hoje a IA está totalmente desativada porque o uso de IA não foi autorizado. Você pode mudar de decisão aqui.') : null,
      h('ul', { class: 'dots stack small' }, t.paragrafos.map((p) => h('li', {}, p))),
      h('div', { class: 'grid2' }, h('div', { class: 'notice ok small' }, t.se_autorizar), h('div', { class: 'notice bad small' }, t.se_nao_autorizar)),
      h('div', {}, h('label', {}, 'Nome completo (para autorizar)'), nome),
      h('div', { class: 'checks' }, t.ciencias.map((x) => h('label', { class: 'row' }, checks[x.id], x.texto))),
      h('p', { class: 'small muted' }, `Versão ${t.versao} (texto de teste, em revisão jurídica). A decisão vale para o escritório todo e fica registrada com data, hora, IP e hash.`)),
    acoes: [
      { texto: 'Autorizar o uso de IA', classe: 'gold', desabilitado: true, onclick: async () => {
        await api('/api/ia/termo/aceite', { method: 'POST', body: { nome: nome.value, ciencias: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v.checked])) } });
        decidido = 'aceita'; me.ia_opcao_b = 'aceita'; me.ia_global_aceita = true; toast('Uso de IA autorizado. Ela só liga caso a caso, por você.', 'ok'); resolve('aceita'); return true;
      } },
      { texto: 'Não autorizar (usar sem IA)', classe: 'danger', onclick: async () => {
        await api('/api/ia/termo/recusar', { method: 'POST' });
        decidido = 'recusada'; me.ia_opcao_b = 'recusada'; me.ia_global_aceita = false; toast('A IA ficou totalmente desativada neste painel.', 'ok'); resolve('recusada'); return true;
      } },
      ...(forcado ? [] : [{ texto: 'Decidir depois', classe: 'ghost', onclick: async () => true }])] });
    botao = m.botoes[0];
    const obs = new MutationObserver(() => { if (!document.body.contains(m.caixa)) { obs.disconnect(); if (!decidido) resolve(null); } });
    obs.observe(document.body, { childList: true });
  });
}

/** Ligar a IA em um caso: consentimento do cliente + responsabilidade do advogado. Segredo de justiça: bloqueado. */
async function habilitarIaDialog(caso, depois) {
  const termo = await api('/api/ia/caso-termo');
  if (caso.segredo) { modal({ titulo: 'IA bloqueada neste caso', corpo: h('p', {}, termo.aviso_segredo), acoes: [{ texto: 'Entendi', classe: 'gold', onclick: async () => true }] }); return; }
  if (me.ia_opcao_b !== 'aceita') { const d = await autorizacaoIaDialog(); if (d !== 'aceita') return; }
  const data = h('input', { type: 'date', max: hojeISO() });
  const papel = h('select', {}, opt('', 'Escolha...'), opt('autor', 'Autor (propôs a ação)', caso.papel_cliente === 'autor'), opt('reu', 'Réu (foi processado)', caso.papel_cliente === 'reu'), opt('outro', 'Outra posição', caso.papel_cliente === 'outro'));
  const lista = [...termo.ciencias, ...(caso.sensivel ? [termo.ciencia_sensivel] : [])];
  const checks = Object.fromEntries(lista.map((x) => [x.id, h('input', { type: 'checkbox' })]));
  let botao = null;
  const refresh = () => { if (botao) botao.disabled = !(data.value && papel.value && todosMarcados(checks)); };
  [data, papel].forEach((i) => { i.addEventListener('input', refresh); i.addEventListener('change', refresh); });
  Object.values(checks).forEach((k) => k.addEventListener('change', refresh));
  const m = modal({ titulo: termo.titulo, fechavel: true, larga: true, corpo: h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, `Caso: ${caso.titulo}`),
    caso.sensivel ? h('p', { class: 'notice bad small' }, termo.aviso_sensivel) : null,
    h('p', { class: 'small' }, termo.intro),
    h('div', { class: 'grid2' }, h('div', {}, h('label', {}, 'Posição do seu cliente neste caso'), papel), h('div', {}, h('label', {}, 'Data em que o cliente consentiu por escrito'), data)),
    h('div', { class: 'checks' }, lista.map((x) => h('label', { class: 'row' }, checks[x.id], x.texto)))),
  acoes: [
    { texto: 'Ligar a IA neste caso', classe: 'gold', desabilitado: true, onclick: async () => { await api(`/api/casos/${caso.id}/ia/habilitar`, { method: 'POST', body: { consentimento_em: data.value, papel_cliente: papel.value, ciencias: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v.checked])) } }); toast('IA ligada neste caso. Registro salvo.', 'ok'); depois(); return true; } },
    { texto: 'Cancelar', classe: 'ghost', onclick: async () => true }] });
  botao = m.botoes[0];
}

/* ----------------------------------------------------------------- início */
const VIEWS = {};
VIEWS.inicio = async () => {
  const r = await api('/api/resumo');
  const stat = (n, t, hint, href) => h('a', { class: 'card stat linkcard', href }, h('b', {}, n ?? '-'), h('span', {}, t), hint ? h('div', { class: 'small muted' }, hint) : null);
  main.replaceChildren(
    secao(`Olá, ${me.nome.split(' ')[0]}`),
    h('div', { class: 'stats' },
      stat(r.casos_ativos, 'casos ativos', 'Abrir o kanban', '#/casos'),
      stat(r.rascunhos, 'andamentos para revisar', 'Textos que ainda não foram aprovados', '#/casos'),
      r.publicacoes_novas != null ? stat(r.publicacoes_novas, 'publicações novas (DJEN)', 'Ver publicações', '#/publicacoes') : null,
      r.leads != null ? stat(r.leads, 'leads para atender', 'Ver clientes e leads', '#/clientes') : null),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h2', {}, 'Prazos nos próximos 7 dias'),
        h('div', { class: 'list' }, r.prazos_7d.length ? r.prazos_7d.map((p) => h('div', { class: 'row clicavel', tabindex: 0, role: 'link', onclick: () => abrirCaso(p.caso_id, 'prazos'), onkeydown: (e) => { if (e.key === 'Enter') abrirCaso(p.caso_id, 'prazos'); } },
          h('span', { class: `badge ${p.atrasado ? 'bad' : 'warn'}` }, p.atrasado ? 'Atrasado' : fmtData(p.data)),
          h('span', {}, `${p.titulo} `, h('span', { class: 'muted small' }, `· ${p.caso}`)))) : h('p', { class: 'muted' }, 'Nenhum prazo pendente.'))),
      r.ia ? h('div', { class: 'card stack' }, h('h2', {}, 'Fontes e custo do piloto'),
        h('p', { class: 'small' }, h('span', { class: 'badge ok' }, 'grátis'), ' DJEN (publicações por OAB), banco de dados local, portal do cliente, importação do Trello.'),
        h('p', { class: 'small' }, h('span', { class: `badge ${me.ia ? 'gold' : 'bad'}` }, me.ia ? `custo ZACDA` : 'sem chave'), ` IA ${r.ia.modelo}: ${r.ia.resumos} resumos, custo estimado R$ ${r.ia.custo_estimado_brl.toFixed(4).replace('.', ',')}.`),
        h('p', { class: 'small muted' }, 'Tudo o que é pago aparece em Add-ons, só para medir interesse. Nada é cobrado no piloto.'),
        h('div', { class: 'row' }, h('a', { class: 'btn sm', href: '#/plano' }, 'Meu plano e consumo'), h('a', { class: 'btn sm', href: '#/addons' }, 'Ver add-ons'))) : null));
};

/* ------------------------------------------------------------------ kanban */
VIEWS.casos = async () => {
  const k = await api('/api/kanban');
  const clientes = await api('/api/clientes');
  let dragId = null;
  const card = (c) => {
    const el = h('div', { class: 'kc', draggable: true, tabindex: 0, role: 'button', onclick: () => abrirCaso(c.id), onkeydown: (e) => { if (e.key === 'Enter') abrirCaso(c.id); } },
      h('b', {}, c.titulo),
      c.cliente ? h('div', { class: 'small muted' }, c.cliente) : null,
      h('div', { class: 'meta' },
        c.area ? h('span', { class: 'badge' }, c.area) : null,
        c.segredo ? h('span', { class: 'badge warn' }, 'segredo') : c.sensivel ? h('span', { class: 'badge warn' }, 'sensível') : null,
        c.ia_habilitada ? h('span', { class: 'badge ok' }, 'IA ligada') : null,
        c.rascunhos ? h('span', { class: 'badge gold' }, `${c.rascunhos} p/ revisar`) : null,
        c.proximo_prazo ? h('span', { class: 'badge blue' }, `prazo ${fmtData(c.proximo_prazo)}`) : null));
    el.addEventListener('dragstart', (e) => { dragId = c.id; el.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(c.id)); });
    el.addEventListener('dragend', () => el.classList.remove('drag'));
    return el;
  };
  const board = h('div', { class: 'board' }, k.fases.map((f) => {
    const cs = k.casos.filter((c) => c.fase_id === f.id);
    const col = h('div', { class: 'col' }, h('h3', {}, f.nome, h('span', { class: 'badge' }, cs.length)), cs.map(card));
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', () => col.classList.remove('over'));
    col.addEventListener('drop', guard(async (e) => {
      e.preventDefault(); col.classList.remove('over');
      if (dragId && k.casos.find((c) => c.id === dragId)?.fase_id !== f.id) { await api(`/api/casos/${dragId}`, { method: 'PATCH', body: { fase_id: f.id } }); VIEWS.casos(); }
    }));
    return col;
  }));
  const novo = () => {
    const t = h('input', { placeholder: 'Ex.: Reclamação trabalhista: verbas rescisórias' });
    const cnj = h('input', { placeholder: '0000000-00.0000.0.00.0000 (opcional)' });
    const ar = h('select', {}, opt('', 'Área'), AREAS.map((a) => opt(a, a)));
    const cl = h('select', {}, opt('', 'Sem cliente'), clientes.map((c) => opt(c.id, c.nome)));
    const seg = h('input', { type: 'checkbox' });
    const form = h('div', { class: 'card stack' }, h('h2', {}, 'Novo caso'), campo('Título', t), h('div', { class: 'grid2' }, campo('Número CNJ', cnj), campo('Área', ar), campo('Cliente', cl)),
      h('label', { class: 'row' }, seg, 'Segredo de justiça (a IA fica desligada para este caso)'),
      h('div', { class: 'row' }, h('button', { class: 'btn gold', onclick: guard(async () => { await api('/api/casos', { method: 'POST', body: { titulo: t.value, numero_cnj: cnj.value, area: ar.value, cliente_id: cl.value || null, segredo: seg.checked } }); VIEWS.casos(); }) }, 'Criar caso'),
        h('button', { class: 'btn ghost', onclick: () => form.remove() }, 'Cancelar')));
    main.prepend(form); t.focus();
  };
  const novaColuna = () => {
    const n = h('input', { placeholder: 'Nome da coluna' });
    const f = h('div', { class: 'card row' }, n, h('button', { class: 'btn gold', onclick: guard(async () => { await api('/api/fases', { method: 'POST', body: { nome: n.value } }); VIEWS.casos(); }) }, 'Adicionar'), h('button', { class: 'btn ghost', onclick: () => f.remove() }, 'Cancelar'));
    main.prepend(f); n.focus();
  };
  main.replaceChildren(secao('Casos', h('button', { class: 'btn gold', onclick: novo }, '+ Novo caso'), me.role === 'admin' ? h('button', { class: 'btn', onclick: novaColuna }, '+ Coluna') : null),
    ...(k.casos.length ? [] : [h('p', { class: 'notice' }, 'Nenhum caso ainda. Crie um caso ou importe o board do Trello em "Importar do Trello".')]), board);
};

/* ------------------------------------------------------------ gaveta do caso */
async function abrirCaso(id, aba = 'resumo') {
  const d = await api(`/api/casos/${id}`).catch(erro);
  if (!d) return;
  const [clientes, usuarios, fases] = await Promise.all([api('/api/clientes'), me.role === 'admin' ? api('/api/usuarios') : [], api('/api/kanban').then((k) => k.fases)]);
  const c = d.caso;
  const shade = h('div', { class: 'shade' });
  const body = h('div', { class: 'body' });
  const fechar = () => { shade.remove(); drawer.remove(); rota(); };
  const recarrega = (a) => { shade.remove(); drawer.remove(); abrirCaso(id, a); };
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const drawer = h('aside', { class: 'drawer', role: 'dialog', 'aria-label': c.titulo },
    h('header', {}, h('div', {}, h('h2', {}, c.titulo), h('div', { class: 'small muted' }, [c.cliente_nome, c.numero_cnj, c.fase].filter(Boolean).join(' · '))),
      h('button', { class: 'btn sm ghost right', onclick: fechar, 'aria-label': 'Fechar' }, 'Fechar')), tabs, body);
  shade.addEventListener('click', fechar);

  const ABAS = {
    resumo: () => {
      const t = h('input', { value: c.titulo }), cnj = h('input', { value: c.numero_cnj || '' });
      const ar = h('select', {}, opt('', 'Sem área'), AREAS.map((a) => opt(a, a, a === c.area)));
      const cl = h('select', {}, opt('', 'Sem cliente'), clientes.map((x) => opt(x.id, x.nome, x.id === c.cliente_id)));
      const fa = h('select', {}, fases.map((f) => opt(f.id, f.nome, f.id === c.fase_id)));
      const resp = me.role === 'admin' ? h('select', {}, opt('', 'Sem responsável'), usuarios.filter((u) => u.role !== 'cliente').map((u) => opt(u.id, u.nome, u.id === c.responsavel_id))) : null;
      const et = h('input', { value: c.etiquetas || '' }), nt = h('textarea', {}, c.notas || ''), seg = h('input', { type: 'checkbox', checked: !!c.segredo });
      const pc = h('select', {}, opt('', 'Não informada'), opt('autor', 'Autor (propôs a ação)', c.papel_cliente === 'autor'), opt('reu', 'Réu (foi processado)', c.papel_cliente === 'reu'), opt('outro', 'Outra posição', c.papel_cliente === 'outro'));
      const iaPainel = h('div', { class: 'card stack' }, h('h3', {}, 'Inteligência artificial neste caso'),
        c.segredo ? h('p', { class: 'notice small' }, 'Segredo de justiça: a IA está bloqueada e não pode ser habilitada.')
          : me.ia_opcao_b === 'recusada' ? h('div', { class: 'stack' }, h('p', { class: 'notice bad small' }, 'IA totalmente desativada: o escritório não autorizou o uso de IA. Não há como ligar a IA em nenhum caso até que você autorize.'),
            me.role === 'admin' ? h('div', {}, h('button', { class: 'btn sm', onclick: async () => { if (await autorizacaoIaDialog() === 'aceita') recarrega('resumo'); } }, 'Rever a autorização de IA')) : h('p', { class: 'small muted' }, 'Só o advogado pode rever a autorização de IA.'))
          : me.ia_opcao_b === 'pendente' ? h('div', { class: 'stack' }, h('p', { class: 'notice small' }, 'A IA só pode ser usada depois que o advogado decidir sobre o uso de IA.'),
            me.role === 'admin' ? h('div', {}, h('button', { class: 'btn sm gold', onclick: async () => { if (await autorizacaoIaDialog() === 'aceita') recarrega('resumo'); } }, 'Decidir sobre o uso de IA')) : null)
          : c.ia_habilitada ? h('div', { class: 'stack' }, h('p', { class: 'small' }, h('span', { class: 'badge ok' }, 'IA ligada'), ` Consentimento do cliente informado em ${fmtData(d.consentimento_ia?.consentimento_em)}.`),
            me.role === 'admin' ? h('div', {}, h('button', { class: 'btn sm danger', onclick: guard(async () => { if (await confirmar('Desligar a IA neste caso', 'O que já foi enviado ao provedor pode ficar retido por até 30 dias.', 'Desligar IA', true)) { await api(`/api/casos/${id}/ia/desabilitar`, { method: 'POST' }); recarrega('resumo'); } }) }, 'Desligar IA')) : null)
            : h('div', { class: 'stack' }, h('p', { class: 'small' }, h('span', { class: 'badge' }, 'IA desligada'), ' É o padrão de todos os casos. ', c.sensivel ? 'Caso sensível: avalie com cuidado antes de habilitar.' : ''),
              me.role === 'admin' ? h('div', {}, h('button', { class: 'btn sm gold', onclick: () => habilitarIaDialog(c, () => recarrega('resumo')) }, 'Habilitar IA neste caso')) : h('p', { class: 'small muted' }, 'Só o advogado pode habilitar a IA.')));
      return h('div', { class: 'stack' }, campo('Título', t),
        h('div', { class: 'grid2' }, campo('Número CNJ', cnj), campo('Área', ar), campo('Cliente', cl), campo('Fase', fa), resp ? campo('Responsável', resp) : null, campo('Posição do cliente (a IA usa)', pc), campo('Etiquetas', et)),
        campo('Notas internas', nt),
        h('label', { class: 'row' }, seg, 'Segredo de justiça (IA bloqueada; texto simples só manual)'), iaPainel,
        h('div', { class: 'row' },
          h('button', { class: 'btn gold', onclick: guard(async () => {
            const b = { titulo: t.value, numero_cnj: cnj.value, area: ar.value, cliente_id: cl.value || null, fase_id: +fa.value, etiquetas: et.value, notas: nt.value, segredo: seg.checked, papel_cliente: pc.value || null };
            if (resp) b.responsavel_id = resp.value || null;
            await api(`/api/casos/${id}`, { method: 'PATCH', body: b }); toast('Caso salvo.', 'ok'); recarrega('resumo');
          }) }, 'Salvar'),
          me.datajud ? h('button', { class: 'btn', disabled: !c.numero_cnj || !me.datajud, title: me.datajud ? '' : 'Defina DATAJUD_API_KEY em .env.local para ativar', onclick: guard(async () => { const r = await api(`/api/casos/${id}/datajud`, { method: 'POST' }); toast(`DataJud: ${r.novos} movimentações novas.`, 'ok'); recarrega('andamentos'); }) }, 'Buscar no DataJud') : null,
          me.role === 'admin' ? h('button', { class: 'btn danger right', onclick: guard(async () => { if (!shade.dataset.conf) { shade.dataset.conf = 1; toast('Clique de novo em "Excluir caso" para confirmar.'); return; } await api(`/api/casos/${id}`, { method: 'DELETE' }); fechar(); }) }, 'Excluir caso') : null));
    },
    andamentos: () => {
      const dt = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) }), tx = h('textarea', { placeholder: 'Cole aqui o andamento como aparece no tribunal...' });
      const add = h('div', { class: 'card stack' }, h('h3', {}, 'Novo andamento'), h('div', { class: 'grid2' }, campo('Data', dt)), campo('Texto do tribunal', tx),
        h('button', { class: 'btn gold', onclick: guard(async () => { await api(`/api/casos/${id}/andamentos`, { method: 'POST', body: { data: dt.value, texto: tx.value } }); recarrega('andamentos'); }) }, 'Adicionar'));
      const itens = d.andamentos.map((a) => {
        const ta = h('textarea', { placeholder: 'Texto em linguagem simples que o cliente vai ler' }, a.texto_simples || '');
        return h('div', { class: 'and stack' },
          h('div', { class: 'row' }, h('b', {}, fmtData(a.data)), h('span', { class: 'badge' }, a.origem),
            h('span', { class: `badge ${a.status === 'aprovado' ? 'ok' : 'warn'}` }, a.status === 'aprovado' ? 'publicado no portal' : 'rascunho'), a.ia ? h('span', { class: 'badge gold' }, 'gerado por IA') : null),
          h('pre', {}, a.texto_original), ta,
          h('div', { class: 'row' },
            h('button', { class: 'btn sm', disabled: !me.ia || !!c.segredo || !c.ia_habilitada || me.ia_opcao_b !== 'aceita', title: c.segredo ? 'Segredo de justiça: IA bloqueada' : me.ia_opcao_b !== 'aceita' ? 'IA desativada: uso de IA não autorizado' : !c.ia_habilitada ? 'IA desligada neste caso (habilite na aba Resumo)' : (me.ia ? '' : 'Sem ANTHROPIC_API_KEY'), onclick: guard(async (e) => { e.target.disabled = true; e.target.textContent = 'Gerando...'; try { const r = await api(`/api/andamentos/${a.id}/traduzir`, { method: 'POST' }); ta.value = r.texto_simples; toast('Texto gerado. Revise antes de aprovar.', 'ok'); recarrega('andamentos'); } catch (x) { erro(x); e.target.disabled = false; e.target.textContent = 'Gerar com IA'; } }) }, 'Gerar com IA'),
            h('button', { class: 'btn sm', onclick: guard(async () => { await api(`/api/andamentos/${a.id}`, { method: 'PATCH', body: { texto_simples: ta.value } }); toast('Texto salvo como rascunho.', 'ok'); recarrega('andamentos'); }) }, 'Salvar texto'),
            me.role === 'admin' ? (a.status === 'aprovado'
              ? h('button', { class: 'btn sm', onclick: guard(async () => { await api(`/api/andamentos/${a.id}`, { method: 'PATCH', body: { aprovar: false } }); recarrega('andamentos'); }) }, 'Retirar do portal')
              : h('button', { class: 'btn sm gold', onclick: guard(async () => { await api(`/api/andamentos/${a.id}`, { method: 'PATCH', body: { texto_simples: ta.value } }); await api(`/api/andamentos/${a.id}`, { method: 'PATCH', body: { aprovar: true } }); toast('Publicado no portal do cliente.', 'ok'); recarrega('andamentos'); }) }, 'Aprovar e publicar')) : h('span', { class: 'small muted' }, 'A aprovação é do advogado.')));
      });
      return h('div', { class: 'stack' }, c.segredo ? h('p', { class: 'notice' }, 'Segredo de justiça: a IA está bloqueada neste caso.') : me.ia_opcao_b !== 'aceita' ? h('p', { class: 'notice bad small' }, me.ia_opcao_b === 'recusada' ? 'IA totalmente desativada: o uso de IA não foi autorizado. Os textos em linguagem simples são escritos por você.' : 'A IA ainda depende da decisão do advogado sobre o uso de IA. Enquanto isso, escreva o texto simples manualmente.') : !c.ia_habilitada ? h('p', { class: 'notice small' }, 'IA desligada neste caso. Para gerar resumos, o advogado habilita a IA na aba Resumo, com o consentimento do cliente, e a posição do cliente precisa estar informada.') : null, add, ...itens);
    },
    documentos: () => {
      const f = h('input', { type: 'file' });
      const up = h('div', { class: 'card stack' }, h('h3', {}, 'Enviar documento'), h('p', { class: 'small muted' }, 'PDF, imagem, Word, Excel ou texto, até 15 MB. O cliente só vê o que for marcado como visível.'), f,
        h('button', { class: 'btn gold', onclick: guard(async () => {
          const file = f.files[0]; if (!file) throw new Error('Escolha um arquivo.');
          await api(`/api/casos/${id}/documentos`, { method: 'POST', raw: file, headers: { 'x-filename': encodeURIComponent(file.name), 'content-type': 'application/octet-stream' } });
          toast('Documento enviado.', 'ok'); recarrega('documentos');
        }) }, 'Enviar'));
      return h('div', { class: 'stack' }, up, h('div', { class: 'list' }, d.documentos.length ? d.documentos.map((x) => h('div', { class: 'row' },
        h('a', { href: `/api/documentos/${x.id}/download` }, x.nome), h('span', { class: 'small muted' }, `${fmtBytes(x.tamanho)} · ${fmtData(x.criado_em)}`),
        h('span', { class: `badge ${x.visivel_cliente ? 'ok' : ''}` }, x.visivel_cliente ? 'visível ao cliente' : 'interno'),
        me.role === 'admin' ? h('span', { class: 'row right' },
          h('button', { class: 'btn sm', onclick: guard(async () => { await api(`/api/documentos/${x.id}`, { method: 'PATCH', body: { visivel_cliente: !x.visivel_cliente } }); recarrega('documentos'); }) }, x.visivel_cliente ? 'Ocultar' : 'Mostrar ao cliente'),
          h('button', { class: 'btn sm danger', onclick: guard(async () => { await api(`/api/documentos/${x.id}`, { method: 'DELETE' }); recarrega('documentos'); }) }, 'Excluir')) : null)) : h('p', { class: 'muted' }, 'Nenhum documento.')));
    },
    prazos: () => {
      const tt = h('input', { placeholder: 'Ex.: Apresentar réplica' }), dd = h('input', { type: 'date' });
      return h('div', { class: 'stack' }, h('div', { class: 'card stack' }, h('h3', {}, 'Novo prazo'), h('div', { class: 'grid2' }, campo('Descrição', tt), campo('Data', dd)),
        h('p', { class: 'small muted' }, 'Confira sempre o prazo na fonte oficial (publicação no DJEN ou sistema do tribunal). Este campo é um lembrete interno.'),
        h('button', { class: 'btn gold', onclick: guard(async () => { await api(`/api/casos/${id}/prazos`, { method: 'POST', body: { titulo: tt.value, data: dd.value } }); recarrega('prazos'); }) }, 'Adicionar')),
        h('div', { class: 'list' }, d.prazos.length ? d.prazos.map((p) => h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: !!p.concluido, onchange: guard(async (e) => { await api(`/api/prazos/${p.id}`, { method: 'PATCH', body: { concluido: e.target.checked } }); }) }), `${fmtData(p.data)} · ${p.titulo}`)) : h('p', { class: 'muted' }, 'Nenhum prazo.')));
    },
    publicacoes: () => h('div', { class: 'list' }, d.publicacoes.length ? d.publicacoes.map((p) => h('div', { class: 'stack' }, h('div', { class: 'row' }, h('b', {}, fmtData(p.data_disp)), h('span', { class: 'badge' }, p.tribunal), h('span', { class: 'badge blue' }, p.tipo)), h('p', { class: 'small muted' }, p.orgao), h('p', { class: 'small' }, `${p.resumo}...`))) : h('p', { class: 'muted' }, 'Nenhuma publicação do DJEN vinculada a este caso.')),
  };
  const nomes = { resumo: 'Resumo', andamentos: `Andamentos (${d.andamentos.length})`, documentos: `Documentos (${d.documentos.length})`, prazos: `Prazos (${d.prazos.length})`, publicacoes: `DJEN (${d.publicacoes.length})` };
  const mostra = (a) => { tabs.replaceChildren(...Object.keys(ABAS).map((k) => h('button', { class: k === a ? 'on' : '', role: 'tab', onclick: () => mostra(k) }, nomes[k]))); body.replaceChildren(ABAS[a]()); };
  document.body.append(shade, drawer);
  mostra(aba);
}

/* --------------------------------------------------------------- clientes */
VIEWS.clientes = async () => {
  const lista = await api('/api/clientes');
  const n = h('input', { placeholder: 'Nome' }), tel = h('input', { placeholder: '(61) 90000-0000' }), em = h('input', { type: 'email', placeholder: 'email@exemplo.com' });
  const org = h('select', {}, ['Site', 'WhatsApp', 'Google', 'Indicação', 'Outro'].map((o) => opt(o, o)));
  const st = h('select', {}, opt('lead', 'Lead (ainda não contratou)'), opt('ativo', 'Cliente ativo'));
  const caixa = h('div');
  const novo = h('div', { class: 'card stack' }, h('h2', {}, 'Novo lead ou cliente'), h('div', { class: 'grid2' }, campo('Nome', n), campo('Telefone', tel), campo('E-mail', em), campo('Origem', org), campo('Situação', st)),
    h('div', {}, h('button', { class: 'btn gold', onclick: guard(async () => { await api('/api/clientes', { method: 'POST', body: { nome: n.value, telefone: tel.value, email: em.value, origem: org.value, status: st.value } }); VIEWS.clientes(); }) }, 'Cadastrar')));
  const acesso = guard(async (c) => {
    const r = await api(`/api/clientes/${c.id}/acesso`, { method: 'POST', body: { email: c.email } });
    caixa.replaceChildren(h('div', { class: 'notice stack' }, h('b', {}, `Acesso criado para ${c.nome}`), h('p', {}, 'Envie estes dados ao cliente. A senha aparece só agora.'), h('p', {}, `Link: ${location.origin}/login`), h('p', {}, `E-mail: ${r.email}`), h('p', {}, `Senha temporária: `, h('b', {}, r.senha_temporaria)), h('p', { class: 'small muted' }, 'No primeiro acesso o cliente aceita os termos e pode trocar a senha.')));
  });
  const pedirEmail = (c) => {
    const e = h('input', { type: 'email', placeholder: 'E-mail do cliente' });
    const f = h('div', { class: 'card row' }, e, h('button', { class: 'btn gold', onclick: async () => { c.email = e.value; f.remove(); await acesso(c); } }, 'Criar acesso'), h('button', { class: 'btn ghost', onclick: () => f.remove() }, 'Cancelar'));
    caixa.replaceChildren(f); e.focus();
  };
  main.replaceChildren(secao('Clientes e leads'), caixa, novo,
    h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Nome', 'Contato', 'Origem', 'Situação', 'Casos', 'Portal', ...(me.role === 'admin' ? ['Dados (LGPD)'] : [])].map((t) => h('th', {}, t)))),
      h('tbody', {}, lista.map((c) => h('tr', {},
        h('td', {}, c.nome), h('td', {}, [c.telefone, c.email].filter(Boolean).join(' · ')), h('td', {}, c.origem || ''),
        h('td', {}, h('select', { 'aria-label': 'Situação', onchange: guard(async (e) => { await api(`/api/clientes/${c.id}`, { method: 'PATCH', body: { status: e.target.value } }); toast('Situação atualizada.', 'ok'); }) }, ['lead', 'ativo', 'inativo'].map((s) => opt(s, s, s === c.status)))),
        h('td', {}, c.casos),
        h('td', {}, c.user_id ? h('span', { class: 'badge ok' }, 'com acesso') : (me.role === 'admin' ? h('button', { class: 'btn sm', onclick: () => (c.email ? acesso(c) : pedirEmail(c)) }, 'Criar acesso') : '')),
        me.role === 'admin' ? h('td', {}, h('div', { class: 'row' },
          h('a', { class: 'btn sm ghost', href: `/api/clientes/${c.id}/exportar` }, 'Exportar'),
          h('button', { class: 'btn sm danger', onclick: guard(async () => {
            if (await confirmar('Anonimizar cliente', `Os dados pessoais de ${c.nome} serão apagados (nome, contatos, notas e acesso ao portal). Os casos e documentos continuam no escritório, sem identificação do cliente. Não dá para desfazer.`, 'Anonimizar', true)) {
              await api(`/api/clientes/${c.id}/anonimizar`, { method: 'POST' }); toast('Cliente anonimizado.', 'ok'); VIEWS.clientes();
            }
          }) }, 'Anonimizar'))) : null))))));
};

/* ------------------------------------------------------------ publicações */
VIEWS.publicacoes = async () => {
  const filtro = sessionStorage.getItem('pubfiltro') || 'todas';
  const r = await api(`/api/publicacoes?so=${filtro === 'todas' ? '' : filtro}`);
  const casos = (await api('/api/kanban')).casos;
  const sync = (dias) => guard(async (e) => {
    e.target.disabled = true; e.target.textContent = 'Consultando o DJEN...';
    try { const x = await api('/api/djen/sync', { method: 'POST', body: { dias } }); toast(`${x.lidas} lidas, ${x.novas} novas, ${x.vinculadas} ligadas a casos.`, 'ok'); VIEWS.publicacoes(); }
    catch (ex) { erro(ex); e.target.disabled = false; e.target.textContent = `Sincronizar ${dias} dias`; }
  });
  const item = (p) => {
    const sel = h('select', { 'aria-label': 'Vincular a caso' }, opt('', 'Vincular a um caso...'), casos.map((c) => opt(c.id, c.titulo)));
    const aberto = h('p', { class: 'small', hidden: true }, p.texto || '');
    return h('div', { class: 'card stack' },
      h('div', { class: 'row' }, h('b', {}, fmtData(p.data_disp)), h('span', { class: 'badge' }, p.tribunal), h('span', { class: 'badge blue' }, p.tipo), p.lida ? null : h('span', { class: 'badge gold' }, 'nova'), p.caso_id ? h('span', { class: 'badge ok' }, `caso: ${p.caso_titulo}`) : h('span', { class: 'badge warn' }, 'sem caso')),
      h('p', { class: 'small muted' }, `${p.classe || ''} · ${p.orgao || ''} · ${p.numero_processo || ''}`),
      h('p', { class: 'small' }, `${(p.texto || '').slice(0, 260)}${(p.texto || '').length > 260 ? '...' : ''}`), aberto,
      h('div', { class: 'row' },
        h('button', { class: 'btn sm ghost', onclick: () => { aberto.hidden = !aberto.hidden; } }, 'Ler tudo'),
        p.link ? h('a', { class: 'btn sm ghost', href: p.link, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir no tribunal') : null,
        p.lida ? null : h('button', { class: 'btn sm', onclick: guard(async () => { await api(`/api/publicacoes/${p.id}`, { method: 'PATCH', body: { lida: true } }); VIEWS.publicacoes(); }) }, 'Marcar como lida'),
        p.caso_id ? null : [sel, h('button', { class: 'btn sm', onclick: guard(async () => { if (!sel.value) throw new Error('Escolha o caso.'); await api(`/api/publicacoes/${p.id}`, { method: 'PATCH', body: { caso_id: +sel.value } }); VIEWS.publicacoes(); }) }, 'Vincular'),
          h('button', { class: 'btn sm gold', onclick: guard(async () => { const x = await api(`/api/publicacoes/${p.id}/criar-caso`, { method: 'POST' }); toast('Caso criado a partir da publicação.', 'ok'); abrirCaso(x.caso_id, 'andamentos'); }) }, 'Criar caso')]));
  };
  main.replaceChildren(secao('Publicações do DJEN', h('button', { class: 'btn gold', onclick: sync(30) }, 'Sincronizar 30 dias'), h('button', { class: 'btn', onclick: sync(90) }, 'Sincronizar 90 dias')),
    h('p', { class: 'notice small' }, `Fonte gratuita do CNJ, consultada pela OAB ${r.config.oab}/${r.config.uf} (variantes: ${r.config.variantes.map((v) => r.config.oab + v).join(', ')}). `,
      'A data mostrada é a da disponibilização. A publicação legal é o primeiro dia útil seguinte, e o prazo começa a correr no dia útil depois dela (Lei 11.419/2006, art. 4º, §§ 3º e 4º; CPC, art. 224), com feriados locais; confira sempre no tribunal. Intimações pessoais do Domicílio Judicial Eletrônico não chegam por aqui.'),
    h('div', { class: 'toolbar' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Filtrar publicações' }, ['todas', 'novas', 'sem_caso'].map((f) => h('button', { type: 'button', class: filtro === f ? 'on' : '', 'aria-pressed': String(filtro === f), onclick: () => { sessionStorage.setItem('pubfiltro', f); VIEWS.publicacoes(); } }, { todas: 'Todas', novas: 'Não lidas', sem_caso: 'Sem caso' }[f]))),
      h('span', { class: 'muted small' }, `${r.total} guardadas`)),
    h('div', { class: 'stack' }, r.itens.length ? r.itens.map(item) : [h('p', { class: 'muted' }, 'Nada aqui. Clique em Sincronizar para buscar no DJEN.')]));
};

/* ------------------------------------------------------------------ trello */
VIEWS.trello = async () => {
  const f = h('input', { type: 'file', accept: '.json,application/json' });
  main.replaceChildren(secao('Importar do Trello'),
    h('div', { class: 'card stack' },
      h('p', {}, 'No Trello: abra o board, menu (...) > Imprimir, exportar e mais > Exportar como JSON. Depois envie o arquivo aqui.'),
      h('p', { class: 'small muted' }, 'Cada lista vira uma coluna e cada cartão vira um caso. Número do processo no título ou na descrição é reconhecido, e a data de entrega vira prazo. Cartões arquivados são ignorados. O arquivo é lido no seu computador e só os casos são gravados.'),
      h('p', { class: 'notice small' }, 'Todos os casos importados começam com a IA desligada. Casos de áreas sensíveis (penal, família e sucessões) são sinalizados. A IA só liga caso a caso, por você, com o consentimento do cliente.'),
      f, h('div', {}, h('button', { class: 'btn gold', onclick: guard(async () => {
        const file = f.files[0]; if (!file) throw new Error('Escolha o arquivo JSON.');
        const board = JSON.parse(await file.text());
        const r = await api('/api/trello/importar', { method: 'POST', body: board });
        modal({ titulo: 'Importação concluída', corpo: h('div', { class: 'stack' },
          h('p', {}, `${r.casos} casos importados em ${r.colunas} colunas, com ${r.prazos} prazos.`),
          h('p', { class: 'notice' }, 'Todos os casos estão com a IA DESLIGADA.'),
          r.sensiveis ? h('p', { class: 'notice bad' }, `${r.sensiveis} caso(s) são de áreas sensíveis (penal ou família e sucessões). Eles exigem atenção redobrada: a IA só pode ser habilitada por você, caso a caso, com o consentimento escrito do cliente. Em segredo de justiça, a IA fica bloqueada.`) : null,
          h('p', { class: 'small muted' }, 'Depois de conferir os casos, apague o arquivo JSON exportado do Trello do seu computador.')),
        acoes: [{ texto: 'Entendi', classe: 'gold', onclick: async () => { location.hash = '#/casos'; return true; } }] });
      }) }, 'Importar'))));
};

/* ------------------------------------------------------------------ add-ons */
const interesseBtn = (a, depois) => h('button', { class: `btn ${a.tenho_interesse ? '' : 'gold'}`, disabled: a.tenho_interesse, onclick: guard(async (e) => { e.stopPropagation(); await api(`/api/addons/${a.id}/interesse`, { method: 'POST' }); toast('Interesse registrado. Obrigado!', 'ok'); depois(); }) }, a.tenho_interesse ? 'Interesse registrado' : 'Tenho interesse');

VIEWS.addons = async () => {
  const l = await api('/api/addons');
  const alvo = (location.hash.match(/^#\/addons\/(\w+)/) || [])[1];
  const a = alvo && l.find((x) => x.id === alvo);
  if (a) { // página de cada serviço
    main.replaceChildren(
      h('a', { href: '#/addons', class: 'small' }, '← Todos os add-ons'),
      secao(a.nome, interesseBtn(a, () => VIEWS.addons())),
      h('p', { class: 'notice small' }, 'Em validação: nada é cobrado no piloto. Os preços são referências para medir interesse.'),
      h('div', { class: 'grid2' },
        h('div', { class: 'card stack' }, h('h2', {}, 'O que é'), h('p', {}, a.desc), a.como ? h('ul', { class: 'dots stack small' }, a.como.map((t) => h('li', {}, t))) : null),
        h('div', { class: 'card stack' }, h('h2', {}, 'Quanto custa'), h('p', {}, h('span', { class: 'badge gold' }, a.preco)),
          a.custos ? h('div', { class: 'tablewrap' }, h('table', {}, h('tbody', {}, a.custos.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v)))))) : h('p', { class: 'small muted' }, a.custo),
          a.limites ? h('p', { class: 'small muted' }, `Limites e observações: ${a.limites}`) : null)),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/plano' }, 'Ver o que o meu plano já cobre')));
    return;
  }
  main.replaceChildren(secao('Add-ons', h('a', { class: 'btn', href: '#/plano' }, 'Meu plano e consumo')),
    h('p', { class: 'notice' }, 'Estes recursos são pagos e estão em validação. Nada é cobrado no piloto. Clique em um card para ver como funciona e quanto custa, e marque "Tenho interesse" nos que fariam diferença no seu dia a dia.'),
    h('div', { class: 'addgrid' }, l.map((x) => h('div', { class: 'card addcard clicavel', tabindex: 0, role: 'link', 'aria-label': `${x.nome}: ver detalhes`, onclick: () => { location.hash = `#/addons/${x.id}`; }, onkeydown: (e) => { if (e.key === 'Enter') location.hash = `#/addons/${x.id}`; } },
      h('h2', {}, x.nome), h('p', { class: 'small desc' }, x.desc), h('span', { class: 'badge gold price' }, x.preco), h('p', { class: 'small muted' }, x.custo),
      h('div', { class: 'foot' }, interesseBtn(x, () => VIEWS.addons()), h('span', { class: 'small muted right' }, 'Ver detalhes →'))))));
};

/* -------------------------------------------------------------- meu plano */
const fmtUso = (i) => (i.unidade === 'bytes' ? `${fmtBytes(i.usado)} de ${fmtBytes(i.limite)}` : i.limite == null ? (i.usado == null ? 'Incluído' : `${i.usado} ${i.unidade}`) : `${i.usado} de ${i.limite} ${i.unidade}`);
VIEWS.plano = async () => {
  const p = await api('/api/plano');
  const barra = (i) => {
    if (i.limite == null) return h('span', { class: 'badge ok' }, 'sem limite');
    const pct = Math.min(100, Math.round((i.usado / i.limite) * 100));
    const fill = h('i', { class: pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : '' });
    fill.style.width = `${Math.max(pct, 2)}%`;
    return h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, fill);
  };
  main.replaceChildren(secao('Meu plano e consumo'),
    h('div', { class: 'notice' }, h('b', {}, p.plano.nome), h('div', { class: 'small' }, p.plano.referencia, '. Consumo de ', p.mes, '.')),
    h('h2', {}, 'O que o plano cobre'),
    h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Recurso', 'Uso', '', 'E se passar do limite'].map((t) => h('th', {}, t)))),
      h('tbody', {}, p.cobertos.map((i) => h('tr', {}, h('td', {}, i.nome), h('td', {}, fmtUso(i)), h('td', { class: 'barcell' }, barra(i)),
        h('td', { class: 'small' }, i.addon ? h('a', { href: `#/addons/${i.addon}` }, i.extra) : i.extra)))))),
    h('div', { class: 'card stack' }, h('h2', {}, 'Também incluído'), h('ul', { class: 'dots stack small' }, p.inclusos.map((t) => h('li', {}, t)))),
    h('h2', {}, 'O que está fora do plano (add-ons)'),
    h('p', { class: 'small muted' }, 'Clique para ver como funciona e quanto custa cada um. Nada é cobrado no piloto.'),
    h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Serviço', 'Valor de referência', 'Custo a mais'].map((t) => h('th', {}, t)))),
      h('tbody', {}, p.fora.map((f) => h('tr', { class: 'clicavel', tabindex: 0, onclick: () => { location.hash = `#/addons/${f.id}`; }, onkeydown: (e) => { if (e.key === 'Enter') location.hash = `#/addons/${f.id}`; } }, h('td', {}, h('a', { href: `#/addons/${f.id}` }, f.nome)), h('td', {}, f.preco), h('td', { class: 'small' }, f.custo)))))));
};

/* ------------------------------------------------------------------- equipe */
VIEWS.equipe = async () => {
  const us = await api('/api/usuarios');
  const n = h('input', { placeholder: 'Nome' }), e = h('input', { type: 'email', placeholder: 'e-mail' }), caixa = h('div');
  main.replaceChildren(secao('Equipe e acessos'), caixa,
    h('div', { class: 'card stack' }, h('h2', {}, 'Novo funcionário'), h('p', { class: 'small muted' }, 'O funcionário vê apenas os casos atribuídos a ele e não aprova textos para o portal.'), h('div', { class: 'grid2' }, campo('Nome', n), campo('E-mail', e)),
      h('div', {}, h('button', { class: 'btn gold', onclick: guard(async () => { const r = await api('/api/usuarios', { method: 'POST', body: { nome: n.value, email: e.value } }); caixa.replaceChildren(h('div', { class: 'notice stack' }, h('b', {}, 'Funcionário criado'), h('p', {}, `E-mail: ${r.email}`), h('p', {}, 'Senha temporária: ', h('b', {}, r.senha_temporaria)), h('p', { class: 'small muted' }, 'Aparece só agora. Peça para trocar a senha no primeiro acesso.'))); }) }, 'Criar acesso'))),
    h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Nome', 'E-mail', 'Perfil', 'Termos aceitos', 'Situação'].map((t) => h('th', {}, t)))),
      h('tbody', {}, us.map((u) => h('tr', {}, h('td', {}, u.nome), h('td', {}, u.email), h('td', {}, h('span', { class: 'badge' }, u.role)), h('td', {}, u.role === 'cliente' ? (u.aceite_em ? fmtData(u.aceite_em) : 'pendente') : '-'),
        h('td', {}, u.id === me.id ? h('span', { class: 'badge ok' }, 'você') : h('button', { class: 'btn sm', onclick: guard(async () => { await api(`/api/usuarios/${u.id}`, { method: 'PATCH', body: { ativo: !u.ativo } }); VIEWS.equipe(); }) }, u.ativo ? 'Ativo (desativar)' : 'Inativo (ativar)'))))))));
};

VIEWS.auditoria = async () => {
  const l = await api('/api/auditoria');
  main.replaceChildren(secao('Auditoria'), h('p', { class: 'small muted' }, 'Últimas 200 ações: quem entrou, abriu, baixou ou aprovou. Útil para LGPD e para o sigilo profissional.'),
    h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Quando', 'Quem', 'Ação', 'Alvo'].map((t) => h('th', {}, t)))), h('tbody', {}, l.map((a) => h('tr', {}, h('td', {}, a.criado_em.replace('T', ' ').slice(0, 16)), h('td', {}, a.nome || '-'), h('td', {}, a.acao), h('td', {}, a.alvo || '')))))));
};

/* -------------------------------------------------------------------- boot */
(async () => {
  me = await api('/api/me');
  document.getElementById('quem').textContent = `${me.nome} · ${me.role}`;
  document.getElementById('senha').addEventListener('click', () => senhaDialog());
  document.getElementById('sair').addEventListener('click', sair);
  // menu hambúrguer (mobile): abre/fecha, fecha ao navegar e com Esc
  const side = document.getElementById('side'), burger = document.getElementById('burger');
  const menu = (abrir) => { side.classList.toggle('open', abrir); burger.setAttribute('aria-expanded', String(abrir)); burger.setAttribute('aria-label', abrir ? 'Fechar menu' : 'Abrir menu'); };
  burger.addEventListener('click', () => menu(!side.classList.contains('open')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu(false); });
  document.getElementById('nav').addEventListener('click', (e) => { if (e.target.closest('a')) menu(false); });
  // senha temporária: troca obrigatória. Contrato: o advogado precisa aceitar antes de qualquer uso.
  if (me.must_change) { senhaDialog({ forcado: true }); return; }
  if (!me.contrato_aceito) {
    if (me.role === 'admin') await contratoDialog().catch(erro);
    else modal({ titulo: 'Contrato pendente', fechavel: false, corpo: h('p', {}, 'O advogado responsável precisa aceitar o contrato do painel antes de a equipe usar o sistema.'), acoes: [{ texto: 'Sair', classe: 'gold', onclick: async () => { await sair(); return true; } }] });
    return;
  }
  // Uso de IA: decisão obrigatória do advogado, uma vez; sem autorização, a IA fica totalmente desativada
  if (me.role === 'admin' && me.ia_opcao_b === 'pendente') await autorizacaoIaDialog({ forcado: true }).catch(erro);
  montaNav();
  window.addEventListener('hashchange', () => { menu(false); rota(); });
  rota();
})();
