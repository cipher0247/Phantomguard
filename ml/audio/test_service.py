"""Tests for audio preprocessing and the audio service. Run from the repo root:
    ml\\.venv\\Scripts\\python.exe -m unittest ml.audio.test_service -v
Preprocessing tests need only ffmpeg. Service inference tests run when trained artifacts or the pinned pretrained checkpoint are cached.
"""
import io, json, os, subprocess, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np, soundfile as sf

sys.path.insert(0, str(Path(__file__).parent))
import audio_common as common  # noqa: E402
from audio_common import MediaError, SR  # noqa: E402
from ml.audio import serve as audio_serve  # noqa: E402

ART = Path(__file__).parent / "artifacts"
PRETRAINED = json.loads((ART.parent / "pretrained.json").read_text())
HF_CACHE = Path(os.environ.get("HF_HUB_CACHE", Path.home() / ".cache" / "huggingface" / "hub"))
PRETRAINED_WEIGHTS = HF_CACHE / f"models--{PRETRAINED['backbone']['id'].replace('/', '--')}" / "snapshots" / PRETRAINED["backbone"]["revision"] / "model.safetensors"
HAVE_MODEL = ((ART / "model.joblib").exists() and (ART / "config.json").exists()) or PRETRAINED_WEIGHTS.exists()


def tone(seconds=3.0, sr=SR, hz=220.0):
    t = np.arange(int(seconds * sr)) / sr
    return (0.3 * np.sin(2 * np.pi * hz * t) + 0.02 * np.random.default_rng(0).standard_normal(t.size)).astype(np.float32)


def wav_bytes(x, sr=SR):
    b = io.BytesIO(); sf.write(b, x, sr, format="WAV"); return b.getvalue()


def transcode(raw: bytes, ext: str, *args) -> bytes:
    with tempfile.TemporaryDirectory() as d:
        s, o = Path(d, "in.wav"), Path(d, f"out.{ext}"); s.write_bytes(raw)
        subprocess.run([common.find_tool("ffmpeg"), "-nostdin", "-v", "error", "-i", str(s), *args, str(o)], check=True)
        return o.read_bytes()


def write_tmp(data: bytes) -> str:
    fd, p = tempfile.mkstemp(); os.write(fd, data); os.close(fd); return p


class Preprocessing(unittest.TestCase):
    def test_pretrained_audio_score_maps_to_synthetic_class(self):
        cfg = json.loads((ART / "../pretrained.json").resolve().read_text())
        self.assertEqual(audio_serve.label_for_score(0.98, cfg["threshold"], cfg["label_mapping"]), "synthetic")
        self.assertEqual(audio_serve.label_for_score(0.02, cfg["threshold"], cfg["label_mapping"]), "genuine")
        self.assertEqual(audio_serve.label_for_score(cfg["threshold"], cfg["threshold"], cfg["label_mapping"]), "synthetic")
        self.assertEqual(audio_serve.label_for_score(cfg["threshold"] - 1e-6, cfg["threshold"], cfg["label_mapping"]), "genuine")

    def test_decode_formats_to_mono_16k(self):
        raw = wav_bytes(tone(3, 44100), 44100)          # 44.1 kHz source is resampled
        for name, data in {"wav": raw, "mp3": transcode(raw, "mp3"), "m4a": transcode(raw, "m4a"), "flac": transcode(raw, "flac"), "ogg": transcode(raw, "ogg")}.items():
            p = write_tmp(data)
            try:
                x = common.decode_audio(p, max_seconds=60)
                self.assertEqual(x.dtype, np.float32, name); self.assertAlmostEqual(len(x) / SR, 3.0, delta=0.3, msg=name)
            finally: os.remove(p)

    def test_stereo_is_downmixed(self):
        st = np.stack([tone(2), tone(2, hz=440)], axis=1)
        b = io.BytesIO(); sf.write(b, st, SR, format="WAV"); p = write_tmp(b.getvalue())
        try: self.assertEqual(common.decode_audio(p, 60).ndim, 1)
        finally: os.remove(p)

    def test_duration_cap_applies_to_decode(self):
        p = write_tmp(wav_bytes(tone(8)))
        try: self.assertLessEqual(len(common.decode_audio(p, max_seconds=3)) / SR, 3.05)
        finally: os.remove(p)

    def test_corrupt_empty_and_tiny_inputs_are_rejected_with_safe_messages(self):
        for name, data in {"garbage": os.urandom(5000), "empty": b"", "header_only": wav_bytes(tone(1))[:44], "too_short": wav_bytes(tone(0.2))}.items():
            p = write_tmp(data)
            try:
                with self.assertRaises(MediaError, msg=name) as c:
                    common.probe_duration(p); common.decode_audio(p, 60)
                self.assertNotIn("Traceback", str(c.exception)); self.assertNotIn(p, str(c.exception))
            finally: os.remove(p)

    def test_windows_are_bounded_and_cover_clip(self):
        x = tone(65)
        w = common.windows(x, 10, 10, max_windows=6)
        self.assertEqual(len(w), 6); self.assertTrue(all(len(c) >= SR for c in w))
        self.assertEqual(len(common.windows(tone(2), 10, 10, 6)), 1)


@unittest.skipUnless(HAVE_MODEL, "trained audio artifacts not present (run ml/audio/train.py)")
class Service(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from starlette.testclient import TestClient
        audio_serve.load(); cls.serve = audio_serve; cls.client = TestClient(audio_serve.app)

    def post(self, data: bytes, name="a.wav"):
        return self.client.post("/predict", files={"file": (name, data)})

    def test_contract_and_cleanup(self):
        before = set(Path(tempfile.gettempdir()).glob("pg-audio-*"))
        r = self.post(wav_bytes(tone(12)))
        self.assertEqual(r.status_code, 200, r.text); j = r.json()
        self.assertEqual(set(j), {"score", "label", "model", "version", "details"})
        self.assertTrue(0 <= j["score"] <= 1); self.assertIn(j["label"], ("genuine", "synthetic"))
        self.assertEqual(j["label"] == "synthetic", j["score"] >= j["details"]["threshold"])
        self.assertIn("not a calibrated probability", j["details"]["score_contract"])
        self.assertGreaterEqual(j["details"]["windows_analysed"], 1)
        self.assertEqual(len(json.loads(j["details"]["window_scores"])), j["details"]["windows_analysed"])
        self.assertTrue(all(isinstance(v, (str, int, float, bool)) for v in j["details"].values()))
        self.assertEqual(set(Path(tempfile.gettempdir()).glob("pg-audio-*")), before, "temporary upload was not deleted")

    def test_rounded_score_and_label_use_the_same_threshold_value(self):
        threshold = audio_serve.STATE["cfg"]["threshold"]
        with patch.object(audio_serve, "p_fake", return_value=np.array([threshold - 1e-8])):
            result = self.post(wav_bytes(tone(3))).json()
        self.assertEqual(result["score"], threshold)
        self.assertEqual(result["label"] == "synthetic", result["score"] >= result["details"]["threshold"])

    def test_mp3_and_m4a_inputs(self):
        raw = wav_bytes(tone(4))
        for ext in ("mp3", "m4a"): self.assertEqual(self.post(transcode(raw, ext), f"a.{ext}").status_code, 200, ext)

    def test_rejections(self):
        self.assertEqual(self.post(b"").status_code, 422)
        self.assertEqual(self.post(os.urandom(4000)).status_code, 422)
        self.assertEqual(self.post(wav_bytes(tone(0.2))).status_code, 422)
        r = self.post(os.urandom(4000)); self.assertNotIn("Traceback", r.text)

    def test_too_long_is_413(self):
        old = self.serve.MAX_SECONDS; self.serve.MAX_SECONDS = 5
        try: self.assertEqual(self.post(wav_bytes(tone(9))).status_code, 413)
        finally: self.serve.MAX_SECONDS = old

    def test_oversize_upload_is_413_and_cleaned_up(self):
        old = self.serve.MAX_UPLOAD; self.serve.MAX_UPLOAD = 10_000
        before = set(Path(tempfile.gettempdir()).glob("pg-audio-*"))
        try: self.assertEqual(self.post(wav_bytes(tone(3))).status_code, 413)
        finally: self.serve.MAX_UPLOAD = old
        self.assertEqual(set(Path(tempfile.gettempdir()).glob("pg-audio-*")), before)

    def test_health(self):
        self.assertTrue(self.client.get("/health").json()["ok"])


if __name__ == "__main__":
    unittest.main()
