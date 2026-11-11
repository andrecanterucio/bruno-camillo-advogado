// Backup consistente do SQLite (VACUUM INTO) + limpeza de backups antigos.
// Uso: node scripts/backup.mjs        (ou: npm run backup)
// Depois, envie data/backups e data/uploads para fora do servidor (ex.: rclone com "crypt" para o R2).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA = path.resolve(process.env.DATA_DIR || 'data');
const OUT = path.join(DATA, 'backups');
const MANTER_DIAS = +(process.env.BACKUP_KEEP_DAYS || 14);
fs.mkdirSync(OUT, { recursive: true });

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const destino = path.join(OUT, `app-${stamp}.db`);
const db = new DatabaseSync(path.join(DATA, 'app.db'));
db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
db.close();
fs.chmodSync(destino, 0o600);

let apagados = 0;
for (const f of fs.readdirSync(OUT)) {
  const p = path.join(OUT, f);
  if (/^app-.*\.db$/.test(f) && Date.now() - fs.statSync(p).mtimeMs > MANTER_DIAS * 864e5) { fs.rmSync(p); apagados++; }
}
const tamanho = (fs.statSync(destino).size / 1024).toFixed(0);
console.log(`Backup criado: ${destino} (${tamanho} KB). Removidos ${apagados} antigos (mais de ${MANTER_DIAS} dias).`);
console.log('Lembrete: copiar também data/uploads e levar tudo para fora do servidor, com criptografia.');
