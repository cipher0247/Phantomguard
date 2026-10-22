"""Zero-shot evaluation of a pretrained audio deepfake classifier on an external dataset.

Dataset: garystafford/deepfake-audio-detection (CC-BY-4.0): 933 real (YouTube speech, 14 videos) + 933 fake (6 TTS platforms), 2.5-13 s FLAC.
The model card does not specify its training data, so dataset overlap cannot be ruled out.
Usage: ml\\.venv\\Scripts\\python.exe ml\\audio\\eval_pretrained.py [--model ID] [--limit N]
Writes ml/audio/artifacts/zero_shot_<model>.json and a per-clip score cache (git-ignored).
"""
import argparse, io, json, re, sys, time
from collections import defaultdict
from pathlib import Path

import numpy as np, pyarrow.parquet as pq, soundfile as sf
from huggingface_hub import snapshot_download
from sklearn.metrics import accuracy_score, roc_auc_score, confusion_matrix

sys.path.insert(0, str(Path(__file__).parent))
from audio_common import SR, load_model, p_fake, to_16k_mono  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--model", default="MelodyMachine/Deepfake-audio-detection-V2")
ap.add_argument("--limit", type=int, default=0, help="evaluate only N clips (stratified), for a quick check")
args = ap.parse_args()

OUT = Path(__file__).parent / "artifacts"; OUT.mkdir(exist_ok=True)
tag = args.model.replace("/", "__")
cache = OUT / f"scores_{tag}.json"

ds_dir = Path(snapshot_download("garystafford/deepfake-audio-detection", repo_type="dataset", allow_patterns=["data/*.parquet", "README.md"]))
rows = []
for f in sorted((ds_dir / "data").glob("*.parquet")):
    t = pq.read_table(f).to_pylist()
    for r in t:
        rows.append(dict(path=r["audio"]["path"], bytes=r["audio"]["bytes"], label=int(r["label"])))  # dataset: 0=real 1=fake
print("clips:", len(rows), "fake:", sum(r["label"] for r in rows))

def group_of(r):  # platform for fakes (filename prefix), source video id for reals
    name = Path(r["path"]).name
    return ("fake:" + name.split("_")[0]) if r["label"] else ("real:" + (re.split(r"_part|_c_|_p2_", name)[0]))
for r in rows: r["group"] = group_of(r)

if args.limit:
    rng = np.random.default_rng(0); idx = rng.permutation(len(rows))[:args.limit]; rows = [rows[i] for i in idx]

fe, model = load_model(args.model)
id2label = {int(k): v.lower() for k, v in model.config.id2label.items()}
fake_idx = [k for k, v in id2label.items() if "fake" in v or "spoof" in v][0]
print("model labels:", id2label, "-> fake index", fake_idx)

scores = json.loads(cache.read_text()) if cache.exists() and not args.limit else {}
t0 = time.time()
for i, r in enumerate(rows):
    if r["path"] in scores: continue
    x, sr = sf.read(io.BytesIO(r["bytes"]), dtype="float32", always_2d=False)
    x = to_16k_mono(x, sr)  # the dataset card says 16 kHz mono, but some clips are 44.1 kHz
    scores[r["path"]] = float(p_fake(fe, model, [x], fake_idx)[0])
    if i % 100 == 0:
        print(f"  {i}/{len(rows)} {time.time()-t0:.0f}s", flush=True)
        if not args.limit: cache.write_text(json.dumps(scores))
if not args.limit: cache.write_text(json.dumps(scores))

y = np.array([r["label"] for r in rows]); p = np.array([scores[r["path"]] for r in rows])
pred = (p >= 0.5).astype(int)
tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
per = defaultdict(list)
for r, pp in zip(rows, p): per[r["group"]].append((r["label"], pp))
by_group = {g: dict(n=len(v), fake_prob_mean=float(np.mean([s for _, s in v])), flagged_fraction=float(np.mean([s >= .5 for _, s in v]))) for g, v in sorted(per.items())}
res = dict(model=args.model, dataset="garystafford/deepfake-audio-detection (CC-BY-4.0)", n=len(rows), threshold=0.5,
           accuracy=accuracy_score(y, pred), roc_auc=roc_auc_score(y, p), tn=int(tn), fp=int(fp), fn=int(fn), tp=int(tp),
           real_specificity=tn / max(tn + fp, 1), fake_recall=tp / max(tp + fn, 1), by_group=by_group, partial=bool(args.limit))
(OUT / f"zero_shot_{tag}{'_quick' if args.limit else ''}.json").write_text(json.dumps(res, indent=2))
print(json.dumps({k: (round(v, 4) if isinstance(v, float) else v) for k, v in res.items() if k != "by_group"}))
for g, v in by_group.items(): print(" ", g, v["n"], "mean P(fake)=%.3f flagged=%.2f" % (v["fake_prob_mean"], v["flagged_fraction"]))
