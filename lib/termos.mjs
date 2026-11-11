// Textos exibidos nas caixas de diálogo de aceite. PROVISÓRIOS: em revisão jurídica.
// O contrato vem de lib/contratos/gestao.md (versão no comentário da 1ª linha); trocar o arquivo
// pelo texto final do jurídico muda versão e hash, e exige novo aceite.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './util.mjs';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'contratos');

export function contratoGestao() {
  const texto = fs.readFileSync(path.join(DIR, 'gestao.md'), 'utf8');
  const versao = (texto.match(/^<!--\s*versao:\s*(\S+)\s*-->/m) || [])[1] || 'gestao-sem-versao';
  const limpo = texto.replace(/^<!--.*?-->\s*/s, '');
  // Como na tela do zacda-app: resumo em destaque acima e corpo do contrato na caixa rolável.
  // Ficam fora da caixa o resumo (mostrado à parte) e o bloco interno "Campos a preencher".
  const rResumo = /^## Resumo em 6 pontos[^\n]*\n([\s\S]*?)(?=^## )/m;
  const resumo = ((limpo.match(rResumo) || [])[1] || '').split('\n').filter((l) => /^(- |\d+\.\s)/.test(l)).map((l) => l.replace(/^(- |\d+\.\s+)/, ''));
  const corpo = limpo
    .replace(/^## Campos a preencher[^\n]*\n[\s\S]*?(?=^## )/m, '')
    .replace(rResumo, '')
    .replace(/^## FICHA DO PLANO[\s\S]*$/m, '')
    .trim();
  const titulo = ((limpo.match(/^# (.+)$/m) || [])[1] || 'Contrato ZACDA Gestão e Portal do Cliente').trim();
  return { versao, hash: sha256(texto), texto: limpo, corpo, resumo, titulo };
}

/**
 * Três ciências separadas e não pré-marcadas (cláusula 1.5 do contrato). Os textos vêm do próprio
 * contrato (linhas "Ciência A/B/C"), para o que o advogado marca ser exatamente o que o contrato diz.
 */
const CIENCIAS_PADRAO = [
  { id: 'escopo', texto: 'Li e entendo que o Painel é ferramenta de apoio: a ZACDA não presta serviço jurídico, não calcula nem garante prazo processual, e a captura de publicações e andamentos pode falhar ou atrasar. O controle dos prazos continua sendo meu.' },
  { id: 'ia', texto: 'Li e entendo que a inteligência artificial é opcional, fica desligada por padrão em cada caso e só é habilitada por mim, com o consentimento escrito do cliente. Trechos de andamentos, com identificadores mascarados em melhor esforço, são tratados por fornecedor de IA nos Estados Unidos, conforme a cláusula de transferência internacional.' },
  { id: 'limitacao', texto: 'Li e concordo, em destaque, com a limitação de responsabilidade da ZACDA prevista no contrato, inclusive o teto e as exceções, na extensão permitida em lei.' },
];
export function cienciasContrato() {
  const texto = fs.readFileSync(path.join(DIR, 'gestao.md'), 'utf8');
  const achou = Object.fromEntries([...texto.matchAll(/^- \*\*Ciência ([A-C1-3]),[^*]*\*\*\s*"(.+)"\s*$/gm)].map((m) => [m[1], m[2]]));
  const chaves = achou['1'] ? ['1', '2', '3'] : ['A', 'B', 'C'];
  return chaves.every((k) => achou[k])
    ? CIENCIAS_PADRAO.map((c, i) => ({ id: c.id, texto: achou[chaves[i]] }))
    : CIENCIAS_PADRAO;
}

export const IA_TERMO = {
  versao: 'ia-1.1-teste',
  titulo: 'Uso de inteligência artificial: você decide',
  paragrafos: [
    'O painel pode escrever, com ajuda de inteligência artificial (IA), um rascunho em linguagem simples de cada andamento. Nada chega ao seu cliente sem a sua aprovação.',
    'A IA vem desligada em todos os casos. Você liga caso a caso, depois de ter o consentimento escrito do cliente. Em segredo de justiça, nunca liga.',
    'Quando a IA está ligada, trechos do andamento (com CPF, telefone, e-mail e nomes escondidos, em melhor esforço) vão a um fornecedor de IA nos Estados Unidos, que pode guardá-los por até 30 dias.',
    'Por que pedimos a sua autorização: a lei exige uma base para enviar dados ao exterior, e a ZACDA ainda não tem o contrato-padrão da ANPD com esse fornecedor. Ao autorizar, você, que responde pelos dados dos seus clientes, assume essa base (por exemplo, o consentimento do cliente).',
  ],
  se_autorizar: 'Se você autorizar: poderá ligar a IA nos casos em que o cliente consentir.',
  se_nao_autorizar: 'Se você não autorizar: a IA fica totalmente desativada, em todos os casos, e não dá para ligar. O painel funciona normalmente e os textos em linguagem simples são escritos por você. Você pode mudar de ideia depois.',
  ciencias: [
    { id: 'base', texto: 'Entendi que trechos dos andamentos vão para um fornecedor nos Estados Unidos e assumo a responsabilidade pelo consentimento dos meus clientes.' },
    { id: 'envio', texto: 'Autorizo o uso de IA nos casos que eu ligar.' },
  ],
};

// Texto do Anexo IV do contrato (Termo de responsabilidade do advogado ao habilitar IA em um caso).
export const CASO_IA_TERMO = {
  versao: 'caso-ia-1.2-teste',
  titulo: 'Ligar a IA neste caso',
  ciencias: [
    { id: 'cliente', texto: 'Meu cliente foi avisado por escrito sobre o uso de IA e o envio de dados ao exterior, e consentiu por escrito na data acima.' },
    { id: 'naosegredo', texto: 'Este caso não corre em segredo de justiça.' },
    { id: 'responsavel', texto: 'Assumo a responsabilidade por ligar a IA neste caso. Se eu ligar sem o consentimento do cliente, posso ter de ressarcir prejuízos da ZACDA (cláusula 9A.9).' },
    { id: 'revoga', texto: 'Sei que meu cliente pode desistir a qualquer momento e que eu desligo a IA no mesmo dia. O que já foi enviado pode ficar guardado por até 30 dias no fornecedor.' },
  ],
  ciencia_sensivel: { id: 'sensivel', texto: 'Este caso pode ter dados sensíveis, de crianças e adolescentes ou sigilosos. Avaliei que a IA é mesmo necessária aqui.' },
  intro: 'Ao ligar, trechos dos andamentos deste caso, com dados pessoais escondidos, vão para um fornecedor de IA nos Estados Unidos, que pode guardá-los por até 30 dias. A IA pode errar, inclusive sobre quem é autor e quem é réu. Nenhum resumo vai ao cliente sem a sua aprovação.',
  aviso_sensivel: 'Atenção: casos de direito penal e de família costumam ter dados muito sensíveis. Só ligue a IA se for realmente útil e se o consentimento do cliente cobrir isso.',
  aviso_segredo: 'Segredo de justiça: a IA não pode ser ligada neste caso.',
};

export const AREAS_SENSIVEIS = ['Penal', 'Família e Sucessões'];
export const ehSensivel = (c) => !!c.segredo || AREAS_SENSIVEIS.includes(c.area);
