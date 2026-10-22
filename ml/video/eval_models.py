"""Evaluate candidate image deepfake classifiers on REAL VIDEO frames before deciding whether any of them may back the video feature.

For each video: 12 evenly spaced frames -> per-frame P(fake) -> clip score (mean). Reports ROC-AUC / accuracy at 0.5 and best-threshold accuracy.
Frames are scored whole (no face detection). This is a sample of 100 videos of unknown provenance, so the results are indicative, not definitive.
Usage: ml\\.venv\\Scripts\\python.exe ml\\video\\eval_models.py [--models id1,id2]
Output: ml/video/artifacts/eval_<model>.json
"""
import argparse, json, sys, time
from pathlib import Path

import numpy as np, torch
from sklearn.metrics import accuracy_score, roc_auc_score
from transformers import AutoImageProcessor, AutoModelForImageClassification

sys.path.insert(0, str(Path(__file__).parent))
from common import extract_frames, probe_video  # noqa: E402

HERE = Path(__file__).parent
DATA = HERE / "data"; OUT = HERE / "artifacts"; OUT.mkdir(exist_ok=True)
ap = argparse.ArgumentParser()
ap.add_argument("--models", default="buildborderless/CommunityForensics-DeepfakeDet-ViT,prithivMLmods/Deep-Fake-Detector-v2-Model,dima806/deepfake_vs_real_image_detection")
ap.add_argument("--frames", type=int, default=12)
args = ap.parse_args()

man = json.loads((DATA / "manifest.json").read_text())["items"]
labels = np.array([m["label"] for m in man])
print("videos:", len(man), "fake:", int(labels.sum()))

# frames are extracted once and reused across models
frames_cache = HERE / "artifacts" / "frames_cache.pt"
frames_by_video = {}
t0 = time.time()
for i, m in enumerate(man):
    p = str(DATA / m["file"])
    info = probe_video(p)
    frames_by_video[m["file"]] = extract_frames(p, info["duration"], args.frames)
    if i % 10 == 0: print(f"  frames {i}/{len(man)} {time.time()-t0:.0f}s", flush=True)

torch.set_num_threads(8)
for mid in args.models.split(","):
    print("==", mid, flush=True)
    proc = AutoImageProcessor.from_pretrained(mid); model = AutoModelForImageClassification.from_pretrained(mid).eval()
    id2 = {int(k): v.lower() for k, v in (model.config.id2label or {}).items()}
    single = model.config.num_labels == 1
    fake_idx = None if single else [k for k, v in id2.items() if any(w in v for w in ("fake", "deepfake", "ai", "synthetic"))][0]
    print("   labels:", id2 or "single sigmoid", "fake index:", fake_idx)
    per_video, t1 = [], time.time()
    for m in man:
        ims = frames_by_video[m["file"]]
        with torch.inference_mode():
            logits = model(**proc(images=ims, return_tensors="pt")).logits
        p = torch.sigmoid(logits[:, 0]) if single else torch.softmax(logits, -1)[:, fake_idx]
        per_video.append(p.numpy())
    P_mean = np.array([v.mean() for v in per_video]); P_med = np.array([np.median(v) for v in per_video]); P_top = np.array([np.sort(v)[-3:].mean() for v in per_video])
    ths = np.linspace(0.02, 0.98, 97)
    def summary(P):
        best = max(ths, key=lambda t: accuracy_score(labels, P >= t))
        return dict(roc_auc=float(roc_auc_score(labels, P)), acc_at_0_5=float(accuracy_score(labels, P >= .5)), best_threshold=float(best), acc_at_best=float(accuracy_score(labels, P >= best)),
                    fake_recall_at_0_5=float((P[labels == 1] >= .5).mean()), real_specificity_at_0_5=float((P[labels == 0] < .5).mean()))
    res = dict(model=mid, n_videos=len(man), frames_per_video=args.frames, seconds=round(time.time() - t1), aggregation={"mean": summary(P_mean), "median": summary(P_med), "top3_mean": summary(P_top)},
               note="threshold-at-best is optimistic (tuned on this same sample). Indicative only.")
    (OUT / f"eval_{mid.replace('/', '__')}.json").write_text(json.dumps(res, indent=2))
    print(json.dumps(res["aggregation"]["mean"]), flush=True)
