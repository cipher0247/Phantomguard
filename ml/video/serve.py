"""Video manipulation-detection service implementing the PHANTOMGUARD model contract.

  POST /predict  multipart field "file" (mp4/mov/webm)
      -> {"score": 0..1, "label": "manipulated|not flagged", "model", "version", "details": {...}}
  GET  /health

Pipeline: ffprobe -> up to N evenly spaced frames (ffmpeg, bounded) -> frame-level image classifier -> clip score = mean of frame scores.
The model, revision, threshold and measured performance come from ml/video/config.json (written by ml/video/build_config.py after evaluation).
Run: ml\\.venv\\Scripts\\python.exe ml\\video\\serve.py [--port 9300]   (127.0.0.1 only). Temporary files are deleted after every request.
"""
import argparse, json, os, sys, tempfile, threading
from pathlib import Path

import numpy as np, torch
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse
from transformers import AutoImageProcessor, AutoModelForImageClassification

sys.path.insert(0, str(Path(__file__).parent))
from common import MediaError, extract_frames, probe_video  # noqa: E402

CFG_PATH = Path(__file__).parent / "config.json"
MAX_UPLOAD = 100 * 1024 * 1024
MAX_SECONDS = int(os.environ.get("PG_VIDEO_MAX_SECONDS", "120"))
N_FRAMES = int(os.environ.get("PG_VIDEO_FRAMES", "12"))

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
STATE: dict = {}
_lock = threading.Semaphore(1)


def load():
    cfg = json.loads(CFG_PATH.read_text())
    proc = AutoImageProcessor.from_pretrained(cfg["backbone"]["id"], revision=cfg["backbone"]["revision"])
    model = AutoModelForImageClassification.from_pretrained(cfg["backbone"]["id"], revision=cfg["backbone"]["revision"]).eval()
    torch.set_num_threads(os.cpu_count() or 4)
    STATE.update(cfg=cfg, proc=proc, model=model)


def frame_scores(frames) -> np.ndarray:
    m, proc, cfg = STATE["model"], STATE["proc"], STATE["cfg"]
    with torch.inference_mode():
        logits = m(**proc(images=frames, return_tensors="pt")).logits
    p = torch.sigmoid(logits[:, 0]) if cfg["output"] == "sigmoid" else torch.softmax(logits, -1)[:, cfg["fake_index"]]
    return p.numpy()


def label_for_score(score: float, threshold: float, labels: dict) -> str:
    return labels["positive" if score >= threshold else "negative"]


def predict_file(path: str) -> dict:
    cfg = STATE["cfg"]
    info = probe_video(path)
    if info["duration"] > MAX_SECONDS:
        raise MediaError(f"The video is too long ({info['duration']:.0f}s). The limit is {MAX_SECONDS}s.", status=413)
    frames = extract_frames(path, info["duration"], N_FRAMES)
    s = frame_scores(frames)
    score = round(float(s.mean()), 6); thr = cfg["threshold"]
    return {
        "score": score,
        "label": label_for_score(score, thr, cfg["labels"]),
        "model": cfg["model"], "version": cfg["version"],
        "details": {
            "threshold": thr, "duration_s": round(info["duration"], 1), "frames_analysed": len(frames), "frames_flagged": int((s >= thr).sum()),
            "max_frame_score": round(float(s.max()), 4),
            "frame_scores": json.dumps([round(float(v), 4) for v in s], separators=(",", ":")),
            "aggregation": "mean of frame scores", "resolution": f"{info['width']}x{info['height']}",
            "model_sha256": cfg["model_sha256"][:12],
            "score_contract": "Uncalibrated sigmoid-head output on a 0-1 scale; not a calibrated probability. The configured threshold determines the label.",
            "limitations": cfg["limitations"], "experimental": True,
        },
    }


@app.get("/health")
def health():
    cfg = STATE["cfg"]
    return {"ok": True, "model": cfg["model"], "version": cfg["version"]}


@app.post("/predict")
def predict(file: UploadFile = File(...)):
    tmp = None
    try:
        fd, tmp = tempfile.mkstemp(prefix="pg-video-"); size = 0
        with os.fdopen(fd, "wb") as out:
            while chunk := file.file.read(1 << 20):
                size += len(chunk)
                if size > MAX_UPLOAD: return JSONResponse({"error": "too_large", "message": "File is too large."}, status_code=413)
                out.write(chunk)
        if size == 0: return JSONResponse({"error": "empty", "message": "The file is empty."}, status_code=422)
        with _lock:
            return predict_file(tmp)
    except MediaError as e:
        return JSONResponse({"error": "unprocessable", "message": str(e)}, status_code=e.status)
    except Exception:
        return JSONResponse({"error": "internal_error"}, status_code=500)
    finally:
        if tmp and os.path.exists(tmp): os.remove(tmp)


if __name__ == "__main__":
    import uvicorn
    ap = argparse.ArgumentParser(); ap.add_argument("--port", type=int, default=9300); args = ap.parse_args()
    load()
    print(f"{STATE['cfg']['model']} v{STATE['cfg']['version']} on http://127.0.0.1:{args.port}/predict", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
