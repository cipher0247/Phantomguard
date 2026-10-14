// @vitest-environment node
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../server/db';
import { hashPassword } from '../server/auth';
import { createApp } from '../server/app';
import { startMockTextModel } from './fixtures/mock-text-model';

const db = openDb(':memory:');
db.prepare('INSERT INTO users (email,name,pw_hash,created_at) VALUES (?,?,?,?)').run('n@b.co', 'N', hashPassword('native-pass-1234'), 'now');
const app = createApp(db);
const ORIGIN = 'https://localhost'; // Capacitor WebView origin
afterEach(() => { delete process.env.PG_DEMO_MODE; delete process.env.PG_TEXT_MODEL_URL; });

const login = () => request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'n@b.co', password: 'native-pass-1234', client: 'native' });

describe('native client (Bearer token, cross-origin)', () => {
  it('answers CORS preflight for the app origin only', async () => {
    const ok = await request(app).options('/api/auth/login').set('Origin', ORIGIN).set('Access-Control-Request-Method', 'POST');
    expect(ok.status).toBe(204); expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(ok.headers['access-control-allow-credentials']).toBeUndefined();
    expect((await request(app).options('/api/auth/login').set('Origin', 'https://evil.example')).status).toBe(403);
  });
  it('returns a token (and no cookie) for native logins, then authenticates with it', async () => {
    const r = await login();
    expect(r.status).toBe(200); expect(r.body.token).toMatch(/^[a-f0-9]{64}$/); expect(r.headers['set-cookie']).toBeUndefined();
    const me = await request(app).get('/api/auth/me').set('Origin', ORIGIN).set('Authorization', `Bearer ${r.body.token}`);
    expect(me.body.user.email).toBe('n@b.co');
  });
  it('web logins never receive a token in the body', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'n@b.co', password: 'native-pass-1234' });
    expect(r.body.token).toBeUndefined(); expect(String(r.headers['set-cookie'])).toMatch(/HttpOnly/);
  });
  it('rejects bad, malformed and revoked tokens', async () => {
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer nope')).status).toBe(401);
    const { token } = (await login()).body;
    await request(app).post('/api/auth/logout').set('Origin', ORIGIN).set('Authorization', `Bearer ${token}`);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });
  it('rejects expired sessions', async () => {
    const { token } = (await login()).body;
    db.prepare('UPDATE sessions SET expires_at = 1').run();
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });
});

describe('demo mode and mock labelling', () => {
  it('reports demo mode in status only when enabled', async () => {
    const { token } = (await login()).body, auth = { Authorization: `Bearer ${token}` };
    expect((await request(app).get('/api/status').set(auth)).body.demo).toBe(false);
    process.env.PG_DEMO_MODE = '1';
    expect((await request(app).get('/api/status').set(auth)).body.demo).toBe(true);
  });
  it('flags MOCK results, and keeps them out of risk figures', async () => {
    const { token } = (await login()).body, auth = { Authorization: `Bearer ${token}` };
    const m = await startMockTextModel(); process.env.PG_TEXT_MODEL_URL = m.url;
    const r = await request(app).post('/api/scan/text').set(auth).send({ text: 'x'.repeat(95) });
    m.server.close();
    expect(r.body.mock).toBe(true); expect(r.body.risk).toBe('high');
    const s = (await request(app).get('/api/summary').set(auth)).body;
    expect(s).toMatchObject({ mockScans: 1, highRisk: 0, last24h: { scans: 0, maxScore: null } });
    expect((await request(app).get('/api/scans').set(auth)).body.scans[0].mock).toBe(true);
  });
});
