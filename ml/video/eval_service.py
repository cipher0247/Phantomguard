"""Evaluate the configured video service on the local, dataset-declared manifest.

The source repository has an empty dataset card and its origin is unknown. This
is therefore exploratory only; it is not treated as verified ground truth or an
independent test set. The operational threshold is used unchanged.

Run offline after the pinned checkpoint and local evaluation videos are present:
    ml\\.venv\\Scripts\\python.exe ml/video/eval_service.py
"""
import hashlib
import json
import os
import sys
from collections import Counter
from pathlib import Path

from sklearn.metrics import accuracy_score, confusion_matrix, precision_recall_fscore_support, roc_auc_score

os.environ.setdefault("HF_HUB_OFFLINE", "1")
sys.path.insert(0, str(Path(__file__).parent))
import serve as video_serve  # noqa: E402

ROOT = Path(__file__).parent
DATA = ROOT / "data"
OUT = ROOT / "evaluations"
OUT.mkdir(exist_ok=True)


def main() -> None:
    source = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))
    items = source.get("items")
    if not isinstance(items, list) or not items:
        raise RuntimeError("Video dataset manifest has no items.")
    rows = []
    for item in items:
        relative = item.get("file")
        label = item.get("label")
        if not isinstance(relative, str) or label not in (0, 1):
            raise ValueError(f"Invalid video manifest record: {item}")
        path = (DATA / relative).resolve()
        if not path.is_relative_to(DATA.resolve()) or not path.is_file():
            raise FileNotFoundError(f"Video manifest file is missing or outside the data directory: {relative}")
        rows.append({
            "file_id": relative,
            "path": path,
            "label": int(label),
            "label_name": "fake" if label else "real",
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        })

    counts = Counter(row["label_name"] for row in rows)
    manifest = {
        "dataset": source["repo"],
        "dataset_url": f"https://huggingface.co/datasets/{source['repo']}/tree/{source['revision']}",
        "dataset_revision": source["revision"],
        "split": "unknown",
        "license_declared": source.get("license_declared", "unknown"),
        "label_source": "real/fake source-folder assignment recorded in the downloaded dataset manifest",
        "provenance_status": source.get("provenance", "unknown"),
        "class_counts": dict(counts),
        "items": [{
            "file_id": row["file_id"],
            "sha256": row["sha256"],
            "label": row["label"],
            "label_name": row["label_name"],
            "label_verification": "dataset-declared only; not independently verified",
        } for row in rows],
    }
    (OUT / "video_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    video_serve.load()
    cfg = video_serve.STATE["cfg"]
    scores, predictions, records = [], [], []
    for index, row in enumerate(rows, start=1):
        result = video_serve.predict_file(str(row["path"]))
        prediction = int(result["label"] == cfg["labels"]["positive"])
        scores.append(float(result["score"]))
        predictions.append(prediction)
        records.append({
            "file_id": row["file_id"],
            "sha256": row["sha256"],
            "ground_truth": row["label_name"],
            "score": result["score"],
            "frame_scores": json.loads(result["details"]["frame_scores"]),
            "threshold": result["details"]["threshold"],
            "prediction": result["label"],
            "correct": prediction == row["label"],
        })
        if index % 10 == 0:
            print(f"Scored {index}/{len(rows)} video files", flush=True)

    labels = [row["label"] for row in rows]
    tn, fp, fn, tp = (int(v) for v in confusion_matrix(labels, predictions, labels=[0, 1]).ravel())
    precision, recall, f1, _ = precision_recall_fscore_support(
        labels, predictions, labels=[1], average="binary", zero_division=0,
    )
    report = {
        "model": cfg["model"],
        "model_revision": cfg["backbone"]["revision"],
        "model_license_declared": "MIT",
        "dataset": source["repo"],
        "dataset_revision": source["revision"],
        "split": "unknown",
        "n": len(rows),
        "threshold": cfg["threshold"],
        "threshold_selection": "the same 100-item manifest was used to select this operational threshold",
        "score_convention": "mean sigmoid(logit[0]) across sampled frames; uncalibrated score, not a probability; output class semantics are undocumented",
        "confusion_matrix": {"labels": ["real", "fake"], "tn": tn, "fp": fp, "fn": fn, "tp": tp},
        "accuracy": float(accuracy_score(labels, predictions)),
        "precision_fake": float(precision),
        "recall_fake": float(recall),
        "f1_fake": float(f1),
        "roc_auc": float(roc_auc_score(labels, scores)),
        "misclassified": [record for record in records if not record["correct"]],
        "samples": records,
        "caveat": (
            "Exploratory results against source-folder labels only. The dataset card is empty, "
            "provenance is unknown, and the threshold was selected on this same manifest. "
            "These figures are not an independent performance estimate."
        ),
    }
    (OUT / "video_service_evaluation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k not in ("samples", "misclassified")}, indent=2))
    print(f"Misclassified files: {len(report['misclassified'])}")
    for record in report["misclassified"]:
        print(f"  {record['file_id']}: truth={record['ground_truth']} score={record['score']} predicted={record['prediction']}")


if __name__ == "__main__":
    main()
