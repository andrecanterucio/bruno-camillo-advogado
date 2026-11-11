import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');

const clean = (a) => a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? +v : v));
export const all = (s, ...p) => db.prepare(s).all(...clean(p));
export const get = (s, ...p) => db.prepare(s).get(...clean(p));
export const run = (s, ...p) => {
  const r = db.prepare(s).run(...clean(p));
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
};
export const now = () => new Date().toISOString();
export const tx = (fn) => {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
};

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK(role IN ('admin','funcionario','cliente')),
  senha_hash TEXT NOT NULL, ativo INTEGER NOT NULL DEFAULT 1,
  cliente_id INTEGER REFERENCES clientes(id), aceite_em TEXT, criado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expira_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clientes(
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, telefone TEXT, email TEXT,
  origem TEXT, status TEXT NOT NULL DEFAULT 'lead' CHECK(status IN ('lead','ativo','inativo')),
  notas TEXT, criado_por INTEGER, criado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fases(
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL UNIQUE, ordem INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS casos(
  id INTEGER PRIMARY KEY, titulo TEXT NOT NULL, cliente_id INTEGER REFERENCES clientes(id),
  numero_cnj TEXT, area TEXT, fase_id INTEGER NOT NULL REFERENCES fases(id),
  segredo INTEGER NOT NULL DEFAULT 0, etiquetas TEXT, notas TEXT,
  responsavel_id INTEGER REFERENCES users(id), ordem INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS andamentos(
  id INTEGER PRIMARY KEY, caso_id INTEGER NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
  data TEXT NOT NULL, origem TEXT NOT NULL DEFAULT 'manual', ref TEXT UNIQUE,
  texto_original TEXT NOT NULL, texto_simples TEXT,
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK(status IN ('rascunho','aprovado')),
  visivel_cliente INTEGER NOT NULL DEFAULT 0, ia INTEGER NOT NULL DEFAULT 0,
  criado_por INTEGER, aprovado_por INTEGER, criado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documentos(
  id INTEGER PRIMARY KEY, caso_id INTEGER NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
  nome TEXT NOT NULL, arquivo TEXT NOT NULL, mime TEXT, tamanho INTEGER,
  visivel_cliente INTEGER NOT NULL DEFAULT 0, enviado_por INTEGER, criado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS prazos(
  id INTEGER PRIMARY KEY, caso_id INTEGER NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL, data TEXT NOT NULL, concluido INTEGER NOT NULL DEFAULT 0, criado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS publicacoes(
  id INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE, numero_processo TEXT, tribunal TEXT,
  orgao TEXT, tipo TEXT, classe TEXT, data_disp TEXT, texto TEXT, link TEXT,
  caso_id INTEGER REFERENCES casos(id) ON DELETE SET NULL, lida INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS addon_interesse(
  id INTEGER PRIMARY KEY, addon TEXT NOT NULL, user_id INTEGER NOT NULL, criado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ia_uso(
  id INTEGER PRIMARY KEY, caso_id INTEGER, modelo TEXT, tokens_in INTEGER, tokens_out INTEGER, criado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auditoria(
  id INTEGER PRIMARY KEY, user_id INTEGER, acao TEXT NOT NULL, alvo TEXT, criado_em TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_and_caso ON andamentos(caso_id, data);
CREATE INDEX IF NOT EXISTS ix_pub_proc ON publicacoes(numero_processo);
`);

// --- migrações leves (idempotentes) ---
const colunas = (t) => all(`PRAGMA table_info(${t})`).map((c) => c.name);
const addCol = (t, c, def) => { if (!colunas(t).includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };
addCol('casos', 'ia_habilitada', 'INTEGER NOT NULL DEFAULT 0');
addCol('casos', 'papel_cliente', 'TEXT');
addCol('users', 'must_change', 'INTEGER NOT NULL DEFAULT 0');
db.exec(`
CREATE TABLE IF NOT EXISTS contratos_aceite(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, nome TEXT NOT NULL, documento TEXT NOT NULL, oab TEXT NOT NULL,
  versao TEXT NOT NULL, hash TEXT NOT NULL, ip TEXT, user_agent TEXT, ciencias TEXT NOT NULL, criado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ia_termo_aceite(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, nome TEXT NOT NULL, versao TEXT NOT NULL, hash TEXT NOT NULL,
  ip TEXT, user_agent TEXT, ciencias TEXT NOT NULL, criado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ia_opcao_recusa(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, nome TEXT NOT NULL, versao TEXT NOT NULL, ip TEXT, user_agent TEXT, criado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ia_caso_consentimento(
  id INTEGER PRIMARY KEY, caso_id INTEGER NOT NULL REFERENCES casos(id) ON DELETE CASCADE, user_id INTEGER NOT NULL,
  consentimento_em TEXT NOT NULL, versao TEXT NOT NULL, hash TEXT NOT NULL, ip TEXT, ciencias TEXT NOT NULL,
  criado_em TEXT NOT NULL, revogado_em TEXT, revogado_por INTEGER);
`);

addCol('contratos_aceite', 'ficha', 'TEXT');

export const FASES_PADRAO = ['Novo / Em análise', 'Aguardando documentos', 'Em andamento', 'Aguardando decisão', 'Recurso', 'Encerrado'];
if (!get('SELECT 1 x FROM fases LIMIT 1')) {
  FASES_PADRAO.forEach((n, i) => run('INSERT INTO fases(nome, ordem) VALUES(?,?)', n, i));
}

export function audit(userId, acao, alvo = null) {
  run('INSERT INTO auditoria(user_id, acao, alvo, criado_em) VALUES(?,?,?,?)', userId, acao, alvo, now());
}
