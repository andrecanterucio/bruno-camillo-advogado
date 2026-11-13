// Avisos de prazo no painel: sino, preferências (e-mail e notificação no aparelho) e inscrição de push.
import { h, api, toast, modal } from './common.js';

export const ANTECEDENCIAS = [2880, 1440, 60, 15, 0];
export const rotuloAntecedencia = (m) => (m === 0 ? 'na hora' : m === 15 ? '15 min antes' : m === 60 ? '1 hora antes' : m === 1440 ? '1 dia antes' : '2 dias antes');
export const iniciais = (nome) => String(nome || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

/** Cor do prazo: vermelho vencido, amarelo se faltam menos de 48 h, azul no resto (horário de Brasília). */
export function classePrazo(data, hora) {
  const t = Date.parse(`${data}T${/^\d{2}:\d{2}$/.test(hora || '') ? hora : '09:00'}:00-03:00`);
  const falta = t - Date.now();
  return falta < 0 ? 'bad' : falta < 48 * 3600e3 ? 'warn' : 'blue';
}

export async function atualizaSino() {
  try {
    const r = await api('/api/notificacoes');
    const b = document.getElementById('avisos');
    if (b) { b.textContent = r.nao_lidas ? `Avisos (${r.nao_lidas})` : 'Avisos'; b.classList.toggle('gold', r.nao_lidas > 0); }
    return r;
  } catch { return null; }
}

const b64ToBytes = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
const suportaPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const ehIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const instalado = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

export async function registraServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try { await navigator.serviceWorker.register('/painel-sw.js', { scope: '/painel' }); } catch { /* sem push, o resto funciona */ }
}

async function inscricaoAtual() {
  if (!suportaPush()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/painel');
  return reg ? reg.pushManager.getSubscription() : null;
}

async function ativaPush() {
  if (!suportaPush()) throw new Error('Este navegador não suporta notificações.');
  if (ehIos() && !instalado()) throw new Error('No iPhone: toque em Compartilhar, depois em "Adicionar à Tela de Início", abra o painel pelo ícone e ative aqui.');
  if (await Notification.requestPermission() !== 'granted') throw new Error('A permissão de notificação foi negada. Libere nas configurações do navegador para este site.');
  const reg = await navigator.serviceWorker.register('/painel-sw.js', { scope: '/painel' }).then(() => navigator.serviceWorker.ready);
  const { chave } = await api('/api/push/chave');
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(chave) });
  await api('/api/push/inscrever', { method: 'POST', body: sub.toJSON() });
  await api('/api/eu/avisos', { method: 'PATCH', body: { push: true } });
}

async function desativaPush() {
  const sub = await inscricaoAtual();
  if (sub) { await api('/api/push/cancelar', { method: 'POST', body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
}

export async function avisosDialog(me, abrirCaso) {
  const r = (await atualizaSino()) || { itens: [], nao_lidas: 0 };
  const fmt = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const sub = await inscricaoAtual();
  const email = h('input', { type: 'checkbox', checked: me.avisos_email, onchange: async (e) => { await api('/api/eu/avisos', { method: 'PATCH', body: { email: e.target.checked } }); me.avisos_email = e.target.checked; toast(e.target.checked ? 'Avisos por e-mail ligados.' : 'Avisos por e-mail desligados.', 'ok'); } });
  const push = h('input', { type: 'checkbox', checked: !!sub && me.avisos_push, onchange: async (e) => {
    try {
      if (e.target.checked) { await ativaPush(); me.avisos_push = true; toast('Notificações ligadas neste aparelho.', 'ok'); }
      else { await desativaPush(); await api('/api/eu/avisos', { method: 'PATCH', body: { push: false } }); me.avisos_push = false; toast('Notificações desligadas neste aparelho.', 'ok'); }
    } catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'bad'); }
  } });
  const padrao = h('select', { onchange: async (e) => { await api('/api/eu/avisos', { method: 'PATCH', body: { padrao: +e.target.value } }); me.aviso_padrao = +e.target.value; toast('Padrão salvo.', 'ok'); } },
    ANTECEDENCIAS.map((m) => h('option', { value: m, selected: m === (me.aviso_padrao ?? 1440) }, rotuloAntecedencia(m))));
  const teste = h('button', { class: 'btn sm', onclick: async () => { try { await api('/api/push/teste', { method: 'POST' }); toast('Teste enviado. Deve chegar em instantes.', 'ok'); } catch (err) { toast(err.message, 'bad'); } } }, 'Enviar notificação de teste');
  const lista = r.itens.length
    ? h('div', { class: 'list' }, r.itens.map((n) => h('div', { class: `stack ${n.caso_id ? 'clicavel' : ''}`, tabindex: n.caso_id ? 0 : null, role: n.caso_id ? 'link' : null, title: n.caso_id ? 'Abrir o caso' : null,
      onclick: () => { if (n.caso_id && abrirCaso) { document.querySelector('.modal-shade')?.remove(); document.querySelector('.modal')?.remove(); abrirCaso(n.caso_id, 'prazos'); } } },
      h('div', { class: 'row' }, !n.lida ? h('span', { class: 'badge gold' }, 'novo') : null, h('b', {}, n.titulo)), h('div', { class: 'small muted' }, `${fmt(n.criado_em)} · ${n.corpo || ''}`))))
    : h('p', { class: 'muted' }, 'Nenhum aviso ainda. Os lembretes de prazo dos casos em que você é membro aparecem aqui.');
  modal({ titulo: 'Avisos', larga: true, corpo: h('div', { class: 'stack' }, lista,
    h('div', { class: 'card stack' }, h('h3', {}, 'Como quero ser avisado'),
      h('label', { class: 'row' }, email, 'Por e-mail'),
      h('label', { class: 'row' }, push, 'Por notificação neste aparelho (celular ou computador)'),
      h('div', {}, h('label', {}, 'Antecedência padrão dos prazos novos'), padrao),
      h('p', { class: 'small muted' }, 'Cada aparelho precisa ser ativado uma vez. Os avisos valem para os casos em que você é membro, na antecedência escolhida em cada prazo.'),
      h('div', {}, teste))),
    acoes: [{ texto: 'Fechar', classe: 'ghost', onclick: async () => true }] });
  if (r.nao_lidas) { await api('/api/notificacoes/lidas', { method: 'POST' }).catch(() => {}); atualizaSino(); }
}
