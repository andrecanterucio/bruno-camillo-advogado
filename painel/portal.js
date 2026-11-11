import { h, api, toast, fmtData, fmtBytes, senhaDialog, sair } from './common.js';

const app = document.getElementById('app');
let me;

const AVISO = 'Este resumo ajuda você a entender o andamento. Ele não substitui a orientação do seu advogado. ' +
  'Prazos e decisões valem pelo que consta no processo. Em caso de dúvida, fale com o escritório.';

function cabecalho(voltar) {
  return h('header', {},
    h('img', { src: '/assets/logo-escudo.png', alt: 'Bruno Camillo Advogado' }),
    h('div', {}, h('b', {}, 'Bruno Camillo Advogado'), h('div', { class: 'small muted' }, `Olá, ${me.nome.split(' ')[0]}`)),
    h('div', { class: 'row right' }, voltar ? h('button', { class: 'btn sm', onclick: lista }, 'Meus processos') : null,
      h('button', { class: 'btn sm ghost', onclick: senhaDialog }, 'Senha'), h('button', { class: 'btn sm ghost', onclick: sair }, 'Sair')));
}

async function aceite() {
  return new Promise((resolve) => {
    const chk = h('input', { type: 'checkbox', id: 'ac' });
    const btn = h('button', { class: 'btn gold', disabled: true, onclick: async () => { await api('/api/auth/aceite', { method: 'POST' }); resolve(); } }, 'Entrar no portal');
    chk.addEventListener('change', () => { btn.disabled = !chk.checked; });
    app.replaceChildren(h('div', { class: 'card stack' }, h('h1', {}, 'Antes de começar'),
      h('p', {}, 'Este portal mostra como estão os seus processos, em linguagem simples, e guarda os documentos do seu caso.'),
      h('ul', { class: 'dots stack' },
        h('li', {}, 'Seus dados são usados só para o seu atendimento jurídico, e o seu advogado tem dever de sigilo.'),
        h('li', {}, 'Alguns resumos são escritos com a ajuda de inteligência artificial. O seu advogado lê e aprova cada um antes de você ver. Quando isso acontece, trechos do andamento, sem o seu nome e documentos, são enviados a uma empresa de tecnologia em outro país.'),
        h('li', {}, 'Você escolhe: pode pedir ao seu advogado, a qualquer momento, para não usar IA no seu caso.'),
        h('li', {}, 'O resumo ajuda a entender, mas não substitui a conversa com o seu advogado. Prazos e decisões valem pelo que consta no processo.')),
      h('p', { class: 'notice small' }, 'Texto provisório do piloto, sujeito à revisão jurídica do escritório antes do uso com clientes reais.'),
      h('label', { class: 'row', for: 'ac' }, chk, 'Li e concordo em usar o portal.'), h('div', {}, btn)));
  });
}

async function lista() {
  const casos = await api('/api/portal/casos');
  app.replaceChildren(cabecalho(false), h('h1', {}, 'Meus processos'), h('div', { class: 'stack' },
    casos.length ? casos.map((c) => h('button', { class: 'casolink', onclick: () => detalhe(c.id) },
      h('b', {}, c.titulo), h('div', { class: 'row small muted' }, h('span', { class: 'badge gold' }, c.fase), c.area ? h('span', {}, c.area) : null, c.ultimo ? h('span', {}, `Última novidade: ${fmtData(c.ultimo)}`) : h('span', {}, 'Sem novidades publicadas ainda')))) : h('p', { class: 'muted' }, 'Nenhum processo vinculado ao seu acesso ainda.')),
    h('p', { class: 'small muted' }, AVISO));
}

async function detalhe(id) {
  const d = await api(`/api/portal/casos/${id}`);
  app.replaceChildren(cabecalho(true),
    h('div', { class: 'stack' }, h('h1', {}, d.caso.titulo), h('div', { class: 'row' }, h('span', { class: 'badge gold' }, d.caso.fase), d.caso.area ? h('span', { class: 'badge' }, d.caso.area) : null, d.caso.numero_cnj ? h('span', { class: 'small muted' }, `Processo ${d.caso.numero_cnj}`) : null),
      d.aviso_sem_novidade ? h('p', { class: 'notice', role: 'status' }, d.aviso_sem_novidade) : null,
      h('h2', {}, 'O que aconteceu'),
      d.andamentos.length ? h('div', { class: 'timeline' }, d.andamentos.map((a) => h('div', { class: 't' }, h('b', {}, fmtData(a.data)), h('p', {}, a.texto_simples), a.ia ? h('span', { class: 'small muted' }, 'Resumo feito com ajuda de IA e revisado pelo seu advogado.') : null)))
        : h('p', { class: 'muted' }, 'Ainda não há novidades publicadas. Assim que houver, aparecem aqui.'),
      h('h2', {}, 'Documentos'),
      d.documentos.length ? h('div', { class: 'list' }, d.documentos.map((x) => h('div', { class: 'row' }, h('a', { href: `/api/documentos/${x.id}/download` }, x.nome), h('span', { class: 'small muted' }, `${fmtBytes(x.tamanho)} · ${fmtData(x.criado_em)}`)))) : h('p', { class: 'muted' }, 'Nenhum documento compartilhado com você.'),
      h('p', { class: 'notice small' }, AVISO)));
}

(async () => {
  me = await api('/api/me');
  if (me.must_change) { senhaDialog({ forcado: true }); return; }
  const go = async () => { try { await lista(); } catch (e) { if (e.message === 'aceite') { await aceite(); await go(); } else toast(e.message, 'bad'); } };
  await go();
})();
