// Backup consistente do SQLite (VACUUM INTO) + limpeza de backups antigos.
// Uso: node scripts/backup.mjs        (ou: npm run backup)
// Depois, envie data/backups e data/uploads para fora do servidor (ex.: rclone com "crypt" para o R2).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { r2Config, r2Existe, r2Envia, cifra } from '../lib/r2.mjs';

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

// Envio para fora do servidor (Cloudflare R2), sempre criptografado aqui antes de sair.
const cfg = r2Config();
if (!cfg) {
  console.warn('AVISO: R2_* e BACKUP_ENC_KEY não definidos. Backup só local (dentro do mesmo servidor).');
} else {
  await r2Envia(cfg, `db/${path.basename(destino)}.enc`, cifra(cfg, fs.readFileSync(destino)));
  let novos = 0;
  const UP = path.join(DATA, 'uploads');
  for (const f of fs.existsSync(UP) ? fs.readdirSync(UP) : []) {
    const p = path.join(UP, f);
    if (!fs.statSync(p).isFile()) continue;
    const k = `uploads/${f}.enc`;
    if (await r2Existe(cfg, k)) continue; // arquivos são imutáveis: só envia os novos
    await r2Envia(cfg, k, cifra(cfg, fs.readFileSync(p)));
    novos++;
  }
  console.log(`Enviado ao R2 (criptografado): banco + ${novos} documento(s) novo(s).`);
}
