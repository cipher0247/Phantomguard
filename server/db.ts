import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';

export function openDb(path = process.env.PG_DB ?? 'data/phantomguard.db') {
  if (path !== ':memory:') mkdirSync('data', { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      pw_hash TEXT NOT NULL, prefs TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS scans (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL,
      label TEXT NOT NULL, score REAL NOT NULL, model TEXT NOT NULL, details TEXT NOT NULL,
      input_meta TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS scans_user ON scans(user_id, id DESC);
  `);
  return db;
}
export type Db = ReturnType<typeof openDb>;
