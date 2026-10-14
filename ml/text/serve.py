"""Text-model inference service implementing the PHANTOMGUARD model contract.

  POST /predict  {"text": "..."}  ->  {"score": 0..1, "label": "safe|suspicious", "model": str, "version": str, "details": {...}}
  GET  /health   ->  model metadata

Binds to 127.0.0.1 only (the Express backend is the sole client). Run: ml\\.venv\\Scripts\\python.exe ml\\text\\serve.py [--port 9100]
"""
import argparse, json, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import joblib

sys.path.insert(0, str(Path(__file__).parent))
from features import MAX_CHARS, normalize  # noqa: E402

ART = Path(__file__).parent / "artifacts"
LIMITATIONS = ("Trained on a public email/SMS corpus whose suspicious class is mostly spam-style messages and whose safe class is largely "
               "corporate and academic email. It can miss modern scams and wrongly flag legitimate messages (for example verification codes). "
               "Treat it as a hint, not proof.")
MAX_BODY = 200_000   # bytes
MAX_TEXT = 20_000    # characters accepted (matches the backend limit); only the first MAX_CHARS are analysed


def load():
    cfg = json.loads((ART / "config.json").read_text())
    bundle = joblib.load(ART / "model.joblib")
    return cfg, bundle


def predict(cfg, bundle, text: str) -> dict:
    n = normalize(text)
    placeholders = {"urltoken", "emailtoken", "numtoken"}
    if not any(w not in placeholders and any("a" <= ch <= "z" for ch in w) for w in n.split()):
        raise ValueError("Text has no analysable words (only links, numbers or symbols).")
    score = float(bundle["model"].predict_proba(bundle["vectorizer"].transform([n]))[0, 1])
    thr = bundle["threshold"]
    return {
        "score": round(score, 6),
        "label": bundle["labels"][1 if score >= thr else 0],
        "model": cfg["model"],
        "version": cfg["version"],
        "details": {
            "threshold": thr,
            "scope": "English email/SMS text; spam and phishing-like wording",
            "truncated": len(text) > MAX_CHARS,
            "model_sha256": cfg["model_sha256"][:12],
            "limitations": LIMITATIONS,
        },
    }


def make_handler(cfg, bundle):
    lock = threading.Lock()  # sklearn predict is thread-safe, but keep requests simple and bounded

    class H(BaseHTTPRequestHandler):
        def _send(self, code, obj):
            body = json.dumps(obj).encode()
            self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/health": return self._send(200, {"ok": True, "model": cfg["model"], "version": cfg["version"], "model_sha256": cfg["model_sha256"]})
            self._send(404, {"error": "not_found"})

        def do_POST(self):
            if self.path != "/predict": return self._send(404, {"error": "not_found"})
            try:
                n = int(self.headers.get("Content-Length", "0"))
                if n <= 0 or n > MAX_BODY: return self._send(413 if n > MAX_BODY else 400, {"error": "bad_length"})
                payload = json.loads(self.rfile.read(n))
                text = payload.get("text") if isinstance(payload, dict) else None
                if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
                    return self._send(400, {"error": "invalid_text"})
                with lock:
                    out = predict(cfg, bundle, text)
                self._send(200, out)
            except (ValueError, json.JSONDecodeError) as e:
                self._send(400, {"error": "invalid_input", "message": str(e)})
            except Exception:  # never leak internals
                self._send(500, {"error": "internal_error"})

        def log_message(self, fmt, *a):  # no request bodies, no message text in logs
            sys.stderr.write("%s %s\n" % (self.command, self.path))

    return H


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--port", type=int, default=9100); args = ap.parse_args()
    cfg, bundle = load()
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(cfg, bundle))
    print(f"{cfg['model']} v{cfg['version']} listening on http://127.0.0.1:{args.port}/predict", flush=True)
    srv.serve_forever()
