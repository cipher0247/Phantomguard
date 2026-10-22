"""Shared audio helpers: safe decoding through ffmpeg (bounded), windowing, model loading."""
import os, shutil, subprocess
from pathlib import Path

import numpy as np

SR = 16_000
HERE = Path(__file__).parent
ROOT = HERE.parent.parent
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


def to_16k_mono(x: np.ndarray, sr: int) -> np.ndarray:
    """In-memory resample (used by evaluation scripts that already hold decoded samples; the service path goes through ffmpeg)."""
    from math import gcd
    from scipy.signal import resample_poly
    if x.ndim > 1: x = x.mean(axis=1)
    if sr != SR:
        g = gcd(sr, SR); x = resample_poly(x, SR // g, sr // g).astype(np.float32)
    return x.astype(np.float32)


def find_tool(name: str) -> str:
    """ffmpeg/ffprobe: PG_FFMPEG_DIR, then the portable tools dir created by the setup script, then PATH."""
    cands = [os.environ.get("PG_FFMPEG_DIR"), str(Path(os.environ.get("LOCALAPPDATA", "")) / "PhantomguardTools" / "ffmpeg")]
    for d in cands:
        if d and (Path(d) / f"{name}.exe").exists(): return str(Path(d) / f"{name}.exe")
    p = shutil.which(name)
    if p: return p
    raise RuntimeError(f"{name} not found (set PG_FFMPEG_DIR or install ffmpeg)")


class MediaError(ValueError):
    """Input we cannot or will not process (corrupt, empty, too long, unsupported). Message is safe to show users."""
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


def probe_duration(path: str, timeout=20) -> float:
    try:
        out = subprocess.run([find_tool("ffprobe"), "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
                             capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise MediaError("Could not read the file in time (it may be corrupt).")
    try:
        d = float(out.stdout.strip())
    except ValueError:
        raise MediaError("Could not read this file. It may be corrupt or not a supported audio/video format.")
    if not np.isfinite(d) or d <= 0: raise MediaError("The recording is empty.")
    return d


def decode_audio(path: str, max_seconds: float, timeout=60) -> np.ndarray:
    """Any audio/video container -> mono float32 16 kHz, capped at max_seconds. ffmpeg runs without stdin, with a hard timeout."""
    cmd = [find_tool("ffmpeg"), "-nostdin", "-v", "error", "-i", path, "-vn", "-t", str(max_seconds), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise MediaError("Decoding took too long (the file may be corrupt).")
    if out.returncode != 0 or not out.stdout:
        raise MediaError("Could not decode this file. It may be corrupt or have no audio track.")
    x = np.frombuffer(out.stdout, dtype=np.float32).copy()
    if x.size < SR // 2: raise MediaError("The recording is too short (under half a second).")
    return x


def windows(x: np.ndarray, win_s: float, hop_s: float, max_windows: int) -> list[np.ndarray]:
    """Fixed-length windows (the last one may be shorter, but not shorter than 1 s unless it is the only one), evenly subsampled to max_windows."""
    w, h = int(win_s * SR), int(hop_s * SR)
    starts = list(range(0, max(len(x) - SR, 1), h)) or [0]
    chunks = [x[s:s + w] for s in starts]
    chunks = [c for c in chunks if len(c) >= SR] or [x]
    if len(chunks) > max_windows:
        idx = np.linspace(0, len(chunks) - 1, max_windows).round().astype(int)
        chunks = [chunks[i] for i in idx]
    return chunks


def load_model(model_id: str, revision: str | None = None):
    import torch
    from transformers import AutoFeatureExtractor, AutoModelForAudioClassification
    fe = AutoFeatureExtractor.from_pretrained(model_id, revision=revision)
    model = AutoModelForAudioClassification.from_pretrained(model_id, revision=revision).eval()
    torch.set_num_threads(max(1, (os.cpu_count() or 4) // 2))
    return fe, model


def p_fake(fe, model, chunks: list[np.ndarray], fake_index: int) -> np.ndarray:
    import torch
    out = []
    with torch.inference_mode():
        for c in chunks:  # one at a time: bounded memory, no padding artefacts
            inp = fe(c, sampling_rate=SR, return_tensors="pt")
            logits = model(**inp).logits
            out.append(torch.softmax(logits, dim=-1)[0, fake_index].item())
    return np.array(out)


def extract_embedding(fe, backbone, x: np.ndarray, layers: list[int], max_seconds: int) -> np.ndarray:
    """-> [len(layers), 1536]: per-layer mean and std over time of the backbone hidden states. MUST match ml/audio/train.py exactly."""
    import torch
    with torch.inference_mode():
        hs = backbone(**fe(x[: max_seconds * SR], sampling_rate=SR, return_tensors="pt"), output_hidden_states=True).hidden_states
    return np.stack([torch.cat([hs[l][0].mean(0), hs[l][0].std(0)]).numpy() for l in layers]).astype(np.float32)


def load_backbone(model_id: str, revision: str | None = None):
    """Frozen SSL backbone + its feature extractor (pinned revision)."""
    import torch
    from transformers import AutoFeatureExtractor, AutoModel
    fe = AutoFeatureExtractor.from_pretrained(model_id, revision=revision)
    bb = AutoModel.from_pretrained(model_id, revision=revision).eval()
    torch.set_num_threads(os.cpu_count() or 4)
    return fe, bb
