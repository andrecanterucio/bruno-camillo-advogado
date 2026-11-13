// Limpa o que uma importação repetida do Trello duplicou: colunas com o mesmo nome (maiúsculas/acentos) e cartões repetidos.
//   node scripts/limpar-duplicados.mjs            -> só mostra o que faria (nada é alterado)
//   node scripts/limpar-duplicados.mjs --aplicar  -> faz uma cópia do banco e aplica
// Cartão repetido = mesma coluna, título, notas, etiquetas E mesma posição de importação (campo "ordem"): vem de duas importações,
// nunca de dois cartões iguais da mesma importação. Cartões que já têm andamento, documento ou publicação NUNCA são apagados.
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, tx, DATA_DIR } from '../lib/db.mjs';

const aplicar = process.argv.includes('--aplicar');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// 1) colunas duplicadas
const porNome = new Map();
for (const f of all('SELECT id, nome, ordem FROM fases ORDER BY ordem, id')) { const k = norm(f.nome); porNome.set(k, [...(porNome.get(k) || []), f]); }
const fasesRepetidas = [...porNome.values()].filter((g) => g.length > 1);
const mapaFase = new Map(); // id repetido -> id que fica
for (const g of fasesRepetidas) for (const f of g.slice(1)) mapaFase.set(f.id, g[0].id);
console.log(`Colunas repetidas: ${fasesRepetidas.length}`);
for (const g of fasesRepetidas) console.log(`  "${g[0].nome}" (fica) <- ${g.slice(1).map((f) => `"${f.nome}"`).join(', ')}`);

// 2) cartões duplicados (já considerando as colunas unificadas)
const faseFinal = (id) => mapaFase.get(id) ?? id;
const grupos = new Map();
for (const c of all('SELECT id, titulo, notas, etiquetas, fase_id, ordem FROM casos ORDER BY id')) {
  const k = JSON.stringify([faseFinal(c.fase_id), c.titulo, c.notas || '', c.etiquetas || '', c.ordem]);
  grupos.set(k, [...(grupos.get(k) || []), c]);
}
const apagar = [], mantidos = [];
for (const g of grupos.values()) {
  if (g.length < 2) continue;
  for (const c of g.slice(1)) {
    const usado = get('SELECT (SELECT COUNT(*) FROM andamentos WHERE caso_id=?) + (SELECT COUNT(*) FROM documentos WHERE caso_id=?) + (SELECT COUNT(*) FROM publicacoes WHERE caso_id=?) n', c.id, c.id, c.id).n;
    (usado ? mantidos : apagar).push(c);
  }
}
const total = get('SELECT COUNT(*) n FROM casos').n;
console.log(`Cartões: ${total} no total, ${apagar.length} repetidos para apagar, ${mantidos.length} repetidos mantidos por terem andamento/documento/publicação.`);

if (!aplicar) { console.log('\nNada foi alterado. Para aplicar: node scripts/limpar-duplicados.mjs --aplicar'); process.exit(0); }

const copia = path.join(DATA_DIR, `app.db.antes-limpeza-${Date.now()}`);
fs.copyFileSync(path.join(DATA_DIR, 'app.db'), copia);
console.log(`\nCópia do banco: ${copia}`);
tx(() => {
  for (const [de, para] of mapaFase) run('UPDATE casos SET fase_id=? WHERE fase_id=?', para, de);
  for (const c of apagar) run('DELETE FROM casos WHERE id=?', c.id);
  for (const de of mapaFase.keys()) run('DELETE FROM fases WHERE id=?', de);
});
console.log(`Feito. Cartões agora: ${get('SELECT COUNT(*) n FROM casos').n}. Colunas: ${all('SELECT nome FROM fases ORDER BY ordem').map((f) => f.nome).join(' | ')}`);
