import express from 'express';
import { existsSync } from 'node:fs';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { validateConfig } from './models.js';

try { process.loadEnvFile('.env'); } catch { /* no .env: fine */ }
validateConfig();
if (process.env.NODE_ENV === 'production' && process.env.PG_DEMO_MODE === '1') { console.error('Refusing to start: PG_DEMO_MODE must not be enabled in production.'); process.exit(1); }
const db = openDb();
// Development accounts (created with an @phantomguard.local address) must never reach production.
if (process.env.NODE_ENV === 'production') {
  const dev = db.prepare("SELECT COUNT(*) n FROM users WHERE email LIKE '%@phantomguard.local'").get() as { n: number };
  if (dev.n) { console.error('Refusing to start in production: development accounts exist. Run: npm run delete-user -- <email>'); process.exit(1); }
}
const app = createApp(db);
if (process.env.PG_TRUST_PROXY) app.set('trust proxy', Number(process.env.PG_TRUST_PROXY)); // set to the number of reverse proxies in front
if (existsSync('dist')) { // production: serve the built SPA
  app.use(express.static('dist'));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile('index.html', { root: 'dist' }));
}
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0'; // reachable from a phone on the same LAN; put HTTPS in front for anything beyond a demo
app.listen(port, host, () => console.log(`PHANTOMGUARD API on http://localhost:${port}`));
