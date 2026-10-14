import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { z } from 'zod';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from './db.js';
import { COOKIE, createSession, verifyDummy, destroySession, rateLimit, requireAuth, verifyPassword, type AuthedRequest } from './auth.js';
import { availability, ModelBadResponse, ModelTimeout, ModelUnavailable, runModel, type Kind } from './models.js';
import { askAdvisor } from './advisor.js';

const LIMITS = {
  text: 20_000,
  audio: { bytes: 20 * 1024 * 1024, exts: ['wav', 'mp3', 'm4a', 'ogg', 'flac'], maxSeconds: 300 },
  video: { bytes: 100 * 1024 * 1024, exts: ['mp4', 'mov', 'webm'] },
};
export const RISK = { high: 0.7, warn: 0.4 };
const riskBand = (s: number) => (s >= RISK.high ? 'high' : s >= RISK.warn ? 'warning' : 'low');

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  wav: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE',
  mp3: (b) => b.toString('ascii', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  ogg: (b) => b.toString('ascii', 0, 4) === 'OggS',
  flac: (b) => b.toString('ascii', 0, 4) === 'fLaC',
  m4a: (b) => b.toString('ascii', 4, 8) === 'ftyp',
  mp4: (b) => b.toString('ascii', 4, 8) === 'ftyp',
  mov: (b) => ['ftyp', 'moov', 'mdat', 'wide', 'free'].includes(b.toString('ascii', 4, 8)),
  webm: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
};
const wavSeconds = (b: Buffer) => {
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF') return null;
  const rate = b.readUInt32LE(28);
  return rate ? (b.length - 44) / rate : null;
};

export function createApp(db: Db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use((_, res, next) => { res.set({
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; media-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    if (_.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
    next();
  });
  // CSRF defence in depth (cookie is also SameSite=Lax): reject cross-origin state-changing requests.
  app.use('/api', (req, res, next) => {
    const o = req.get('origin');
    if (req.method !== 'GET' && o && new URL(o).host !== req.get('host') && !(process.env.PG_ALLOWED_ORIGINS ?? '').split(',').includes(o))
      return void res.status(403).json({ error: 'forbidden_origin', message: 'Cross-origin request blocked.' });
    next();
  });
  const auth = requireAuth(db);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.post('/api/auth/login', rateLimit(10, 60_000), (req, res) => {
    const p = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200), remember: z.boolean().optional() }).safeParse(req.body);
    if (!p.success) return void res.status(400).json({ error: 'invalid_input', message: 'Enter a valid email and password.' });
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(p.data.email.toLowerCase()) as any;
    // Same message for unknown user and bad password to avoid account enumeration.
    if (!u) verifyDummy(p.data.password); // equalise timing so unknown emails are not distinguishable
    if (!u || !verifyPassword(p.data.password, u.pw_hash))
      return void res.status(401).json({ error: 'bad_credentials', message: 'Incorrect email or password.' });
    const { token, ttl } = createSession(db, u.id, !!p.data.remember);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: ttl, path: '/' });
    res.json({ user: { email: u.email, name: u.name } });
  });
  app.post('/api/auth/logout', (req, res) => { destroySession(db, req.cookies?.[COOKIE]); res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }); });
  app.get('/api/auth/me', auth, (req: AuthedRequest, res) => res.json({ user: req.user }));

  app.get('/api/status', auth, (_req, res) => res.json({ models: availability(), limits: LIMITS }));

  const save = (userId: number, kind: Kind, r: { score: number; label: string; model: string; version: string; details?: unknown }, meta: object) => {
    const created = new Date().toISOString();
    const info = db.prepare('INSERT INTO scans (user_id,kind,label,score,model,model_version,details,input_meta,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(userId, kind, r.label, r.score, r.model, r.version, JSON.stringify(r.details ?? {}), JSON.stringify(meta), created);
    return { id: Number(info.lastInsertRowid), kind, ...r, risk: riskBand(r.score), createdAt: created };
  };
  const fail = (res: express.Response, e: unknown) => {
    if (e instanceof ModelTimeout) return void res.status(504).json({ error: 'model_timeout', message: e.message });
    if (e instanceof ModelBadResponse) return void res.status(502).json({ error: 'model_bad_response', message: e.message });
    if (e instanceof ModelUnavailable) return void res.status(503).json({ error: 'model_unavailable', message: e.message });
    console.error(e);
    res.status(500).json({ error: 'scan_failed', message: 'The scan could not be completed.' });
  };
  const LIMITATION = 'Model score is a probability estimate, not proof. False positives and negatives occur.';

  app.post('/api/scan/text', auth, async (req: AuthedRequest, res) => {
    const p = z.object({ text: z.string().trim().min(1).max(LIMITS.text) }).safeParse(req.body);
    if (!p.success) return void res.status(400).json({ error: 'invalid_input', message: `Provide 1–${LIMITS.text} characters of text.` });
    try {
      const r = await runModel('text', { text: p.data.text });
      res.json({ ...save(req.user!.id, 'text', r, { chars: p.data.text.length }), limitation: LIMITATION });
    } catch (e) { fail(res, e); }
  });

  // Fixed dir, emptied at startup so files orphaned by a crash do not accumulate.
  const uploadDir = join(tmpdir(), 'phantomguard-uploads');
  rmSync(uploadDir, { recursive: true, force: true }); mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
  const uploader = (bytes: number) => multer({ dest: uploadDir, limits: { fileSize: bytes, files: 1, fields: 0 } });
  const fileScan = (kind: 'audio' | 'video') => async (req: AuthedRequest, res: express.Response) => {
    const f = req.file;
    try {
      if (!f) return void res.status(400).json({ error: 'invalid_input', message: 'Attach a file.' });
      const lim = LIMITS[kind], ext = f.originalname.split('.').pop()?.toLowerCase() ?? '';
      if (!lim.exts.includes(ext)) return void res.status(415).json({ error: 'unsupported_type', message: `Supported types: ${lim.exts.join(', ')}.` });
      if (f.size > lim.bytes) return void res.status(413).json({ error: 'too_large', message: `Max size is ${lim.bytes / 1048576} MB.` });
      const buf = readFileSync(f.path);
      if (!MAGIC[ext]?.(buf)) return void res.status(415).json({ error: 'unsupported_type', message: 'File contents do not match its extension.' });
      if (kind === 'audio' && ext === 'wav') {
        const s = wavSeconds(buf);
        // shortcut: only WAV duration is checked here; other formats are bounded by size and the model service
        if (s && s > LIMITS.audio.maxSeconds) return void res.status(413).json({ error: 'too_long', message: `Audio must be under ${LIMITS.audio.maxSeconds}s.` });
      }
      const r = await runModel(kind, { file: buf, filename: f.originalname.replace(/[^\w.-]/g, '_'), mime: f.mimetype });
      res.json({ ...save(req.user!.id, kind, r, { filename: f.originalname.slice(0, 120), bytes: f.size }), limitation: LIMITATION });
    } catch (e) { fail(res, e); }
    finally { if (f) rmSync(f.path, { force: true }); }
  };
  const uploadOne = (kind: 'audio' | 'video') => (req: express.Request, res: express.Response, next: express.NextFunction) =>
    uploader(LIMITS[kind].bytes).single('file')(req, res, (err) => err ? res.status(413).json({ error: 'too_large', message: 'File is too large or malformed.' }) : next());
  app.post('/api/scan/audio', auth, uploadOne('audio'), fileScan('audio'));
  app.post('/api/scan/video', auth, uploadOne('video'), fileScan('video'));

  const row = (r: any) => ({ id: r.id, kind: r.kind, label: r.label, score: r.score, risk: riskBand(r.score), model: r.model, version: r.model_version,
    details: JSON.parse(r.details), input: JSON.parse(r.input_meta), createdAt: r.created_at });
  app.get('/api/scans', auth, (req: AuthedRequest, res) => {
    const kind = z.enum(['text', 'audio', 'video']).optional().safeParse(req.query.kind);
    const limit = Math.min(Number(req.query.limit) || 50, 200), before = Number(req.query.before) || 1e15;
    const rows = db.prepare(`SELECT * FROM scans WHERE user_id=? AND id<? ${kind.data ? 'AND kind=?' : ''} ORDER BY id DESC LIMIT ?`)
      .all(...[req.user!.id, before, ...(kind.data ? [kind.data] : []), limit]) as any[];
    res.json({ scans: rows.map(row) });
  });
  app.get('/api/scans/:id/report', auth, (req: AuthedRequest, res) => {
    const r = db.prepare('SELECT * FROM scans WHERE id=? AND user_id=?').get(Number(req.params.id), req.user!.id);
    if (!r) return void res.status(404).json({ error: 'not_found', message: 'Scan not found.' });
    res.set('Content-Disposition', `attachment; filename="phantomguard-scan-${Number(req.params.id)}.json"`)
      .json({ ...row(r), limitation: LIMITATION, generatedAt: new Date().toISOString() });
  });
  app.get('/api/summary', auth, (req: AuthedRequest, res) => {
    const u = req.user!.id;
    const t = db.prepare('SELECT COUNT(*) total, COALESCE(SUM(score>=?),0) high, MAX(created_at) last FROM scans WHERE user_id=?').get(RISK.high, u) as any;
    const d = db.prepare('SELECT COUNT(*) n, MAX(score) maxScore FROM scans WHERE user_id=? AND created_at>?').get(u, new Date(Date.now() - 86_400_000).toISOString()) as any;
    res.json({ totalScans: t.total, highRisk: t.high, lastScanAt: t.last, last24h: { scans: d.n, maxScore: d.maxScore } });
  });

  app.post('/api/advisor', auth, rateLimit(20, 60_000), async (req, res) => {
    const p = z.object({ messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) })).min(1).max(20) }).safeParse(req.body);
    if (!p.success || p.data.messages.at(-1)!.role !== 'user') return void res.status(400).json({ error: 'invalid_input', message: 'Send a message.' });
    const r = await askAdvisor(p.data.messages);
    res.status(r.status).json(r.body);
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found', message: 'Unknown endpoint.' }));
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.type === 'entity.parse.failed') return void res.status(400).json({ error: 'invalid_input', message: 'Malformed JSON.' });
    if (err?.type === 'entity.too.large') return void res.status(413).json({ error: 'too_large', message: 'Request body is too large.' });
    console.error(err?.message ?? 'unhandled error'); // message only: never log request bodies
    res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
  });
  return app;
}
