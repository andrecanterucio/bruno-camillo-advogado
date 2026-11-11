import crypto from 'node:crypto';
import { get, run, now } from './db.mjs';
import { sha256, rid, parseCookies } from './util.mjs';

const SESSION_H = 12;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `s1$${salt.toString('base64')}$${h.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  const [v, s, h] = String(stored).split('$');
  if (v !== 's1' || !s || !h) return false;
  const want = Buffer.from(h, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(s, 'base64'), want.length);
  return crypto.timingSafeEqual(want, got);
}

export function createSession(userId) {
  const token = rid(32);
  const exp = new Date(Date.now() + SESSION_H * 3600e3).toISOString();
  run('INSERT INTO sessions(token_hash, user_id, expira_em) VALUES(?,?,?)', sha256(token), userId, exp);
  return { token, maxAge: SESSION_H * 3600 };
}
export function destroySession(req) {
  const t = parseCookies(req.headers.cookie).sid;
  if (t) run('DELETE FROM sessions WHERE token_hash=?', sha256(t));
}
export function userFromReq(req) {
  const t = parseCookies(req.headers.cookie).sid;
  if (!t) return null;
  const row = get(
    `SELECT u.id, u.nome, u.email, u.role, u.cliente_id, u.aceite_em, u.must_change, s.expira_em
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash=? AND u.ativo=1`, sha256(t));
  if (!row) return null;
  if (row.expira_em < now()) { run('DELETE FROM sessions WHERE token_hash=?', sha256(t)); return null; }
  return row;
}

// Limite de tentativas de login (memória do processo; suficiente para 1 instância).
const falhas = new Map();
export function loginBloqueado(key) {
  const f = falhas.get(key);
  return !!f && f.n >= 5 && Date.now() - f.t < 15 * 60e3;
}
export function loginFalhou(key) {
  const f = falhas.get(key);
  falhas.set(key, { n: (f && Date.now() - f.t < 15 * 60e3 ? f.n : 0) + 1, t: Date.now() });
}
export function loginOk(key) { falhas.delete(key); }

export const isStaff = (u) => u && (u.role === 'admin' || u.role === 'funcionario');
