"""Inspect the text phishing dataset before any training: labels, balance, duplicates, source mix, leakage risks."""
import json, hashlib, re, collections, statistics
from pathlib import Path

data = json.loads(Path(__file__).with_name("data").joinpath("texts.json").read_text(encoding="utf-8"))
print("records:", len(data), "keys:", sorted(data[0].keys()))
labels = collections.Counter(r["label"] for r in data)
print("label counts:", dict(labels))

def norm(t): return re.sub(r"\s+", " ", t.strip().lower())
hashes = collections.Counter(hashlib.md5(norm(r["text"]).encode()).hexdigest() for r in data)
dups = sum(c - 1 for c in hashes.values() if c > 1)
print("exact duplicates (normalised):", dups)
# label conflicts: same normalised text with different labels
by = collections.defaultdict(set)
for r in data: by[hashlib.md5(norm(r["text"]).encode()).hexdigest()].add(r["label"])
print("conflicting-label duplicates:", sum(1 for s in by.values() if len(s) > 1))

lens = [len(r["text"]) for r in data]
print("length chars: min %d median %d mean %.0f p95 %d max %d" % (min(lens), statistics.median(lens), statistics.mean(lens), sorted(lens)[int(.95*len(lens))], max(lens)))
short = [r for r in data if len(r["text"]) < 400]
long_ = [r for r in data if len(r["text"]) >= 400]
print("short(<400) n=%d phishing=%.2f | long n=%d phishing=%.2f" % (len(short), sum(r["label"] for r in short)/max(len(short),1), len(long_), sum(r["label"] for r in long_)/max(len(long_),1)))
print("looks like email (has Subject:/From:/newline-heavy):", sum(1 for r in data if re.search(r"(?i)^subject:|\bfrom:", r["text"][:300])))
print("contains url:", sum(1 for r in data if re.search(r"https?://|www\.", r["text"])))
for lab in (0, 1):
    for r in [x for x in data if x["label"] == lab][:3]:
        print(f"--- label {lab}:", r["text"][:200].replace("\n", " "))
