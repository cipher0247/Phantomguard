"""Audio spoof-detection service implementing the PHANTOMGUARD model contract.

  POST /predict  multipart field "file" (any audio/video container ffmpeg can read)
      -> {"score": 0..1, "label": "genuine|synthetic", "model", "version", "details": {...}}
  GET  /health

Run: ml\\.venv\\Scripts\\python.exe ml\\audio\\serve.py [--port 9200]   (binds 127.0.0.1; the Express backend is the only client)
Temporary files are deleted after every request; raw audio is never stored.
"""
import argparse, json, os, sys, tempfile, threading
from pathlib import Path

import joblib, numpy as np
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse

sys.path.insert(0, str(Path(__file__).parent))
from audio_common import MediaError, decode_audio, extract_embedding, load_backbone, load_model, p_fake, probe_duration, windows  # noqa: E402

ART = Path(__file__).parent / "artifacts"
PRETRAINED_CONFIG = Path(__file__).parent / "pretrained.json"
MAX_UPLOAD = 25 * 1024 * 1024
MAX_SECONDS = int(os.environ.get("PG_AUDIO_MAX_SECONDS", "300"))
WIN_S, MAX_WINDOWS = 10.0, 6
LIMITATIONS = os.environ.get("PG_AUDIO_LIMITATIONS") or (
    "Experimental baseline trained on one small public dataset (6 text-to-speech platforms vs. YouTube speech). "
    "Phone-quality or heavily compressed audio, other voice-cloning tools and background noise can defeat it. "
    "Treat the score as a hint, not proof.")

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
STATE: dict = {}
_lock = threading.Semaphore(1)  # one inference at a time: bounded memory/CPU


def load():
    if (ART / "model.joblib").exists() and (ART / "config.json").exists():
        cfg = json.loads((ART / "config.json").read_text())
        bundle = joblib.load(ART / "model.joblib")
        fe, bb = load_backbone(cfg["backbone"]["id"], cfg["backbone"]["revision"])
        STATE.update(mode="trained", cfg=cfg, bundle=bundle, fe=fe, bb=bb)
    else:
        cfg = json.loads(PRETRAINED_CONFIG.read_text())
        fe, model = load_model(cfg["backbone"]["id"], cfg["backbone"]["revision"])
        STATE.update(mode="pretrained", cfg=cfg, fe=fe, model=model)


def label_for_score(score: float, threshold: float, label_mapping: dict) -> str:
    return label_mapping["1" if score >= threshold else "0"]


def predict_file(path: str) -> dict:
    cfg = STATE["cfg"]
    dur = probe_duration(path)
    if dur > MAX_SECONDS: raise MediaError(f"The recording is too long ({dur:.0f}s). The limit is {MAX_SECONDS}s.", status=413)
    x = decode_audio(path, max_seconds=MAX_SECONDS)
    chunks = windows(x, WIN_S, WIN_S, MAX_WINDOWS)
    if STATE["mode"] == "pretrained":
        probs = p_fake(STATE["fe"], STATE["model"], chunks, cfg["fake_index"])
        threshold = cfg["threshold"]
    else:
        b = STATE["bundle"]
        li = b["layer_index"]
        probs = []
        for c in chunks:
            emb = extract_embedding(STATE["fe"], STATE["bb"], c, cfg["layers"], cfg["max_seconds"])[li]
            probs.append(float(b["model"].predict_proba(b["scaler"].transform(emb[None]))[0, 1]))
        threshold = b["threshold"]
    score = round(float(np.mean(probs)), 6)
    return {
        "score": score,
        "label": label_for_score(score, threshold, cfg["label_mapping"]),
        "model": cfg["model"], "version": cfg["version"],
        "details": {
            "threshold": threshold, "duration_s": round(dur, 1), "windows_analysed": len(chunks),
            "windows_flagged": int(sum(p >= threshold for p in probs)), "max_window_score": round(float(max(probs)), 4),
            "window_scores": json.dumps([round(float(p), 6) for p in probs], separators=(",", ":")),
            "aggregation": "mean of per-window scores", "model_sha256": cfg["model_sha256"][:12],
            "score_contract": "Uncalibrated model output on a 0-1 scale; not a calibrated probability. The configured threshold determines the label.",
            "limitations": cfg.get("limitations", LIMITATIONS), "experimental": True,
        },
    }


@app.get("/health")
def health():
    cfg = STATE["cfg"]
    return {"ok": True, "model": cfg["model"], "version": cfg["version"], "mode": STATE["mode"], "model_sha256": cfg["model_sha256"]}


@app.post("/predict")
def predict(file: UploadFile = File(...)):
    tmp = None
    try:
        fd, tmp = tempfile.mkstemp(prefix="pg-audio-"); size = 0
        with os.fdopen(fd, "wb") as out:  # stream to disk with a hard cap (do not trust Content-Length)
            while chunk := file.file.read(1 << 20):
                size += len(chunk)
                if size > MAX_UPLOAD: return JSONResponse({"error": "too_large", "message": "File is too large."}, status_code=413)
                out.write(chunk)
        if size == 0: return JSONResponse({"error": "empty", "message": "The file is empty."}, status_code=422)
        with _lock:
            return predict_file(tmp)
    except MediaError as e:
        return JSONResponse({"error": "unprocessable", "message": str(e)}, status_code=e.status)
    except Exception:  # never leak internals
        return JSONResponse({"error": "internal_error"}, status_code=500)
    finally:
        if tmp and os.path.exists(tmp): os.remove(tmp)


if __name__ == "__main__":
    import uvicorn
    ap = argparse.ArgumentParser(); ap.add_argument("--port", type=int, default=9200); args = ap.parse_args()
    load()
    print(f"{STATE['cfg']['model']} v{STATE['cfg']['version']} on http://127.0.0.1:{args.port}/predict", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
