// MOCK text-model service for integration tests and local wiring checks ONLY.
// It is NOT a phishing detector: the score is derived from the text length so tests are deterministic.
// Every response is labelled MOCK so it can never be mistaken for a real prediction.
import { createServer, type Server } from 'node:http';

export const MOCK_MODEL = 'MOCK-text-model-not-a-detector';

export function startMockTextModel(opts: { port?: number; behaviour?: 'ok' | 'slow' | 'malformed' | 'notjson' | 'error' } = {}): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b = opts.behaviour ?? 'ok';
      if (b === 'error') { res.writeHead(500).end(); return; }
      if (b === 'notjson') { res.writeHead(200).end('<html>nope</html>'); return; }
      if (b === 'malformed') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ score: 7, label: 'x' })); return; }
      const reply = () => {
        const text: string = JSON.parse(body).text ?? '';
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
          score: Math.min(text.length / 100, 1), label: 'MOCK result (not a real prediction)', model: MOCK_MODEL, version: 'mock-0', details: { mock: true } }));
      };
      b === 'slow' ? setTimeout(reply, 3000) : reply();
    });
  });
  return new Promise((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', () => {
    const port = (server.address() as { port: number }).port;
    resolve({ url: `http://127.0.0.1:${port}/predict`, server });
  }));
}

if (process.argv[1]?.endsWith('mock-text-model.ts')) {
  startMockTextModel({ port: 9001 }).then(({ url }) => console.log(`MOCK text model (not a detector) at ${url}`));
}
