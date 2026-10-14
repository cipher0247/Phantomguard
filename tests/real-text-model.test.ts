// @vitest-environment node
// End-to-end through the REAL trained text model: Express backend -> PG_TEXT_MODEL_URL -> Python service -> sklearn model.
// Skipped automatically when the trained artifacts or the Python venv are not present (they are git-ignored; see ml/README.md).
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDb } from '../server/db';
import { hashPassword } from '../server/auth';
import { createApp } from '../server/app';

const PY = 'ml/.venv/Scripts/python.exe';
const available = existsSync(PY) && existsSync('ml/text/artifacts/model.joblib') && existsSync('ml/text/artifacts/config.json');
const PORT = 9137;
let proc: ChildProcess | undefined;

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('text model service did not start');
}

describe.skipIf(!available)('real trained text model (end to end)', () => {
  const db = openDb(':memory:');
  db.prepare('INSERT INTO users (email,name,pw_hash,created_at) VALUES (?,?,?,?)').run('r@b.co', 'R', hashPassword('real-model-pass-1'), 'now');
  const agent = request.agent(createApp(db));

  beforeAll(async () => {
    proc = spawn(PY, ['ml/text/serve.py', '--port', String(PORT)], { stdio: 'ignore' });
    await waitHealthy();
    process.env.PG_TEXT_MODEL_URL = `http://127.0.0.1:${PORT}/predict`;
    await agent.post('/api/auth/login').send({ email: 'r@b.co', password: 'real-model-pass-1' });
  }, 60_000);
  afterAll(() => { proc?.kill(); delete process.env.PG_TEXT_MODEL_URL; });

  it('flags spam-like text as suspicious with model metadata, and is not labelled MOCK', async () => {
    const r = await agent.post('/api/scan/text').send({ text: 'Cheap meds online, no prescription needed! Buy now and save 80% on all orders!!!' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ label: 'suspicious', mock: false, model: 'pg-text-tfidf-logreg' });
    expect(r.body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(r.body.risk).not.toBe('low');
    expect(r.body.details.threshold).toBeGreaterThan(0);
    expect(r.body.details.limitations).toMatch(/hint, not proof/);
  });

  it('treats ordinary conversation as safe (low risk)', async () => {
    const r = await agent.post('/api/scan/text').send({ text: 'Hi! Are we still meeting for lunch tomorrow at 1pm? Let me know if you need to move it.' });
    expect(r.body).toMatchObject({ label: 'safe', risk: 'low', mock: false });
  });

  it('rejects text with no words as invalid rather than guessing', async () => {
    const r = await agent.post('/api/scan/text').send({ text: '12345 67890 !!!' });
    expect(r.status).toBe(422); expect(r.body.error).toBe('input_rejected'); expect(r.body.message).toMatch(/no analysable words/);
    const n = (db.prepare('SELECT COUNT(*) n FROM scans').get() as { n: number }).n;
    expect(n).toBe(2);
  });

  it('stores only metadata: no message text', async () => {
    const raw = JSON.stringify(db.prepare('SELECT * FROM scans').all());
    expect(raw).not.toMatch(/meds|lunch/i);
    expect(raw).toContain('pg-text-tfidf-logreg');
  });

  it('counts flagged scans from the model threshold in the summary', async () => {
    const s = (await agent.get('/api/summary')).body;
    expect(s).toMatchObject({ totalScans: 2, mockScans: 0, flagged: 1 });
  });
});
