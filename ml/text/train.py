"""Train and evaluate the text classifier. Reproducible: fixed seeds, group-aware split, test set touched once.

Run:  ml\\.venv\\Scripts\\python.exe ml\\text\\train.py
Outputs (ml/text/artifacts): model.joblib (git-ignored), config.json, metrics.json, confusion_matrix.csv, sanity_probe.json, top_features.json
"""
import csv, hashlib, json, re, sys, time
from collections import Counter
from pathlib import Path

import joblib, numpy as np, scipy, sklearn
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.frozen import FrozenEstimator
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (average_precision_score, brier_score_loss, confusion_matrix, f1_score, precision_score,
                             recall_score, roc_auc_score, accuracy_score)
from sklearn.model_selection import GroupShuffleSplit

sys.path.insert(0, str(Path(__file__).parent))
from features import NORMALIZER_VERSION, normalize  # noqa: E402

HERE = Path(__file__).parent
OUT = HERE / "artifacts"; OUT.mkdir(exist_ok=True)
SEED = 20260101
MODEL_NAME, MODEL_VERSION = "pg-text-tfidf-logreg", "1.0.0"

raw = json.loads((HERE / "data" / "texts.json").read_text(encoding="utf-8"))
print("raw records:", len(raw))

# ---- 1. Clean: normalise, drop empties, drop exact duplicates (normalised) -----------------------------------------
rows, seen = [], set()
dropped = Counter()
for r in raw:
    n = normalize(r["text"])
    if len(n) < 3: dropped["empty_after_normalisation"] += 1; continue
    h = hashlib.md5(n.encode()).hexdigest()
    if h in seen: dropped["exact_duplicate"] += 1; continue
    seen.add(h)
    cased_style = bool(re.search(r"[A-Z]", r["text"]))  # proxy for source family: raw Enron-style emails are all lower-case
    rows.append(dict(text=r["text"], norm=n, y=int(r["label"]), cased=cased_style, has_url=bool(re.search(r"(?i)https?://|www\.", r["text"])),
                     short=len(r["text"]) < 400, group=hashlib.md5(n[:200].encode()).hexdigest()))
print("after cleaning:", len(rows), dict(dropped))

# ---- 2. Group-aware split: records sharing the same first 200 normalised chars (templates/near-duplicates) stay together
y = np.array([r["y"] for r in rows]); groups = np.array([r["group"] for r in rows])
gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=SEED)
train_idx, hold_idx = next(gss.split(np.zeros(len(rows)), y, groups))
gss2 = GroupShuffleSplit(n_splits=1, test_size=0.5, random_state=SEED)
v_rel, t_rel = next(gss2.split(np.zeros(len(hold_idx)), y[hold_idx], groups[hold_idx]))
val_idx, test_idx = hold_idx[v_rel], hold_idx[t_rel]
assert not (set(groups[train_idx]) & set(groups[val_idx]) or set(groups[train_idx]) & set(groups[test_idx]) or set(groups[val_idx]) & set(groups[test_idx])), "group leakage"
sizes = {k: int(len(v)) for k, v in dict(train=train_idx, val=val_idx, test=test_idx).items()}
print("split sizes:", sizes, "| phishing rate train/val/test: %.3f %.3f %.3f" % tuple(y[i].mean() for i in (train_idx, val_idx, test_idx)))

X = [r["norm"] for r in rows]
vec = TfidfVectorizer(ngram_range=(1, 2), min_df=3, max_df=0.9, max_features=200_000, sublinear_tf=True, dtype=np.float32)
Xtr = vec.fit_transform([X[i] for i in train_idx])          # vocabulary learned from TRAIN only
Xva, Xte = vec.transform([X[i] for i in val_idx]), vec.transform([X[i] for i in test_idx])
ytr, yva, yte = y[train_idx], y[val_idx], y[test_idx]

# ---- 3. Model selection on validation only --------------------------------------------------------------------------
best = None
for C in (0.3, 1, 3, 10, 30):
    m = LogisticRegression(C=C, max_iter=2000, class_weight="balanced", solver="liblinear").fit(Xtr, ytr)
    ap = average_precision_score(yva, m.predict_proba(Xva)[:, 1])
    print(f"  C={C}: val PR-AUC={ap:.4f}")
    if best is None or ap > best[0]: best = (ap, C, m)
_, C, lr = best

# Calibrate probabilities on the validation split (sigmoid), keeping the fitted classifier frozen.
cal = CalibratedClassifierCV(FrozenEstimator(lr), method="sigmoid").fit(Xva, yva)

# ---- 4. Threshold: maximise F1 on validation (test untouched) ---------------------------------------------------------
pva = cal.predict_proba(Xva)[:, 1]
ths = np.linspace(0.05, 0.95, 91)
f1s = [f1_score(yva, pva >= t) for t in ths]
THRESH = float(ths[int(np.argmax(f1s))])
print(f"chosen threshold (val F1-optimal): {THRESH:.2f}")

# ---- 5. One-shot held-out evaluation -----------------------------------------------------------------------------------
def metrics(yt, p, t):
    pred = (p >= t).astype(int)
    tn, fp, fn, tp = confusion_matrix(yt, pred, labels=[0, 1]).ravel()
    return dict(n=int(len(yt)), accuracy=accuracy_score(yt, pred), precision=precision_score(yt, pred, zero_division=0), recall=recall_score(yt, pred, zero_division=0),
                f1=f1_score(yt, pred, zero_division=0), roc_auc=roc_auc_score(yt, p) if len(set(yt)) > 1 else None,
                pr_auc=average_precision_score(yt, p) if len(set(yt)) > 1 else None, brier=brier_score_loss(yt, p),
                tn=int(tn), fp=int(fp), fn=int(fn), tp=int(tp))

pte = cal.predict_proba(Xte)[:, 1]
test_rows = [rows[i] for i in test_idx]
def slice_metrics(mask):
    mask = np.array(mask)
    return metrics(yte[mask], pte[mask], THRESH) if mask.sum() >= 30 and len(set(yte[mask])) > 1 else {"n": int(mask.sum()), "note": "too small or single-class"}

result = dict(
    model=MODEL_NAME, version=MODEL_VERSION, threshold=THRESH, selected_C=C,
    overall=metrics(yte, pte, THRESH), at_0_5=metrics(yte, pte, 0.5),
    slices={  # shows how much of the score depends on source style rather than content
        "short_texts(<400 chars)": slice_metrics([r["short"] for r in test_rows]),
        "long_texts": slice_metrics([not r["short"] for r in test_rows]),
        "contains_url": slice_metrics([r["has_url"] for r in test_rows]),
        "no_url": slice_metrics([not r["has_url"] for r in test_rows]),
        "has_uppercase(modern/cased sources)": slice_metrics([r["cased"] for r in test_rows]),
        "all_lowercase(corpus-style emails)": slice_metrics([not r["cased"] for r in test_rows]),
    },
    reliability=[dict(bin=f"{lo:.1f}-{lo+.1:.1f}", n=int(((pte >= lo) & (pte < lo + .1 + (lo > .85) * 1e-9)).sum()),
                      mean_pred=float(pte[(pte >= lo) & (pte < lo + .1 + (lo > .85) * 1e-9)].mean()) if ((pte >= lo) & (pte < lo + .1 + (lo > .85) * 1e-9)).any() else None,
                      observed=float(yte[(pte >= lo) & (pte < lo + .1 + (lo > .85) * 1e-9)].mean()) if ((pte >= lo) & (pte < lo + .1 + (lo > .85) * 1e-9)).any() else None)
                 for lo in np.arange(0, 1, .1)],
    split=sizes, cleaning=dict(raw=len(raw), kept=len(rows), dropped=dict(dropped)),
)
(OUT / "metrics.json").write_text(json.dumps(result, indent=2, default=float))
o = result["overall"]
with open(OUT / "confusion_matrix.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["", "pred_safe", "pred_suspicious"]); w.writerow(["true_safe", o["tn"], o["fp"]]); w.writerow(["true_suspicious", o["fn"], o["tp"]])
print(json.dumps({k: (round(v, 4) if isinstance(v, float) else v) for k, v in o.items()}))
for k, v in result["slices"].items(): print(" ", k, {a: (round(b, 3) if isinstance(b, float) else b) for a, b in v.items() if a in ("n", "accuracy", "precision", "recall", "f1", "note")})

# ---- 6. What the model keys on (to spot leakage) ----------------------------------------------------------------------
names = np.array(vec.get_feature_names_out()); coef = lr.coef_[0]
top = dict(suspicious=names[np.argsort(-coef)[:40]].tolist(), safe=names[np.argsort(coef)[:40]].tolist())
(OUT / "top_features.json").write_text(json.dumps(top, indent=2))

# ---- 7. Anecdotal sanity probe (NOT a metric): hand-written modern messages, outside the training distribution -----------
probe = [
    ("modern phishing SMS", "Your bank account has been suspended. Verify your identity within 24 hours at http://secure-bank-verify.example/login or your funds will be frozen.", 1),
    ("delivery scam SMS", "Your parcel is on hold. Pay a 1.99 redelivery fee at http://parcel-redeliver.example/pay to avoid it being returned.", 1),
    ("credential-reset email", "Dear user, your mailbox storage is full. Click the link below to confirm your password or your account will be deleted today.", 1),
    ("classic spam", "Cheap meds online, no prescription needed! Buy now and save 80% on all orders!!!", 1),
    ("benign lunch", "Hi! Are we still meeting for lunch tomorrow at 1pm? Let me know if you need to move it.", 0),
    ("benign work email", "Hi team, attached are the meeting notes from Tuesday. Please review the action items before Friday's call.", 0),
    ("benign real notification", "Your verification code is 482913. It expires in 10 minutes. Do not share it with anyone.", 0),
]
pp = cal.predict_proba(vec.transform([normalize(t) for _, t, _ in probe]))[:, 1]
(OUT / "sanity_probe.json").write_text(json.dumps(dict(note="Anecdotal examples, NOT evaluation metrics. They are outside the training distribution and show failure modes.",
    results=[dict(case=c, expected="suspicious" if e else "safe", score=round(float(s), 4), predicted="suspicious" if s >= THRESH else "safe") for (c, _, e), s in zip(probe, pp)]), indent=2))
for (c, _, e), s in zip(probe, pp): print(f"  probe {c:28s} expected={'susp' if e else 'safe'} score={s:.3f}")

# ---- 8. Save --------------------------------------------------------------------------------------------------------------
joblib.dump(dict(vectorizer=vec, model=cal, threshold=THRESH, labels={0: "safe", 1: "suspicious"}), OUT / "model.joblib", compress=3)
sha = hashlib.sha256((OUT / "model.joblib").read_bytes()).hexdigest()
(OUT / "config.json").write_text(json.dumps(dict(
    model=MODEL_NAME, version=MODEL_VERSION, trained_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), seed=SEED, threshold=THRESH,
    label_mapping={"0": "safe", "1": "suspicious"}, score_meaning="calibrated probability (sigmoid, fit on validation split) that the text is suspicious (spam/phishing-like) per the training data",
    normalizer_version=NORMALIZER_VERSION, max_chars=5000, model_sha256=sha,
    dataset=dict(name="ealvaradob/phishing-dataset (texts.json)", revision="55caf9af01ae498d68ff44886ff69a4b165eb54b", declared_license="apache-2.0",
                 file_sha256=hashlib.sha256((HERE / "data" / "texts.json").read_bytes()).hexdigest()),
    dependencies=dict(python=sys.version.split()[0], scikit_learn=sklearn.__version__, numpy=np.__version__, scipy=scipy.__version__, joblib=joblib.__version__),
), indent=2))
print("saved model sha256", sha[:16])
