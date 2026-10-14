# PHANTOMGUARD machine learning

## Text model: `pg-text-tfidf-logreg` v1.0.0

A TF-IDF (word 1–2-grams) + logistic-regression classifier, sigmoid-calibrated, served by `ml/text/serve.py` through the backend's model contract (`PG_TEXT_MODEL_URL`).

**What it is and is not.** It scores English email/SMS text for *spam-and-phishing-like wording* as represented in its training corpus. It is **not** a validated phishing detector, it does not look at links' destinations, and it should be presented as a hint, never as proof. Held-out numbers below are in-distribution and overstate real-world accuracy (see Limitations).

### Reproduce

```powershell
py -3.14 -m venv ml\.venv
ml\.venv\Scripts\python.exe -m pip install scikit-learn joblib numpy      # versions used: see ml/text/artifacts/config.json
# download the dataset (pinned revision) into ml/text/data/texts.json
Invoke-WebRequest "https://huggingface.co/datasets/ealvaradob/phishing-dataset/resolve/55caf9af01ae498d68ff44886ff69a4b165eb54b/texts.json" -OutFile ml\text\data\texts.json
ml\.venv\Scripts\python.exe ml\text\inspect_data.py      # label balance, duplicates, source mix
ml\.venv\Scripts\python.exe ml\text\train.py             # trains, calibrates, evaluates, writes ml/text/artifacts/
ml\.venv\Scripts\python.exe -m unittest ml.text.test_service     # service contract tests
ml\.venv\Scripts\python.exe ml\text\serve.py --port 9100          # then set PG_TEXT_MODEL_URL=http://127.0.0.1:9100/predict
```

`model.joblib` is git-ignored (regenerate with `train.py`; its SHA-256 is recorded in `config.json`). Metrics, confusion matrix, top features and the anecdotal probe are committed in `ml/text/artifacts/`.

### Service contract

`POST /predict {"text": "..."}` →
`{"score": 0..1, "label": "safe"|"suspicious", "model": "pg-text-tfidf-logreg", "version": "1.0.0", "details": {"threshold", "scope", "truncated", "model_sha256", "limitations"}}`.
`score` is the calibrated probability of "suspicious"; `label` is `suspicious` when `score >= details.threshold` (0.36, chosen to maximise F1 on the validation split, not on the test set). The backend uses that threshold to decide *flagged*: below it low risk, from it warning, ≥ 0.85 high. Inputs with no analysable words, or over 20,000 characters, are rejected with HTTP 400 (the backend answers 422). Only the first 5,000 characters are analysed (`details.truncated`). Binds to 127.0.0.1 only; logs contain no message text.

### Data

`ealvaradob/phishing-dataset`, file `texts.json`, revision `55caf9af…`, 20,137 records (labels: 12,465 benign / 7,672 phishing), SHA-256 `2479fdb9…`. Declared licence on the Hugging Face card: **Apache-2.0**. The card says it compiles a Kaggle email corpus (Enron-derived, "phishing emails") and a Mendeley SMS dataset. **Licences of those upstream sources have not been verified; resolve this before redistributing the data or the model.** The data is downloaded, never committed.

Findings from `inspect_data.py` and `top_features.json`:
- The "phishing" class is mostly **classic spam** (pharmacy, stock promotion, adult content); the benign class is mostly **Enron business email and linguistics mailing-list posts**. The model therefore partly learns *which corpus* a text resembles: top "safe" features include `enron`, `vince`, `houston`, `linguistics`, `university`.
- 681 exact (normalised) duplicates and 4 empty texts were removed. No conflicting-label duplicates were found.

### Method

Text is normalised (URLs/emails/numbers replaced by tokens, lower-cased, punctuation spacing removed) to reduce formatting cues. Split 80/10/10 **grouped** by the first 200 normalised characters so template/near-duplicate messages never straddle train/validation/test (checked by an assertion). Vocabulary and weights come from train only; `C` was chosen on validation PR-AUC; probabilities were calibrated and the threshold chosen on validation; the test split was evaluated once.

### Held-out results (test split, n = 1,933, threshold 0.36)

| accuracy | precision | recall | F1 | ROC-AUC | PR-AUC | Brier |
|---|---|---|---|---|---|---|
| 0.980 | 0.979 | 0.967 | 0.973 | 0.998 | 0.996 | 0.017 |

Confusion matrix: TN 1213 · FP 15 · FN 23 · TP 682. Per-slice results (short texts, with/without URL, cased vs all-lower-case) are in `metrics.json`; short texts are weaker (accuracy ≈ 0.97 vs 0.99 for long).

### Limitations (read before relying on it)

1. **Distribution shift.** Scores this high mostly reflect separable *sources*, not general phishing ability. On a hand-written probe set outside the corpus (`sanity_probe.json`, anecdotal, 7 messages, **not a metric**) it classed 6 of 7 as expected but scored a **legitimate verification-code SMS as suspicious (0.98)**, and rated a delivery-fee scam only 0.62.
2. English only; no URL reputation, sender, header or image analysis; spam-like wording is the main signal.
3. The threshold 0.36 was tuned on the same corpus; it is not calibrated to your traffic. Re-evaluate on your own labelled messages before using results for decisions.
4. Dataset permissions for upstream sources are unresolved (above).

## Audio and video

No audio or video model is bundled or trained. Those endpoints stay "not configured" until a service implementing the contract in the main README is supplied; see the main README for what a real integration needs.
