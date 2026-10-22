"""Evaluate the configured audio service pipeline on the pinned public dataset.

Uses the dataset's only split (train) as an external, dataset-declared evaluation
set. The model card does not disclose its training data, so overlap cannot be
ruled out. No threshold is selected here.

Run offline after caching the pinned dataset and model:
    ml\\.venv\\Scripts\\python.exe ml/audio/eval_service.py
"""
import hashlib
import json
import os
import sys
import tempfile
from collections import Counter
from pathlib import Path

import pyarrow.parquet as pq
from huggingface_hub import snapshot_download
from sklearn.metrics import accuracy_score, confusion_matrix, precision_recall_fscore_support, roc_auc_score

os.environ.setdefault("HF_HUB_OFFLINE", "1")
sys.path.insert(0, str(Path(__file__).parent))
import serve as audio_serve  # noqa: E402

DATASET_ID = "garystafford/deepfake-audio-detection"
DATASET_REVISION = "fcf5344bb7f82b54b6b932291326d29750ef1e82"
DATASET_VERSION = "v4"
LICENSE = "CC-BY-4.0"
ROOT = Path(__file__).parent
OUT = ROOT / "evaluations"
OUT.mkdir(exist_ok=True)


def read_rows() -> list[dict]:
    snapshot = Path(snapshot_download(
        DATASET_ID,
        repo_type="dataset",
        revision=DATASET_REVISION,
        allow_patterns=["data/*.parquet", "README.md"],
        local_files_only=True,
    ))
    rows = []
    for parquet in sorted((snapshot / "data").glob("*.parquet")):
        for row in pq.read_table(parquet).to_pylist():
            audio = row["audio"]
            data = audio.get("bytes")
            if not data:
                raise ValueError(f"Dataset audio bytes missing for {audio.get('path', 'unknown file')}")
            label = int(row["label"])
            if label not in (0, 1):
                raise ValueError(f"Unexpected dataset label {label}")
            rows.append({
                "file_id": audio["path"],
                "bytes": data,
                "label": label,
                "label_name": "fake" if label else "real",
                "sha256": hashlib.sha256(data).hexdigest(),
            })
    if not rows:
        raise RuntimeError(f"No audio records found in cached dataset revision {DATASET_REVISION}")
    return rows


def main() -> None:
    rows = read_rows()
    label_counts = Counter(row["label_name"] for row in rows)
    manifest = {
        "dataset": DATASET_ID,
        "dataset_url": f"https://huggingface.co/datasets/{DATASET_ID}/tree/{DATASET_REVISION}",
        "dataset_version": DATASET_VERSION,
        "dataset_revision": DATASET_REVISION,
        "split": "train (the source dataset has no declared test split)",
        "license_declared": LICENSE,
        "attribution": "Gary Stafford, Deepfake Audio Detection Dataset v4",
        "download_size_bytes_from_card": 574464278,
        "expanded_size_bytes_from_card": 891744087,
        "label_source": "label field in the pinned source parquet: 0=real, 1=fake",
        "provenance_status": (
            "Labels and collection description are dataset-author-declared. "
            "Original YouTube-source permissions and overlap with the model's "
            "undocumented training data are unverified."
        ),
        "class_counts": dict(label_counts),
        "items": [{k: v for k, v in row.items() if k != "bytes"} for row in rows],
    }
    (OUT / "audio_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    audio_serve.load()
    cfg = audio_serve.STATE["cfg"]
    trained = audio_serve.STATE["mode"] == "trained"
    scores, predictions = [], []
    records = []
    for index, row in enumerate(rows, start=1):
        temp_path = None
        try:
            fd, temp_path = tempfile.mkstemp(prefix="pg-audio-eval-", suffix=".flac")
            with os.fdopen(fd, "wb") as out:
                out.write(row["bytes"])
            result = audio_serve.predict_file(temp_path)
        finally:
            if temp_path and os.path.exists(temp_path):
                os.remove(temp_path)
        prediction = int(result["label"] == "synthetic")
        scores.append(float(result["score"]))
        predictions.append(prediction)
        records.append({
            "file_id": row["file_id"],
            "sha256": row["sha256"],
            "ground_truth": row["label_name"],
            "score": result["score"],
            "window_scores": json.loads(result["details"]["window_scores"]),
            "threshold": result["details"]["threshold"],
            "prediction": result["label"],
            "correct": prediction == row["label"],
        })
        if index % 100 == 0:
            print(f"Scored {index}/{len(rows)} audio files", flush=True)

    labels = [row["label"] for row in rows]
    tn, fp, fn, tp = (int(v) for v in confusion_matrix(labels, predictions, labels=[0, 1]).ravel())
    precision, recall, f1, _ = precision_recall_fscore_support(
        labels, predictions, labels=[1], average="binary", zero_division=0,
    )
    report = {
        "model": cfg["model"],
        "model_revision": cfg["backbone"]["revision"],
        "model_license_declared": "Apache-2.0" if audio_serve.STATE["mode"] == "pretrained" else "unknown",
        "service_mode": audio_serve.STATE["mode"],
        "model_training_data_provenance": "unspecified by the model card; dataset overlap cannot be excluded",
        "dataset": DATASET_ID,
        "dataset_revision": DATASET_REVISION,
        "split": "train",
        "n": len(rows),
        "threshold": cfg["threshold"],
        "score_convention": (
            "mean per-window softmax output at configured fake_index; uncalibrated score, not a probability"
            if not trained else
            "mean per-window logistic regression class-1 output; uncalibrated score, not a probability"
        ),
        "label_mapping": cfg["label_mapping"],
        "model_fake_index": cfg.get("fake_index") if not trained else 1,
        "confusion_matrix": {"labels": ["real", "fake"], "tn": tn, "fp": fp, "fn": fn, "tp": tp},
        "accuracy": float(accuracy_score(labels, predictions)),
        "precision_fake": float(precision),
        "recall_fake": float(recall),
        "f1_fake": float(f1),
        "roc_auc": float(roc_auc_score(labels, scores)),
        "misclassified": [record for record in records if not record["correct"]],
        "samples": records,
        "caveat": (
            "Exploratory external-dataset result, not an independent certification: "
            "the source provides only a train split and the model card omits its training data."
        ),
    }
    (OUT / "audio_service_evaluation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k not in ("samples", "misclassified")}, indent=2))
    print(f"Misclassified files: {len(report['misclassified'])}")
    for record in report["misclassified"]:
        print(f"  {record['file_id']}: truth={record['ground_truth']} score={record['score']} predicted={record['prediction']}")


if __name__ == "__main__":
    main()
