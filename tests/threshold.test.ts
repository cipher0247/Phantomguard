// @vitest-environment node
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../server/db';
import { hashPassword } from '../server/auth';
import { createApp } from '../server/app';

const db = openDb(':memory:');
const ins = db.prepare('INSERT INTO users (email,name,pw_hash,created_at) VALUES (?,?,?,?)');
ins.run('a@t.co', 'A', hashPassword('threshold-pass-1'), 'now'); ins.run('b@t.co', 'B', hashPassword('threshold-pass-2'), 'now');
const app = createApp(db);
const a = request.agent(app), b = request.agent(app);
const respond = (score: number, details: object = { threshold: 0.52 }) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ score, label: score >= 0.52 ? 'suspicious' : 'safe', model: 'real-model', version: '1.0.0', details }))));
afterEach(() => { vi.unstubAllGlobals(); delete process.env.PG_TEXT_MODEL_URL; });

describe('risk bands follow the model decision threshold', () => {
  it('below threshold is low, at/above is warning, >=0.85 is high', async () => {
    process.env.PG_TEXT_MODEL_URL = 'http://m.local/p';
    await a.post('/api/auth/login').send({ email: 'a@t.co', password: 'threshold-pass-1' });
    const risks: string[] = [];
    for (const s of [0.45, 0.6, 0.9]) { respond(s); risks.push((await a.post('/api/scan/text').send({ text: 'hello world' })).body.risk); }
    expect(risks).toEqual(['low', 'warning', 'high']);
  });
  it('falls back to fixed bands when the model reports no threshold', async () => {
    process.env.PG_TEXT_MODEL_URL = 'http://m.local/p';
    respond(0.45, {});
    expect((await a.post('/api/scan/text').send({ text: 'hello world' })).body.risk).toBe('warning');
  });
  it('summary: flagged excludes low and MOCK scans; highRisk only counts high', async () => {
    const s = (await a.get('/api/summary')).body;
    expect(s).toMatchObject({ totalScans: 4, flagged: 3, highRisk: 1, mockScans: 0 });
    expect(s.last24h).toMatchObject({ scans: 4, flagged: 3 });
  });
  it('GET /api/scans/:id returns one scan with its version, and only to its owner', async () => {
    const id = (await a.get('/api/scans')).body.scans[0].id;
    const mine = await a.get(`/api/scans/${id}`);
    expect(mine.status).toBe(200); expect(mine.body).toMatchObject({ id, version: '1.0.0', model: 'real-model' });
    await b.post('/api/auth/login').send({ email: 'b@t.co', password: 'threshold-pass-2' });
    expect((await b.get(`/api/scans/${id}`)).status).toBe(404);
    expect((await a.get('/api/scans/99999')).status).toBe(404);
  });
  it('keeps a long limitations note but drops oversized or nested detail values', async () => {
    process.env.PG_TEXT_MODEL_URL = 'http://m.local/p';
    respond(0.7, { threshold: 0.5, limitations: 'x'.repeat(400), junk: 'y'.repeat(300), nested: { a: 1 } });
    const d = (await a.post('/api/scan/text').send({ text: 'hello world' })).body.details;
    expect(d.limitations).toHaveLength(400); expect(d.junk).toBeUndefined(); expect(d.nested).toBeUndefined();
  });
});
