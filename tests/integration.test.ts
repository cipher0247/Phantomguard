// @vitest-environment node
// Real HTTP round-trips against an explicitly labelled MOCK model service (tests/fixtures/mock-text-model.ts).
// These verify the adapter/contract handling; the mock's output is NOT a genuine prediction.
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { openDb } from '../server/db';
import { hashPassword } from '../server/auth';
import { createApp } from '../server/app';
import { MOCK_MODEL, startMockTextModel } from './fixtures/mock-text-model';

const db = openDb(':memory:');
const other = db.prepare('INSERT INTO users (email,name,pw_hash,created_at) VALUES (?,?,?,?)');
other.run('a@b.co', 'A', hashPassword('correct-horse-1'), 'now');
other.run('c@d.co', 'C', hashPassword('correct-horse-2'), 'now');
const app = createApp(db);
const a = request.agent(app), c = request.agent(app);
let mock: Server | undefined;

beforeAll(async () => {
  await a.post('/api/auth/login').send({ email: 'a@b.co', password: 'correct-horse-1' });
  await c.post('/api/auth/login').send({ email: 'c@d.co', password: 'correct-horse-2' });
});
afterEach(() => { mock?.close(); mock = undefined; delete process.env.PG_TEXT_MODEL_URL; delete process.env.PG_MODEL_TIMEOUT_MS; });
const withMock = async (b: Parameters<typeof startMockTextModel>[0]) => { const m = await startMockTextModel(b); mock = m.server; process.env.PG_TEXT_MODEL_URL = m.url; };

describe('text model integration (mock service)', () => {
  it('returns a structured result with version metadata and stores no message content', async () => {
    await withMock({});
    const secret = 'my bank PIN is 4921, please verify';
    const r = await a.post('/api/scan/text').send({ text: secret });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: 'text', model: MOCK_MODEL, version: 'mock-0', score: secret.length / 100 });
    expect(r.body.limitation).toMatch(/not proof/i);
    const raw = JSON.stringify(db.prepare('SELECT * FROM scans').all());
    expect(raw).not.toContain('4921'); expect(raw).not.toContain('bank');
    expect(JSON.parse((db.prepare('SELECT input_meta m FROM scans').get() as any).m)).toEqual({ chars: secret.length });
  });
  it('rejects invalid input before calling the model', async () => {
    await withMock({});
    expect((await a.post('/api/scan/text').send({ text: 'x'.repeat(20001) })).status).toBe(400);
    expect((await a.post('/api/scan/text').send({ text: 5 })).status).toBe(400);
    expect((await a.post('/api/scan/text').set('content-type', 'application/json').send('{bad')).status).toBe(400);
  });
  it('503 when unconfigured or unreachable', async () => {
    expect((await a.post('/api/scan/text').send({ text: 'hi' })).status).toBe(503);
    process.env.PG_TEXT_MODEL_URL = 'http://127.0.0.1:1/predict';
    expect((await a.post('/api/scan/text').send({ text: 'hi' })).body.error).toBe('model_unavailable');
  });
  it('503 when the service errors', async () => {
    await withMock({ behaviour: 'error' });
    expect((await a.post('/api/scan/text').send({ text: 'hi' })).status).toBe(503);
  });
  it('504 on timeout', async () => {
    await withMock({ behaviour: 'slow' }); process.env.PG_MODEL_TIMEOUT_MS = '200';
    const r = await a.post('/api/scan/text').send({ text: 'hi' });
    expect(r.status).toBe(504); expect(r.body.error).toBe('model_timeout');
  });
  it('502 on malformed or non-JSON model responses, and nothing is stored', async () => {
    const before = (db.prepare('SELECT COUNT(*) n FROM scans').get() as any).n;
    for (const behaviour of ['malformed', 'notjson'] as const) {
      await withMock({ behaviour });
      expect((await a.post('/api/scan/text').send({ text: 'hi' })).body.error).toBe('model_bad_response');
      mock!.close();
    }
    expect((db.prepare('SELECT COUNT(*) n FROM scans').get() as any).n).toBe(before);
  });
});

describe('authorization and hardening', () => {
  it("users cannot read each other's scans or reports", async () => {
    await withMock({});
    const mine = (await a.post('/api/scan/text').send({ text: 'hello there' })).body.id;
    expect((await c.get(`/api/scans/${mine}/report`)).status).toBe(404);
    expect((await c.get('/api/scans')).body.scans.find((s: any) => s.id === mine)).toBeUndefined();
    expect((await a.get(`/api/scans/${mine}/report`)).status).toBe(200);
  });
  it('blocks cross-origin state-changing requests', async () => {
    const r = await a.post('/api/scan/text').set('Origin', 'https://evil.example').send({ text: 'hi' });
    expect(r.status).toBe(403);
  });
  it('rate-limits login attempts', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'bad' })).status);
    expect(codes).toContain(429);
  });
  it('rejects files whose content does not match the extension, and cleans up temp files', async () => {
    const r = await a.post('/api/scan/audio').attach('file', Buffer.from('MZ not audio at all, padded padded'), 'x.wav');
    expect(r.status).toBe(415);
    const { readdirSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
    expect(readdirSync(join(tmpdir(), 'phantomguard-uploads'))).toHaveLength(0);
  });
  it('sets security headers and no-store on the API', async () => {
    const r = await a.get('/api/summary');
    expect(r.headers['cache-control']).toBe('no-store'); expect(r.headers['content-security-policy']).toMatch(/default-src 'self'/);
  });
  it('serves a model-unavailable audio error only after valid file content', async () => {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(40)]);
    expect((await a.post('/api/scan/audio').attach('file', wav, 'ok.wav')).status).toBe(503);
  });
});
