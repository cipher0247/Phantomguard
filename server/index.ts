import express from 'express';
import { existsSync } from 'node:fs';
import { openDb } from './db.js';
import { createApp } from './app.js';

try { process.loadEnvFile('.env'); } catch { /* no .env: fine */ }
const app = createApp(openDb());
if (existsSync('dist')) { // production: serve the built SPA
  app.use(express.static('dist'));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile('index.html', { root: 'dist' }));
}
const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`PHANTOMGUARD API on http://localhost:${port}`));
