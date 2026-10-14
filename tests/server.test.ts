// @vitest-environment node
import request from 'supertest';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../server/db';
import { hashPassword } from '../server/auth';
import { createApp } from '../server/app';

const db = openDb(':memory:');
db.prepare('INSERT INTO users (email,name,pw_hash,created_at) VALUES (?,?,?,?)').run('a@b.co', 'Alex', hashPassword('correct-horse-1'), 'now');
const agent = request.agent(createApp(db));

afterEach(() => { vi.unstubAllGlobals(); delete process.env.PG_TEXT_MODEL_URL; delete process.env.PG_AUDIO_MODEL_URL; delete process.env.ANTHROPIC_API_KEY; });

describe('auth', () => {
  it('rejects unauthenticated access', async () => { expect((await request(createApp(db)).get('/api/summary')).status).toBe(401); });
  it('rejects bad credentials with a generic message', async () => {
    const r = await agent.post('/api/auth/login').send({ email: 'a@b.co', password: 'nope' });
    expect(r.status).toBe(401); expect(r.body.error).toBe('bad_credentials');
  });
  it('rejects invalid input', async () => { expect((await agent.post('/api/auth/login').send({ email: 'x' })).status).toBe(400); });
  it('signs in with httpOnly cookie, then out', async () => {
    const r = await agent.post('/api/auth/login').send({ email: 'a@b.co', password: 'correct-horse-1' });
    expect(r.status).toBe(200);
    expect(String(r.headers['set-cookie'])).toMatch(/HttpOnly/);
    expect((await agent.get('/api/auth/me')).body.user.email).toBe('a@b.co');
    await agent.post('/api/auth/logout');
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
});

describe('scans', () => {
  beforeAll(async () => { await agent.post('/api/auth/login').send({ email: 'a@b.co', password: 'correct-horse-1' }); });

  it('reports 503 model_unavailable when no model is configured (no fabricated result)', async () => {
    const r = await agent.post('/api/scan/text').send({ text: 'hello' });
    expect(r.status).toBe(503); expect(r.body.error).toBe('model_unavailable');
    expect((await agent.get('/api/scans')).body.scans).toHaveLength(0);
  });
  it('validates text input', async () => { expect((await agent.post('/api/scan/text').send({ text: '  ' })).status).toBe(400); });
  it('persists a result from a configured model service and exposes report/summary', async () => {
    process.env.PG_TEXT_MODEL_URL = 'http://model.local/predict';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ score: 0.91, label: 'phishing', model: 'test-model' }))));
    const r = await agent.post('/api/scan/text').send({ text: 'URGENT click here' });
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ risk: 'high', score: 0.91 }); expect(r.body.limitation).toBeTruthy();
    const list = (await agent.get('/api/scans')).body.scans;
    expect(list).toHaveLength(1); expect(JSON.stringify(list)).not.toContain('URGENT');
    expect((await agent.get(`/api/scans/${r.body.id}/report`)).status).toBe(200);
    expect((await agent.get('/api/summary')).body).toMatchObject({ totalScans: 1, highRisk: 1 });
  });
  it('rejects malformed model responses', async () => {
    process.env.PG_TEXT_MODEL_URL = 'http://model.local/predict';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ score: 7 }))));
    expect((await agent.post('/api/scan/text').send({ text: 'x' })).status).toBe(500);
  });
  it('rejects unsupported audio types and missing files', async () => {
    expect((await agent.post('/api/scan/audio').attach('file', Buffer.from('x'), 'a.exe')).status).toBe(415);
    expect((await agent.post('/api/scan/audio')).status).toBe(400);
  });
  it('returns 503 for audio when unconfigured', async () => {
    expect((await agent.post('/api/scan/audio').attach('file', Buffer.from('x'), 'a.wav')).status).toBe(503);
  });
});

describe('advisor', () => {
  it('reports unconfigured without a key', async () => {
    const r = await agent.post('/api/advisor').send({ messages: [{ role: 'user', content: 'hi' }] });
    expect(r.status).toBe(503); expect(r.body.error).toBe('advisor_unconfigured');
  });
  it('labels replies as ai-generated and maps 429', async () => {
    process.env.ANTHROPIC_API_KEY = 'test';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'Be careful.' }] }))));
    expect((await agent.post('/api/advisor').send({ messages: [{ role: 'user', content: 'hi' }] })).body).toEqual({ reply: 'Be careful.', source: 'ai-generated' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })));
    expect((await agent.post('/api/advisor').send({ messages: [{ role: 'user', content: 'hi' }] })).status).toBe(429);
  });
});
