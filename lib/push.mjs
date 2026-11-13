// Notificação push (Web Push, RFC 8030/8291/8292) sem dependências: VAPID (ES256) + criptografia aes128gcm com node:crypto.
// As chaves VAPID vêm de VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY (se definidas) ou são geradas uma vez e guardadas em data/vapid.json
// (o volume /app/data persiste entre deploys). A chave privada nunca sai do servidor.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, run } from './db.mjs';

const b64u = (b) => Buffer.from(b).toString('base64url');
const deB64u = (s) => Buffer.from(String(s), 'base64url');

let chaves = null;
function carregaChaves() {
  if (chaves) return chaves;
  const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv } = process.env;
  if (pub && priv) { chaves = { pub, priv }; return chaves; }
  const arq = path.join(DATA_DIR, 'vapid.json');
  try { chaves = JSON.parse(fs.readFileSync(arq, 'utf8')); if (chaves.pub && chaves.priv) return chaves; } catch { /* gera abaixo */ }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pj = publicKey.export({ format: 'jwk' }), kj = privateKey.export({ format: 'jwk' });
  chaves = { pub: b64u(Buffer.concat([Buffer.from([4]), deB64u(pj.x), deB64u(pj.y)])), priv: kj.d };
  fs.writeFileSync(arq, JSON.stringify(chaves), { mode: 0o600 });
  return chaves;
}
export const chavePublica = () => carregaChaves().pub;

function chavePrivadaObj() {
  const { pub, priv } = carregaChaves();
  const raw = deB64u(pub);
  return crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)), d: priv } });
}

// Só falamos com os serviços de push dos navegadores (o endpoint vem do cliente: sem isso seria um SSRF).
const HOSTS_PUSH = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.services\.mozilla\.com$/];
export function endpointValido(ep) {
  try { const u = new URL(ep); return u.protocol === 'https:' && !u.port && HOSTS_PUSH.some((r) => r.test(u.hostname)) && ep.length < 1000; } catch { return false; }
}

function jwtVapid(audience) {
  const enc = (o) => b64u(JSON.stringify(o));
  const corpo = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: process.env.VAPID_SUBJECT || 'mailto:andre.canterucio@zacda.com.br' })}`;
  const sig = crypto.sign('sha256', Buffer.from(corpo), { key: chavePrivadaObj(), dsaEncoding: 'ieee-p1363' });
  return `${corpo}.${b64u(sig)}`;
}

/** Criptografa o payload para a inscrição (RFC 8291, aes128gcm). Exportada para teste. */
export function criptografa(payload, p256dh, auth, { efemera } = {}) {
  const uaPub = deB64u(p256dh), authSecret = deB64u(auth);
  const ecdh = efemera || crypto.createECDH('prime256v1');
  if (!efemera) ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const segredo = ecdh.computeSecret(uaPub);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', segredo, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cifra = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const dados = Buffer.concat([cifra.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cifra.final(), cifra.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, dados]);
}

/** Envia um push. Devolve true se entregue ao serviço de push; apaga a inscrição se ela expirou (404/410). */
export async function enviaPush(sub, objeto) {
  if (!endpointValido(sub.endpoint)) { run('DELETE FROM push_subs WHERE id=?', sub.id); return false; }
  const corpo = criptografa(JSON.stringify(objeto), sub.p256dh, sub.auth);
  const aud = new URL(sub.endpoint).origin;
  const r = await fetch(sub.endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `vapid t=${jwtVapid(aud)}, k=${chavePublica()}`, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' },
    body: corpo,
  });
  if (r.status === 404 || r.status === 410) { run('DELETE FROM push_subs WHERE id=?', sub.id); return false; }
  if (!r.ok) throw new Error(`Serviço de push respondeu ${r.status}`);
  return true;
}
