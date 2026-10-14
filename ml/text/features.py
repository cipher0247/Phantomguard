"""Text normalisation shared by training and the inference service (single source of truth).

The dataset mixes sources with different formatting (Enron-style emails are lower-cased and space-tokenised, SMS keep case and
punctuation). Normalising aggressively stops the model from keying on formatting rather than content.
"""
import re

NORMALIZER_VERSION = "2"
MAX_CHARS = 5000  # text beyond this is ignored (training and inference); the corpus has multi-MB outliers

_URL = re.compile(r"(?i)\b(?:https?://|www\.)\S+")
_EMAIL = re.compile(r"(?i)\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b")
_DIGITS = re.compile(r"\d+")
_NONWORD = re.compile(r"[^a-z$%! ]+")
_WS = re.compile(r"\s+")


def normalize(text: str) -> str:
    t = text[:MAX_CHARS]
    t = _URL.sub(" urltoken ", t)
    t = _EMAIL.sub(" emailtoken ", t)
    t = t.lower()
    t = _DIGITS.sub(" numtoken ", t)  # keep "a number appeared", not the value
    t = _NONWORD.sub(" ", t)
    return _WS.sub(" ", t).strip()
