// Traduz o registro de auditoria em texto legível e descobre para onde o alvo aponta (caso, cliente).
import { get } from './db.mjs';

const ACOES = {
  login: 'Entrou no sistema',
  'aceite.termos': 'Aceitou os termos do portal',
  'senha.alterar': 'Alterou a senha',
  'contrato.aceitar': 'Assinou o contrato',
  'ia.termo.aceitar': 'Autorizou o uso de IA',
  'ia.opcao_b.recusar': 'Recusou o uso de IA',
  'ia.caso.habilitar': 'Ligou a IA em um caso',
  'ia.caso.desabilitar': 'Desligou a IA em um caso',
  'ia.traduzir': 'Gerou resumo com IA',
  'caso.criar': 'Criou um caso',
  'caso.ver': 'Abriu um caso',
  'caso.editar': 'Editou um caso',
  'caso.excluir': 'Excluiu um caso',
  'datajud.sync': 'Atualizou pelo DataJud',
  'andamento.aprovar': 'Aprovou um andamento',
  'andamento.reprovar': 'Reprovou um andamento',
  'documento.enviar': 'Enviou um documento',
  'documento.visibilidade': 'Mudou a visibilidade de um documento',
  'documento.excluir': 'Excluiu um documento',
  'documento.baixar': 'Baixou um documento',
  'cliente.acesso': 'Criou acesso ao portal para um cliente',
  'cliente.exportar': 'Exportou os dados de um cliente',
  'cliente.anonimizar': 'Anonimizou um cliente',
  'usuario.criar': 'Criou um usuário da equipe',
  'usuario.ativar': 'Reativou um usuário',
  'usuario.desativar': 'Desativou um usuário',
  'djen.sync': 'Buscou publicações no DJEN',
  'addon.interesse': 'Marcou interesse em um add-on',
  'portal.ver_caso': 'Cliente abriu o processo no portal',
};

/** Grupo usado no filtro da tela. */
export function categoria(acao) {
  const p = String(acao).split('.')[0];
  return ({ login: 'acesso', senha: 'acesso', aceite: 'acesso', contrato: 'acesso', caso: 'casos', andamento: 'casos', datajud: 'casos', documento: 'documentos', cliente: 'clientes', portal: 'clientes', ia: 'ia', usuario: 'equipe', addon: 'equipe', djen: 'casos' })[p] || 'outros';
}

/** Enriquece uma linha de auditoria: texto, rótulo do alvo e link (caso/cliente) quando o alvo ainda existe. */
export function descreve(a) {
  const acao = a.acao;
  const id = Number(a.alvo);
  let casoId = null, clienteId = null, alvoTexto = a.alvo || '';
  if (/^(caso\.|portal\.|ia\.caso\.|datajud\.)/.test(acao)) casoId = id;
  else if (acao.startsWith('andamento.') || acao === 'ia.traduzir') casoId = get('SELECT caso_id c FROM andamentos WHERE id=?', id)?.c ?? null;
  else if (acao.startsWith('documento.')) { const d = get('SELECT caso_id c, nome FROM documentos WHERE id=?', id); casoId = d?.c ?? null; if (d) alvoTexto = d.nome; }
  else if (acao.startsWith('cliente.')) clienteId = id;
  let link = null;
  if (casoId && Number.isFinite(casoId)) {
    const c = get('SELECT titulo FROM casos WHERE id=?', casoId);
    if (c) { link = { tipo: 'caso', id: casoId }; if (!acao.startsWith('documento.')) alvoTexto = c.titulo; else alvoTexto = `${alvoTexto} (${c.titulo})`; }
    else alvoTexto = 'caso removido';
  } else if (clienteId && Number.isFinite(clienteId)) {
    const c = get('SELECT nome FROM clientes WHERE id=?', clienteId);
    if (c) { link = { tipo: 'cliente', id: clienteId }; alvoTexto = c.nome; } else alvoTexto = 'cliente removido';
  }
  return { ...a, texto: ACOES[acao] || acao, categoria: categoria(acao), alvo_texto: alvoTexto, link };
}
