# PHANTOMGUARD

Vite + React + TypeScript frontend, Express + SQLite (`node:sqlite`) backend. Node 22.5+ required.

## Run

```bash
npm install
cp .env.example .env            # optional: add keys / model URLs
PG_NEW_PASSWORD='choose-a-long-password' npm run create-user -- <your-email> "Your Name"
npm run dev                     # web http://localhost:5173, API :8787
```

Production: `npm run build && NODE_ENV=production npm start` (serves `dist/` and the API on :8787; put HTTPS in front).
Tests: `npm test`. Type-check + build: `npm run build`.

**Android demo:** see [docs/ANDROID_DEMO.md](docs/ANDROID_DEMO.md) (APK build, phone-to-PC connection, demo script).

## What is real vs. awaiting configuration

| Feature | State |
|---|---|
| Intro video, sign-in/out, sessions, history, reports, dashboard aggregates | Working, backed by SQLite |
| Text / audio / video analysis | Each endpoint calls an inference service (`PG_TEXT_MODEL_URL`, `PG_AUDIO_MODEL_URL`, `PG_VIDEO_MODEL_URL`). `scripts/start-all.ps1` starts the configured local services. The audio and video options use experimental detectors with weak evaluation results and prominent in-app warnings; do not rely on them for safety decisions. |
| AI advisor | Set `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`; Gemini is used when both are set. Replies are labelled AI-generated. |

For a local Gemini setup, create a `.env` file in the repository root and add your key there (never commit it or paste it into chat). The default model is `gemini-2.5-flash`; override it with `GEMINI_ADVISOR_MODEL` if needed. For Anthropic, set `ANTHROPIC_API_KEY` and optionally `ADVISOR_MODEL`.

Start the backend and configured local model services with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-all.ps1
```

This binds the backend to `0.0.0.0:8787` for the phone and keeps model services on loopback. Audio/video processing requires FFmpeg and a Python environment at `ml\.venv`; the experimental model weights are downloaded from their pinned Hugging Face revisions when first loaded. Startup waits for each configured model service to pass its health check.

### Model service contract

`text`: `POST` JSON `{"text": "..."}` (max 20,000 chars). `audio` / `video`: `POST` multipart field `file`.

Response. Every field except `details` is required; otherwise the scan fails with 502 and nothing is stored:

```json
{ "score": 0.0, "label": "string (<=80)", "model": "name (<=80)", "version": "string (<=40)", "details": { "optional": "flat primitives, <=10 keys" } }
```

**Score semantics:** the text model emits a calibrated probability for its training-data label. Experimental audio/video services emit uncalibrated model scores (0–1), not probabilities; their configured thresholds map scores to labels. Experimental audio/video scans are explicitly warned about and excluded from security figures.

**Errors:** unconfigured / unreachable / non-2xx → 503; timeout (`PG_MODEL_TIMEOUT_MS`, default 15 s text) → 504; contract violation → 502. Redirects are refused.

Video frame extraction, audio decoding and duration enforcement belong in your model service (only WAV duration, size and file signature are checked here).

**Mock service:** `npm run mock:text` starts a deterministic MOCK on :9001 (score = text length / 100, labelled "MOCK", **not a detector**) for wiring checks only. Never use it in production.

## Secure configuration & cleanup checklist

- [ ] `.env` exists only on the server and is never committed (git-ignored, along with `data/`, `*.db`, uploads, models, datasets, keys).
- [ ] `NODE_ENV=production`, served over HTTPS (the session cookie is `Secure` in production); `PG_TRUST_PROXY` set if behind a proxy.
- [ ] Create real accounts with a long password via `PG_NEW_PASSWORD` (never argv). The server **refuses to start in production** while any `@phantomguard.local` account exists.
- [ ] Remove dev/test accounts: `npm run delete-user -- <email>` (also deletes their sessions and scans). To wipe local data entirely, stop the server and delete `data/`.
- [ ] Rotate any API key that was ever pasted into a terminal, chat or screenshot.
- [ ] Model weights, datasets and predictions live outside the repo (or in git-ignored paths) and are served by a separate inference service.
- [ ] `npm audit`: Tailwind was upgraded to v4, which removed the vulnerable braces/chokidar chain. Remaining advisories (uuid/xcode) are in the Capacitor CLI build tool only, not in the server or app.
- [ ] Native clients authenticate with a Bearer token kept in the app's local storage; for stronger protection store it in Android Keystore-backed storage (plugin) before real-world use.

## Privacy

Uploads go to a temp dir and are deleted after each request (the dir is emptied at startup). History stores score, label, model name/version and metadata only (file name + size, or text length); never message text, not even a hash.
