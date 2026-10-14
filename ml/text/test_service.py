"""Contract and normalisation tests for the text model service. Run: ml\\.venv\\Scripts\\python.exe -m unittest ml.text.test_service -v
(from the repo root; requires artifacts from train.py)."""
import json, sys, threading, unittest, urllib.request, urllib.error
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import serve  # noqa: E402
from features import normalize  # noqa: E402


class Service(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cfg, cls.bundle = serve.load()
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), serve.make_handler(cls.cfg, cls.bundle))
        cls.url = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls): cls.srv.shutdown()

    def post(self, body, raw=False):
        data = body if raw else json.dumps(body).encode()
        req = urllib.request.Request(self.url + "/predict", data=data, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r: return r.status, json.load(r)
        except urllib.error.HTTPError as e: return e.code, json.load(e)

    def test_contract(self):
        code, j = self.post({"text": "Cheap meds online, no prescription needed! Buy now and save 80% on all orders!!!"})
        self.assertEqual(code, 200)
        self.assertEqual(set(j), {"score", "label", "model", "version", "details"})
        self.assertTrue(0 <= j["score"] <= 1); self.assertIn(j["label"], ("safe", "suspicious"))
        self.assertEqual(j["label"] == "suspicious", j["score"] >= j["details"]["threshold"])
        self.assertTrue(all(isinstance(v, (str, int, float, bool)) for v in j["details"].values()))

    def test_obvious_cases(self):
        self.assertEqual(self.post({"text": "Cheap meds online, no prescription needed! Buy now and save 80%!!!"})[1]["label"], "suspicious")
        self.assertEqual(self.post({"text": "Hi! Are we still meeting for lunch tomorrow at 1pm?"})[1]["label"], "safe")

    def test_invalid_inputs(self):
        for bad in ({}, {"text": ""}, {"text": "   "}, {"text": 5}, {"text": "x" * 20_001}, {"text": "@@@ ### 123"}, [1]):
            self.assertEqual(self.post(bad)[0], 400, bad if not isinstance(bad, dict) or len(str(bad)) < 80 else "long")
        self.assertEqual(self.post(b"{not json", raw=True)[0], 400)

    def test_oversized_body_rejected(self):
        self.assertEqual(self.post(b'{"text":"' + b"a" * 300_000 + b'"}', raw=True)[0], 413)

    def test_truncation_flag(self):
        self.assertTrue(self.post({"text": "free money click here " * 400})[1]["details"]["truncated"])

    def test_unknown_route(self):
        with self.assertRaises(urllib.error.HTTPError) as c: urllib.request.urlopen(self.url + "/nope")
        self.assertEqual(c.exception.code, 404)


class Normalise(unittest.TestCase):
    def test_urls_numbers_case(self):
        self.assertEqual(normalize("Visit HTTP://Evil.example/x?a=1 NOW, call 555-1234"), "visit urltoken now call numtoken numtoken")

    def test_style_independent(self):
        self.assertEqual(normalize("Re : MEETING , tomorrow ."), normalize("re: meeting, tomorrow."))


if __name__ == "__main__":
    unittest.main()
