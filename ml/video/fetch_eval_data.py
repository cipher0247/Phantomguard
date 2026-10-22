"""Download a random labelled sample of videos for evaluating the video model (not for training).

Dataset: angads24/deepfake-video (declared CC-BY-SA-4.0; the dataset card is EMPTY, so the origin of the videos is unverified).
Layout: dataset/real/*, dataset/fake/*. Label = folder name.
Usage: ml\\.venv\\Scripts\\python.exe ml\\video\\fetch_eval_data.py [--per-class 50]
Output: ml/video/data/{real,fake}/*.mp4 (git-ignored) and ml/video/data/manifest.json
"""
import argparse, json, random
from pathlib import Path

from huggingface_hub import HfApi, hf_hub_download

ap = argparse.ArgumentParser(); ap.add_argument("--per-class", type=int, default=50); args = ap.parse_args()
REPO = "angads24/deepfake-video"
OUT = Path(__file__).parent / "data"; OUT.mkdir(exist_ok=True)
api = HfApi(); info = api.dataset_info(REPO, files_metadata=True)
files = {c: sorted(s.rfilename for s in info.siblings if s.rfilename.startswith(f"dataset/{c}/")) for c in ("real", "fake")}
rng = random.Random(1234)
manifest = {"repo": REPO, "revision": info.sha, "license_declared": "cc-by-sa-4.0", "provenance": "unknown (empty dataset card)", "items": []}
for label, names in files.items():
    for n in rng.sample(names, min(args.per_class, len(names))):
        p = hf_hub_download(REPO, n, repo_type="dataset", local_dir=str(OUT / "_hf"))
        dst = OUT / label / Path(n).name; dst.parent.mkdir(exist_ok=True)
        Path(p).replace(dst) if not dst.exists() else None
        manifest["items"].append({"file": f"{label}/{dst.name}", "label": 1 if label == "fake" else 0})
        print(label, dst.name, dst.stat().st_size // 1024, "KB", flush=True)
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
print("done", len(manifest["items"]))
