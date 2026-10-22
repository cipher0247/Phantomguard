// @vitest-environment node
import request from 'supertest';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../server/db';
import { hashPassword } from '../server/auth';
import { createApp } from '../server/app';
import { availability } from '../server/models';

const db = openDb(':memory:');
db.prepare('INSERT INTO users (email,name,pw_hash,created_at) VALUES (?,?,?,?)').run('a@b.co', 'Alex', hashPassword('correct-horse-1'), 'now');
const agent = request.agent(createApp(db));

afterEach(() => { vi.unstubAllGlobals(); delete process.env.PG_TEXT_MODEL_URL; delete process.env.PG_AUDIO_MODEL_URL; delete process.env.PG_VIDEO_MODEL_URL; delete process.env.ANTHROPIC_API_KEY; delete process.env.GEMINI_API_KEY; });

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
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ score: 0.91, label: 'phishing', model: 'test-model', version: '1' }))));
    const r = await agent.post('/api/scan/text').send({ text: 'URGENT click here' });
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ risk: 'high', score: 0.91 }); expect(r.body.limitation).toBeTruthy();
    const list = (await agent.get('/api/scans')).body.scans;
    expect(list).toHaveLength(1); expect(JSON.stringify(list)).not.toContain('URGENT'); expect(JSON.stringify(list)).not.toMatch(/[a-f0-9]{64}/); expect(list[0].version).toBe('1');
    expect((await agent.get(`/api/scans/${r.body.id}/report`)).status).toBe(200);
    expect((await agent.get('/api/summary')).body).toMatchObject({ totalScans: 1, highRisk: 1 });
  });
  it('rejects malformed model responses', async () => {
    process.env.PG_TEXT_MODEL_URL = 'http://model.local/predict';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ score: 7 }))));
    expect((await agent.post('/api/scan/text').send({ text: 'x' })).status).toBe(502);
  });
  it('rejects unsupported audio types and missing files', async () => {
    expect((await agent.post('/api/scan/audio').attach('file', Buffer.from('x'), 'a.exe')).status).toBe(415);
    expect((await agent.post('/api/scan/audio')).status).toBe(400);
  });
  it('returns unavailable for valid video uploads when no video service is configured', async () => {
    const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.alloc(8)]);
    const r = await agent.post('/api/scan/video').attach('file', mp4, 'clip.mp4');
    expect(r.status).toBe(503); expect(r.body.error).toBe('model_unavailable');
  });
  it('preserves the experimental score contract, label, and threshold in scan and report responses', async () => {
    process.env.PG_AUDIO_MODEL_URL = 'http://model.local/predict';
    const details = {
      threshold: 0.5, experimental: true,
      window_scores: '[0.02]',
      score_contract: 'Uncalibrated model output on a 0-1 scale; not a calibrated probability. The configured threshold determines the label.',
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      score: 0.02, label: 'genuine', model: 'test-audio', version: 'test', details,
    }))));
    const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(20)]);
    const created = await agent.post('/api/scan/audio').attach('file', mp3, 'contract.mp3');
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ score: 0.02, label: 'genuine', details });
    expect(created.body.score < created.body.details.threshold).toBe(true);
    const scan = await agent.get(`/api/scans/${created.body.id}`);
    const report = await agent.get(`/api/scans/${created.body.id}/report`);
    for (const response of [scan, report]) {
      expect(response.body).toMatchObject({ score: created.body.score, label: created.body.label, details: created.body.details });
    }
  });
});

describe('advisor', () => {
  it('reports unconfigured without a key', async () => {
    const r = await agent.post('/api/advisor').send({ messages: [{ role: 'user', content: 'hi' }] });
    expect(r.status).toBe(503); expect(r.body.error).toBe('advisor_unconfigured');
  });
  it('reports configured when a Gemini key is set', () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    expect(availability().advisor).toBe(true);
  });
  it('labels replies as ai-generated and maps 429', async () => {
    process.env.ANTHROPIC_API_KEY = 'test';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'Be careful.' }] }))));
    expect((await agent.post('/api/advisor').send({ messages: [{ role: 'user', content: 'hi' }] })).body).toEqual({ reply: 'Be careful.', source: 'ai-generated' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })));
    expect((await agent.post('/api/advisor').send({ messages: [{ role: 'user', content: 'hi' }] })).status).toBe(429);
  });
  it('supports Gemini and maps assistant history to the Gemini request format', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Check with the sender.' }] } }] })));
    vi.stubGlobal('fetch', fetchMock);
    const r = await agent.post('/api/advisor').send({ messages: [
      { role: 'user', content: 'Is this message suspicious?' },
      { role: 'assistant', content: 'What does it ask you to do?' },
      { role: 'user', content: 'It asks for my password.' },
    ] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ reply: 'Check with the sender.', source: 'ai-generated' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      expect.objectContaining({
        headers: { 'x-goog-api-key': 'test-gemini-key', 'content-type': 'application/json' },
        body: expect.stringContaining('"role":"model"'),
      }),
    );
  });
  it('returns safe errors for Gemini provider failures, timeouts and invalid responses', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    expect((await agent.post('/api/advisor').send({ messages: [{ role: 'user', content: 'hi' }] })).body.error).toBe('advisor_failed');

    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError'); }));
    const timedOut = await agent.post('/api/advisor').send({ messages: [{ role: 'user', content: 'hi' }] });
    expect(timedOut.status).toBe(504);
    expect(timedOut.body.error).toBe('advisor_timeout');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json')));
    const malformed = await agent.post('/api/advisor').send({ messages: [{ role: 'user', content: 'hi' }] });
    expect(malformed.status).toBe(502);
    expect(malformed.body.error).toBe('advisor_failed');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ candidates: [] }))));
    const empty = await agent.post('/api/advisor').send({ messages: [{ role: 'user', content: 'hi' }] });
    expect(empty.status).toBe(502);
    expect(empty.body.error).toBe('advisor_failed');
  });
});
