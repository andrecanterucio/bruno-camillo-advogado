// Cliente mínimo do Cloudflare R2 (API S3, assinatura SigV4) e criptografia AES-256-GCM. Sem dependências.
// O R2 só recebe dado já criptografado aqui no servidor; a chave (BACKUP_ENC_KEY) nunca sai do ambiente.
import crypto from 'node:crypto';

const sha = (d) => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();

export function r2Config() {
  const { R2_ACCOUNT_ID: conta, R2_ACCESS_KEY_ID: id, R2_SECRET_ACCESS_KEY: segredo, R2_BUCKET: bucket, BACKUP_ENC_KEY: chave } = process.env;
  if (!conta || !id || !segredo || !bucket || !chave) return null;
  return { conta, id, segredo, bucket, chave };
}

async function chamar(cfg, metodo, chaveObj, corpo = Buffer.alloc(0)) {
  const host = `${cfg.conta}.r2.cloudflarestorage.com`;
  const caminho = `/${cfg.bucket}/${chaveObj.split('/').map(encodeURIComponent).join('/')}`;
  const agora = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dia = agora.slice(0, 8);
  const hash = sha(corpo);
  const cab = { host, 'x-amz-content-sha256': hash, 'x-amz-date': agora };
  const nomes = Object.keys(cab).sort();
  const canon = [metodo, caminho, '', ...nomes.map((n) => `${n}:${cab[n]}`), '', nomes.join(';'), hash].join('\n');
  const escopo = `${dia}/auto/s3/aws4_request`;
  const aSign = ['AWS4-HMAC-SHA256', agora, escopo, sha(canon)].join('\n');
  const k = hmac(hmac(hmac(hmac(`AWS4${cfg.segredo}`, dia), 'auto'), 's3'), 'aws4_request');
  const assinatura = crypto.createHmac('sha256', k).update(aSign).digest('hex');
  const r = await fetch(`https://${host}${caminho}`, {
    method: metodo,
    headers: { ...cab, authorization: `AWS4-HMAC-SHA256 Credential=${cfg.id}/${escopo}, SignedHeaders=${nomes.join(';')}, Signature=${assinatura}` },
    body: metodo === 'PUT' ? corpo : undefined,
  });
  return r;
}

export const r2Existe = async (cfg, chaveObj) => (await chamar(cfg, 'HEAD', chaveObj)).status === 200;
export async function r2Envia(cfg, chaveObj, buf) {
  const r = await chamar(cfg, 'PUT', chaveObj, buf);
  if (!r.ok) throw new Error(`R2 ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

/** Formato: "BKP1" | salt(16) | iv(12) | tag(16) | dado cifrado. A chave é derivada com scrypt. */
export function cifra(cfg, buf) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(cfg.chave, salt, 32), iv);
  const dado = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([Buffer.from('BKP1'), salt, iv, c.getAuthTag(), dado]);
}
export function decifra(chave, buf) {
  if (buf.subarray(0, 4).toString() !== 'BKP1') throw new Error('Formato inválido.');
  const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(chave, buf.subarray(4, 20), 32), buf.subarray(20, 32));
  d.setAuthTag(buf.subarray(32, 48));
  return Buffer.concat([d.update(buf.subarray(48)), d.final()]);
}
