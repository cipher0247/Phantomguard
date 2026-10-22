r"""Video preprocessing and inference contract tests.

Run from the repo root:
    ml\.venv\Scripts\python.exe -m unittest ml.video.test_service -v
The inference tests run only when the pinned checkpoint is already in the local Hugging Face cache.
"""
import io, json, os, subprocess, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))
from ml.video import serve as video_serve  # noqa: E402
from common import find_tool  # noqa: E402

CFG = json.loads((Path(__file__).parent / "config.json").read_text())
HF_CACHE = Path(os.environ.get("HF_HUB_CACHE", Path.home() / ".cache" / "huggingface" / "hub"))
WEIGHTS = HF_CACHE / f"models--{CFG['backbone']['id'].replace('/', '--')}" / "snapshots" / CFG["backbone"]["revision"] / "model.safetensors"
HAVE_MODEL = WEIGHTS.exists()


@unittest.skipUnless(HAVE_MODEL, "pinned video checkpoint not cached; refusing an implicit model download")
class VideoService(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        video_serve.load()
        cls.client = TestClient(video_serve.app)
        cls.temp = tempfile.TemporaryDirectory(prefix="pg-video-test-")
        cls.video = Path(cls.temp.name, "sample.mp4")
        subprocess.run(
            [
                find_tool("ffmpeg"), "-nostdin", "-hide_banner", "-loglevel", "error",
                "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=12", "-t", "2",
                "-an", "-c:v", "mpeg4", "-pix_fmt", "yuv420p", "-y", str(cls.video),
            ],
            check=True,
            timeout=30,
        )

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def post(self, data: bytes, name="clip.mp4"):
        return self.client.post("/predict", files={"file": (name, io.BytesIO(data), "video/mp4")})

    def test_score_direction_and_threshold_boundary(self):
        threshold = CFG["threshold"]
        self.assertEqual(video_serve.label_for_score(threshold - 1e-6, threshold, CFG["labels"]), CFG["labels"]["negative"])
        self.assertEqual(video_serve.label_for_score(threshold, threshold, CFG["labels"]), CFG["labels"]["positive"])
        self.assertEqual(video_serve.label_for_score(threshold + 1e-6, threshold, CFG["labels"]), CFG["labels"]["positive"])

    def test_health_reports_loaded_pinned_model(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        self.assertEqual(response.json()["model"], CFG["model"])

    def test_inference_contract_and_experimental_warning(self):
        before = set(Path(tempfile.gettempdir()).glob("pg-video-*"))
        response = self.post(self.video.read_bytes())
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(set(result), {"score", "label", "model", "version", "details"})
        self.assertGreaterEqual(result["score"], 0)
        self.assertLessEqual(result["score"], 1)
        self.assertEqual(result["model"], CFG["model"])
        self.assertTrue(result["details"]["experimental"])
        self.assertIn("EXPERIMENTAL", result["details"]["limitations"])
        self.assertEqual(len(json.loads(result["details"]["frame_scores"])), result["details"]["frames_analysed"])
        self.assertIn("not a calibrated probability", result["details"]["score_contract"])
        self.assertEqual(result["label"] == CFG["labels"]["positive"], result["score"] >= result["details"]["threshold"])
        self.assertEqual(set(Path(tempfile.gettempdir()).glob("pg-video-*")), before)

    def test_rounded_score_and_label_use_the_same_threshold_value(self):
        threshold = CFG["threshold"]
        per_frame = np.full(video_serve.N_FRAMES, threshold - 1e-8)
        with patch.object(video_serve, "frame_scores", return_value=per_frame):
            result = self.post(self.video.read_bytes()).json()
        self.assertEqual(result["score"], threshold)
        self.assertEqual(result["label"] == CFG["labels"]["positive"], result["score"] >= result["details"]["threshold"])

    def test_empty_and_invalid_video_are_rejected(self):
        self.assertEqual(self.post(b"").status_code, 422)
        response = self.post(b"not a video", "broken.mp4")
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("Traceback", response.text)

    def test_duration_limit_is_enforced(self):
        previous = video_serve.MAX_SECONDS
        video_serve.MAX_SECONDS = 1
        try:
            response = self.post(self.video.read_bytes())
            self.assertEqual(response.status_code, 413)
        finally:
            video_serve.MAX_SECONDS = previous

    def test_upload_size_limit_and_temp_cleanup(self):
        previous = video_serve.MAX_UPLOAD
        video_serve.MAX_UPLOAD = 10
        before = set(Path(tempfile.gettempdir()).glob("pg-video-*"))
        try:
            response = self.post(b"x" * 11)
            self.assertEqual(response.status_code, 413)
        finally:
            video_serve.MAX_UPLOAD = previous
        self.assertEqual(set(Path(tempfile.gettempdir()).glob("pg-video-*")), before)


if __name__ == "__main__":
    unittest.main()
