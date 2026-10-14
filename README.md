# PHANTOMGUARD

Vite + React + TypeScript frontend, Express + SQLite (`node:sqlite`) backend. Node 22.5+ required.

## Run

```bash
npm install
cp .env.example .env            # optional: add keys / model URLs
PG_NEW_PASSWORD='choose-a-password' npm run create-user -- you@example.com "Your Name"
npm run dev                     # web http://localhost:5173, API :8787
```

Production: `npm run build && NODE_ENV=production npm start` (serves `dist/` and the API on :8787; set up HTTPS in front).
Tests: `npm test`. Type-check + build: `npm run build`.

## What is real vs. awaiting configuration

| Feature | State |
|---|---|
| Intro video, sign-in/out, sessions, history, reports, dashboard aggregates | Working, backed by SQLite |
| Text / audio / video analysis | **No trained models are in this repo.** Each endpoint calls an inference service you run (`PG_TEXT_MODEL_URL`, `PG_AUDIO_MODEL_URL`, `PG_VIDEO_MODEL_URL`). Unset → HTTP 503 `model_unavailable`; nothing is faked. |
| AI advisor | Needs `ANTHROPIC_API_KEY`; replies are labelled AI-generated. |

### Model service contract
`text`: `POST` JSON `{text}`. `audio`/`video`: `POST` multipart field `file`.
Response: `{ "score": 0..1, "label": "string", "model": "name", "details": {optional flat object} }`.
Score is the model's probability that the input is malicious/synthetic. Risk bands: ≥0.4 warning, ≥0.7 high, ≥0.9 critical.
Video frame extraction, audio decoding and duration enforcement belong in your model service (only WAV duration and file size/type are checked here).

## Privacy
Uploads go to a temp dir and are deleted after each request. History stores score/label/model and metadata only (file name+size, or text length+SHA-256); never message text.
