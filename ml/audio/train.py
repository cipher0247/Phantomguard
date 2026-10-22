"""Audio spoof baseline: frozen wav2vec2-base embeddings (mean+std per layer) + logistic regression.

Why this and not the pretrained deepfake checkpoint: eval_pretrained.py showed MelodyMachine/Deepfake-audio-detection-V2 is near chance
(ROC-AUC ~0.5) on this dataset's modern TTS.

Evaluation is GROUPED: each fold holds out one whole TTS platform (unseen generator) plus whole real YouTube videos (unseen speakers/channels),
so scores measure generalisation to new generators and speakers, not memorisation. A telephony-style degradation test checks robustness.

Run: ml\\.venv\\Scripts\\python.exe ml\\audio\\train.py
Outputs in ml/audio/artifacts: config.json, metrics.json, model.joblib (git-ignored)
"""
import hashlib, io, json, re, subprocess, sys, tempfile, time
from collections import defaultdict
from pathlib import Path

import joblib, numpy as np, pyarrow.parquet as pq, scipy, sklearn, soundfile as sf, torch, transformers
from huggingface_hub import HfApi, snapshot_download
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, balanced_accuracy_score, confusion_matrix, roc_auc_score
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).parent))
from audio_common import SR, decode_audio, find_tool, to_16k_mono  # noqa: E402

HERE = Path(__file__).parent
OUT = HERE / "artifacts"; OUT.mkdir(exist_ok=True)
BACKBONE = "facebook/wav2vec2-base"
LAYERS = [4, 6, 8, 10, 12]
MAX_SECONDS = 12
NAME, VERSION = "pg-audio-w2v2base-logreg", "0.1.0-experimental"

# ---------------- data ----------------
ds_dir = Path(snapshot_download("garystafford/deepfake-audio-detection", repo_type="dataset", allow_patterns=["data/*.parquet", "README.md"]))
rows = []
for f in sorted((ds_dir / "data").glob("*.parquet")):
    for r in pq.read_table(f).to_pylist(): rows.append(dict(path=r["audio"]["path"], bytes=r["audio"]["bytes"], y=int(r["label"])))
def group(r):
    n = Path(r["path"]).name
    return ("fake:" + n.split("_")[0]) if r["y"] else ("real:" + re.split(r"_part|_c_|_p2_", n)[0])
for r in rows: r["g"] = group(r)
y = np.array([r["y"] for r in rows]); groups = np.array([r["g"] for r in rows])
print("clips", len(rows), "groups", len(set(groups)))

# ---------------- embeddings ----------------
rev = HfApi().model_info(BACKBONE).sha
fe = transformers.AutoFeatureExtractor.from_pretrained(BACKBONE, revision=rev)
bb = transformers.AutoModel.from_pretrained(BACKBONE, revision=rev).eval()
import os; torch.set_num_threads(os.cpu_count() or 4)

def embed(x: np.ndarray) -> np.ndarray:
    """-> [len(LAYERS), 1536]: per-layer mean and std over time of the hidden states."""
    with torch.inference_mode():
        hs = bb(**fe(x[: MAX_SECONDS * SR], sampling_rate=SR, return_tensors="pt"), output_hidden_states=True).hidden_states
    return np.stack([torch.cat([hs[l][0].mean(0), hs[l][0].std(0)]).numpy() for l in LAYERS]).astype(np.float32)

cache = OUT / "emb_clean.npy"
if cache.exists():
    E = np.load(cache)
else:
    E, t0 = np.zeros((len(rows), len(LAYERS), 1536), np.float32), time.time()
    for i, r in enumerate(rows):
        x, sr = sf.read(io.BytesIO(r["bytes"]), dtype="float32")
        E[i] = embed(to_16k_mono(x, sr))
        if i % 25 == 0: print(f"  embed {i}/{len(rows)} {time.time()-t0:.0f}s", flush=True)
    np.save(cache, E)

# ---------------- grouped folds: one TTS platform + a share of real videos held out per fold ----------------
platforms = sorted({g for g in groups if g.startswith("fake:")})
videos = sorted({g for g in groups if g.startswith("real:")})
fold_of = {p: i for i, p in enumerate(platforms)} | {v: i % len(platforms) for i, v in enumerate(videos)}
fold = np.array([fold_of[g] for g in groups])
K = len(platforms)
print("folds:", {i: [g for g in fold_of if fold_of[g] == i] for i in range(K)})

def fit(X, yy, C):
    sc = StandardScaler().fit(X)
    return sc, LogisticRegression(C=C, max_iter=3000, class_weight="balanced").fit(sc.transform(X), yy)

def oof(layer_idx, C):
    p = np.zeros(len(rows))
    for k in range(K):
        tr, te = fold != k, fold == k
        sc, lr = fit(E[tr, layer_idx], y[tr], C)
        p[te] = lr.predict_proba(sc.transform(E[te, layer_idx]))[:, 1]
    return p

best = None
for li, layer in enumerate(LAYERS):
    for C in (0.001, 0.01, 0.1):
        p = oof(li, C); auc = roc_auc_score(y, p)
        print(f"  layer {layer:2d} C={C}: grouped-CV ROC-AUC={auc:.4f}", flush=True)
        if best is None or auc > best[0]: best = (auc, li, C, p)
auc, LI, C, P = best
ths = np.linspace(0.05, 0.95, 91)
THRESH = float(ths[int(np.argmax([balanced_accuracy_score(y, P >= t) for t in ths]))])
print(f"selected layer {LAYERS[LI]} C={C} threshold={THRESH:.2f} grouped-CV AUC={auc:.4f}")

pred = (P >= THRESH).astype(int)
tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
per_group = {g: dict(n=int((groups == g).sum()), flagged_fraction=float(pred[groups == g].mean()), mean_score=float(P[groups == g].mean())) for g in sorted(set(groups))}
per_fold = [dict(held_out=[g for g in fold_of if fold_of[g] == k],
                 auc=float(roc_auc_score(y[fold == k], P[fold == k])), accuracy=float(accuracy_score(y[fold == k], pred[fold == k]))) for k in range(K)]

# ---------------- robustness: telephony-style degradation of held-out clips ----------------
def degrade(raw: bytes) -> np.ndarray:
    with tempfile.TemporaryDirectory() as d:
        src, dst = Path(d, "a.flac"), Path(d, "b.mp3"); src.write_bytes(raw)
        subprocess.run([find_tool("ffmpeg"), "-nostdin", "-v", "error", "-i", str(src), "-ar", "8000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "24k", str(dst)], check=True, timeout=60)
        return decode_audio(str(dst), max_seconds=MAX_SECONDS)

rng = np.random.default_rng(7)
sub = np.concatenate([rng.choice(np.where(y == c)[0], 120, replace=False) for c in (0, 1)])
fold_models = {k: fit(E[fold != k, LI], y[fold != k], C) for k in range(K)}
pd_ = []
for i in sub:
    sc, lr = fold_models[int(fold[i])]  # model that never saw this clip's platform / video
    pd_.append(lr.predict_proba(sc.transform(embed(degrade(rows[i]["bytes"]))[LI][None]))[0, 1])
pd_ = np.array(pd_); ys = y[sub]
robust = dict(n=int(len(sub)), degradation="downsample to 8 kHz + MP3 24 kbps", threshold=THRESH,
              clean=dict(auc=float(roc_auc_score(ys, P[sub])), fake_recall=float((P[sub][ys == 1] >= THRESH).mean()), real_specificity=float((P[sub][ys == 0] < THRESH).mean())),
              degraded=dict(auc=float(roc_auc_score(ys, pd_)), fake_recall=float((pd_[ys == 1] >= THRESH).mean()), real_specificity=float((pd_[ys == 0] < THRESH).mean())))

metrics = dict(model=NAME, version=VERSION, protocol="grouped CV: each fold holds out one TTS platform and whole real videos; layer/C/threshold chosen on the pooled out-of-fold scores (no nested CV, so slightly optimistic)",
               backbone=BACKBONE, backbone_revision=rev, layer=LAYERS[LI], C=C, threshold=THRESH, n=len(rows),
               overall=dict(accuracy=float(accuracy_score(y, pred)), balanced_accuracy=float(balanced_accuracy_score(y, pred)), roc_auc=float(auc),
                            tn=int(tn), fp=int(fp), fn=int(fn), tp=int(tp), real_specificity=float(tn / (tn + fp)), fake_recall=float(tp / (tp + fn))),
               per_group=per_group, per_fold=per_fold, robustness=robust)
(OUT / "metrics.json").write_text(json.dumps(metrics, indent=2))
print(json.dumps(metrics["overall"])); print("robustness:", json.dumps(robust))
for g, v in per_group.items(): print(" ", g, v)

# ---------------- final model on all data ----------------
sc, lr = fit(E[:, LI], y, C)
joblib.dump(dict(scaler=sc, model=lr, layer_index=LI, layer=LAYERS[LI], threshold=THRESH), OUT / "model.joblib", compress=3)
sha = hashlib.sha256((OUT / "model.joblib").read_bytes()).hexdigest()
(OUT / "config.json").write_text(json.dumps(dict(
    model=NAME, version=VERSION, trained_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), threshold=THRESH, model_sha256=sha,
    label_mapping={"0": "genuine", "1": "synthetic"}, layers=LAYERS, selected_layer=LAYERS[LI], max_seconds=MAX_SECONDS, sample_rate=SR,
    score_meaning="uncalibrated classifier score (0-1) that the speech is synthetic; NOT a calibrated probability",
    backbone=dict(id=BACKBONE, revision=rev, license="apache-2.0"),
    dataset=dict(name="garystafford/deepfake-audio-detection", license="cc-by-4.0", clips=len(rows)),
    dependencies=dict(python=sys.version.split()[0], torch=torch.__version__, transformers=transformers.__version__, scikit_learn=sklearn.__version__, numpy=np.__version__, scipy=scipy.__version__)), indent=2))
print("saved", NAME, VERSION, sha[:12])
