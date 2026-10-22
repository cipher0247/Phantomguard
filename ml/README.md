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

## Audio and video (experimental)

The repository does not bundle model weights. `scripts/start-all.ps1` can start the configured experimental audio and video services; both download pinned Hugging Face model revisions when first loaded. Install FFmpeg for the media decoders (`winget install --id Gyan.FFmpeg.Essentials --scope user`) and use the repository's Python environment.

### Audio

`ml/audio/serve.py` prefers the locally trained Wav2Vec2 + logistic-regression artifact if present. Otherwise it serves the pinned `MelodyMachine/Deepfake-audio-detection-V2` checkpoint using a 0.5 threshold. On the full 1,866-clip dataset-declared evaluation below, the pretrained checkpoint scored ROC-AUC 0.491 and 48.8% accuracy; synthetic precision was 40.0%, recall 4.9%, and F1 8.8% (TN=864, FP=69, FN=887, TP=46). It misclassified 956 clips. This is near chance and missed most synthetic clips. The application labels these results experimental; do not rely on them.

When the pretrained fallback is active, the service score is the mean of per-window softmax outputs at class index 0 (the pinned checkpoint metadata labels index 0 `fake` and index 1 `real`). It is an uncalibrated model score, not a calibrated manipulation probability. Scores at or above 0.5 map to `synthetic`; lower scores map to `genuine`. Input is decoded by FFmpeg to mono, 16 kHz float32, then normalized by the checkpoint's feature extractor; windows are at most 10 seconds, with up to six evenly selected windows. If local trained artifacts exist, the service instead averages the logistic regression's `predict_proba` output for class 1; the training pipeline explicitly describes this as uncalibrated.

The selected checkpoint's model card declares Apache-2.0 but names only a generic `audiofolder` training dataset and does not document its provenance. Its reported 99.7% accuracy is not evidence of cross-dataset performance. The evaluation data is [`garystafford/deepfake-audio-detection`](https://huggingface.co/datasets/garystafford/deepfake-audio-detection/tree/fcf5344bb7f82b54b6b932291326d29750ef1e82), v4 at the pinned revision shown: 1,866 items in its only `train` split, labels 0=real/1=fake, and CC-BY-4.0 declared by the dataset card. The card describes 933 real clips from 14 YouTube recordings and 933 clips from six TTS systems; upstream permissions for the YouTube recordings and overlap with the model's undisclosed training data remain unverified.

Reproduce inference through the actual service decoder, windowing, feature extractor, and threshold (uses the already-cached revision only; does not download):

```powershell
$env:HF_HUB_OFFLINE = "1"
ml\.venv\Scripts\python.exe ml\audio\eval_service.py
```

This writes `ml/audio/evaluations/audio_manifest.json` and `audio_service_evaluation.json`, including file IDs, SHA-256 digests, source labels, per-window scores, and every error. Since the source has no test split and the model's training data is undocumented, label this an exploratory external-dataset check, not an independent certification.

The optional training pipeline in `ml/audio/train.py` uses a grouped cross-validation split by TTS platform and real-video source, but extracts embeddings on CPU and can take hours. It downloads the dataset if it is not cached; it writes its model and measured metrics under `ml/audio/artifacts/`.

### Video

`ml/video/serve.py` uses the pinned `buildborderless/CommunityForensics-DeepfakeDet-ViT` checkpoint and analyses sampled frames. On the 100 source-folder-labelled videos below, at the unchanged operational threshold 0.03 it scored ROC-AUC 0.559 and 58% accuracy; manipulated precision was 65.4%, recall 34.0%, and F1 44.7% (TN=41, FP=9, FN=33, TP=17), with 42 misclassifications. The threshold was selected on this same sample, so these figures are optimistically biased and the labels are not independently verified. At threshold 0.5, fake recall was 0%. This is not a reliable deepfake detector; do not rely on it.

The service score is the mean of sigmoid-transformed scalar head outputs over 12 evenly spaced frame samples; scores at or above 0.03 map to `manipulated`, and lower scores map to `not flagged`. This is an uncalibrated sigmoid-head score, not a calibrated manipulation probability. The model card declares MIT; the pinned model configuration names its only output class `LABEL_0`, so the manipulation direction is an empirical service convention, not a documented semantic class. Frames are extracted with FFmpeg, converted to RGB, and downscaled to a maximum 640-pixel side; the pinned image processor then resizes and normalizes them. Per-frame post-sigmoid scores are returned in scan details as `frame_scores`; audio scan details similarly include the per-window fake-class scores in `window_scores`. The 100-video manifest comes from [`angads24/deepfake-video`](https://huggingface.co/datasets/angads24/deepfake-video/tree/3470af66b50e6d715f108bdfa67342907137e1f4), whose card declares CC-BY-SA-4.0 but contains no provenance description. Labels are source-folder declarations only; they are not independently verified. The threshold was selected on this same manifest; it is not an independent test set.

Reproduce current-service inference on the local manifest (uses only cached files/checkpoint; does not download):

```powershell
$env:HF_HUB_OFFLINE = "1"
ml\.venv\Scripts\python.exe ml\video\eval_service.py
```

This writes `ml/video/evaluations/video_manifest.json` and `video_service_evaluation.json`, including source-declared labels, file hashes, per-frame scores, and every mismatch. Treat all metrics as exploratory because label provenance is unknown and threshold selection used the same 100 clips. A separate authorized video dataset with verified provenance and an untouched evaluation split is required for a meaningful performance claim.

Both services return `experimental: true` and their measured limitations in every scan response so the mobile UI can warn users. Re-evaluate on independent, representative data before considering better models or thresholds.
