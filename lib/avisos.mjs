import { get } from './db.mjs';

// Aviso de "sem novidades": aparece quando o tribunal não movimenta o caso há mais de 10 dias.
// A referência é a última movimentação real (andamentos de qualquer status + publicações do DJEN vinculadas),
// não só o que já foi aprovado para o cliente. Segredo de justiça nunca recebe o aviso.
// A frase gira a cada 10 dias de silêncio e é fixa dentro de cada janela (não muda ao recarregar a página).
const DIAS_SEM_NOVIDADE = 10;
const AVISOS_SEM_NOVIDADE = [
  'Ainda não houve andamento novo no tribunal, e tudo bem: os prazos da Justiça costumam ser mais lentos do que gostaríamos. Os advogados do escritório continuam de olho no seu caso e, assim que algo mudar, você fica sabendo por aqui.',
  'O tribunal ainda não registrou novidades no seu processo. É comum: a Justiça tem o próprio ritmo. Seguimos acompanhando de perto, e qualquer atualização aparece aqui para você.',
  'Sem movimentação nova por enquanto. Isso não significa que o caso está parado: os advogados do escritório continuam atentos e vão agir assim que houver andamento.',
  'Passaram alguns dias sem andamento no tribunal, o que acontece em muitos processos. Nossa equipe segue acompanhando o seu caso, e qualquer novidade aparece aqui.',
  'Nada de novo no tribunal até agora, e isso é normal em muitos casos. Seguimos atentos ao seu processo e, quando houver qualquer movimento, ele aparece aqui.',
];
export function avisoSemNovidade(casoId, agora = Date.now()) {
  const c = get('SELECT segredo, criado_em FROM casos WHERE id=?', casoId);
  if (!c || c.segredo) return null;
  // criado_em só vale se o caso nunca teve movimentação (senão um caso antigo recém-importado esconderia o aviso)
  const reais = [
    get('SELECT MAX(data) d FROM andamentos WHERE caso_id=?', casoId)?.d,
    get('SELECT MAX(data_disp) d FROM publicacoes WHERE caso_id=?', casoId)?.d,
  ].map((d) => Date.parse(d)).filter((t) => Number.isFinite(t));
  const datas = reais.length ? reais : [Date.parse(c.criado_em)].filter((t) => Number.isFinite(t));
  if (!datas.length) return null;
  const dias = Math.floor((agora - Math.max(...datas)) / 864e5);
  if (dias <= DIAS_SEM_NOVIDADE) return null;
  return AVISOS_SEM_NOVIDADE[Math.floor(dias / DIAS_SEM_NOVIDADE) % AVISOS_SEM_NOVIDADE.length];
}
