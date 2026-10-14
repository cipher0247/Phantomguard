import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Db } from './db.js';

export const hashPassword = (pw: string) => {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(pw, salt, 64).toString('hex')}`;
};
export const verifyPassword = (pw: string, stored: string) => {
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex'), b = scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  return a.length === b.length && timingSafeEqual(a, b);
};
const DUMMY = hashPassword('dummy-password-for-timing');
export const verifyDummy = (pw: string) => verifyPassword(pw, DUMMY);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const COOKIE = 'pg_session';
const DAY = 86_400_000;

export function createSession(db: Db, userId: number, remember: boolean) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()); // purge expired sessions
  const token = randomBytes(32).toString('hex');
  const ttl = remember ? 30 * DAY : DAY;
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(sha(token), userId, Date.now() + ttl);
  return { token, ttl };
}
export const destroySession = (db: Db, token?: string) => token && db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(token));

export interface AuthedRequest extends Request { user?: { id: number; email: string; name: string } }

export const requireAuth = (db: Db) => (req: AuthedRequest, res: Response, next: NextFunction) => {
  const token = req.cookies?.[COOKIE];
  const row = token && db.prepare(
    'SELECT u.id,u.email,u.name,s.expires_at e FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').get(sha(token)) as any;
  if (!row || row.e < Date.now()) return void res.status(401).json({ error: 'unauthenticated', message: 'Please sign in.' });
  req.user = { id: row.id, email: row.email, name: row.name };
  next();
};

// shortcut: in-memory limiter resets on restart and is per-process, use a shared store if scaled out
export const rateLimit = (max: number, windowMs: number) => {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now(), k = req.ip ?? 'x';
    const recent = (hits.get(k) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) return void res.status(429).json({ error: 'rate_limited', message: 'Too many attempts. Try again shortly.' });
    hits.set(k, [...recent, now]);
    next();
  };
};
