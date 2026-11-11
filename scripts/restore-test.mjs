// Teste de restauração: baixa do R2 o backup mais recente, decifra e confere a integridade do SQLite.
// Uso: node scripts/restore-test.mjs [db/app-AAAA-MM-DD-HH-MM.db.enc]   (sem argumento usa o último backup local)
// Não grava nada em data/ e não imprime conteúdo do banco, só contagens.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { r2Config, r2Baixa, decifra } from '../lib/r2.mjs';

const cfg = r2Config();
if (!cfg) { console.error('FALHA: variáveis R2_* / BACKUP_ENC_KEY ausentes.'); process.exit(1); }

let chave = process.argv[2];
if (!chave) {
  const dir = path.join(path.resolve(process.env.DATA_DIR || 'data'), 'backups');
  const ultimo = fs.readdirSync(dir).filter((f) => /^app-.*\.db$/.test(f)).sort().pop();
  if (!ultimo) { console.error('FALHA: nenhum backup local para deduzir o nome.'); process.exit(1); }
  chave = `db/${ultimo}.enc`;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-'));
try {
  const cifrado = await r2Baixa(cfg, chave);
  const limpo = decifra(cfg.chave, cifrado);
  const arq = path.join(tmp, 'restaurado.db');
  fs.writeFileSync(arq, limpo, { mode: 0o600 });
  const db = new DatabaseSync(arq, { readOnly: true });
  const integridade = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const tabelas = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name);
  const linhas = tabelas.map((t) => `${t}=${db.prepare(`SELECT COUNT(*) n FROM "${t.replace(/"/g, '""')}"`).get().n}`);
  db.close();
  console.log(`Objeto: ${chave} (${cifrado.length} bytes cifrados, ${limpo.length} bytes decifrados)`);
  console.log(`integrity_check: ${integridade}`);
  console.log(`Tabelas (${tabelas.length}): ${linhas.join(', ')}`);
  console.log(integridade === 'ok' ? 'RESTAURAÇÃO OK' : 'FALHA: banco restaurado corrompido');
  process.exitCode = integridade === 'ok' ? 0 : 1;
} catch (e) {
  console.error(`FALHA: ${e.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
