"""
Gemini helper: validate the API key and pick models that really exist for it.

Model names change often; hard-coded names that do not exist return HTTP 404 and the
scan silently finds "no dialogue". Here we ask Google which models this key can use
(ListModels) and translate errors into a clear Khmer message.
"""

import os
import time
import logging
from typing import Dict, List, Optional, Any

import requests

logger = logging.getLogger("gemini_client")

API_ROOT = "https://generativelanguage.googleapis.com/v1beta"
# Google-maintained aliases that always point to the current Flash models
SAFE_ALIASES = ["gemini-flash-latest", "gemini-flash-lite-latest"]
_EXCLUDE = ("tts", "image", "embedding", "live", "native-audio", "thinking-exp", "learnlm", "gemma", "robotics", "computer-use")

_models_cache: Dict[str, Any] = {"key": None, "ts": 0.0, "models": []}
last_error: str = ""


def get_key() -> str:
    return (os.getenv("GEMINI_API_KEY") or "").strip()


def explain_error(status: int, body: str) -> str:
    text = body or ""
    if status == 400 and ("API_KEY_INVALID" in text or "API key not valid" in text):
        return "Gemini API Key មិនត្រឹមត្រូវ — សូម Copy Key ថ្មីពី aistudio.google.com/apikey (ចាប់ផ្ដើមដោយ AIza…)"
    if "location is not supported" in text.lower():
        return "Gemini មិនអនុញ្ញាតប្រើពីតំបន់/ប្រទេសនេះ — សាកប្រើ VPN ឬ Server នៅតំបន់ផ្សេង"
    if status == 403:
        return "Key នេះគ្មានសិទ្ធិប្រើ Gemini API (API មិនទាន់បើក ឬ Key មានការរឹតបន្តឹង) — បង្កើត Key ថ្មីក្នុង AI Studio"
    if status == 429:
        return "Gemini អស់ Quota ឥតគិតថ្លៃសម្រាប់ពេលនេះ — រង់ចាំបន្តិច ឬបើក Billing ក្នុង AI Studio"
    if status == 404:
        return "Model Gemini នេះមិនមាន — កម្មវិធីនឹងជ្រើស Model ផ្សេងដោយខ្លួនឯង"
    return f"Gemini HTTP {status}: {text[:160]}"


def _model_rank(name: str) -> tuple:
    # Prefer flash (fast, cheap, audio-capable), then flash-lite, then pro; newest version first
    tier = 0 if ("flash" in name and "lite" not in name) else 1 if "flash" in name else 2
    is_preview = 1 if ("preview" in name or "exp" in name) else 0
    digits = "".join(ch if (ch.isdigit() or ch == ".") else " " for ch in name).split()
    version = 0.0
    for d in digits:
        try:
            version = float(d)
            break
        except ValueError:
            continue
    return (tier, is_preview, -version, name)


def list_models(api_key: Optional[str] = None, force: bool = False) -> List[str]:
    """Models (short names) that support generateContent for this key. Cached 30 min."""
    global last_error
    key = api_key or get_key()
    if not key:
        return []
    if not force and _models_cache["key"] == key and (time.time() - _models_cache["ts"]) < 1800:
        return list(_models_cache["models"])
    try:
        resp = requests.get(f"{API_ROOT}/models", params={"pageSize": 200}, headers={"x-goog-api-key": key}, timeout=15)
    except Exception as e:
        last_error = f"មិនអាចភ្ជាប់ទៅ Gemini: {e}"
        return []
    if resp.status_code != 200:
        last_error = explain_error(resp.status_code, resp.text)
        return []
    names = []
    for m in resp.json().get("models", []):
        if "generateContent" not in (m.get("supportedGenerationMethods") or []):
            continue
        short = (m.get("name") or "").replace("models/", "")
        if short.startswith("gemini") and not any(x in short for x in _EXCLUDE):
            names.append(short)
    names.sort(key=_model_rank)
    _models_cache.update({"key": key, "ts": time.time(), "models": names})
    last_error = ""
    return list(names)


def candidate_models(preferred: Optional[str] = None, api_key: Optional[str] = None) -> List[str]:
    """Order to try: preferred (if it exists) → best available models → stable aliases."""
    available = list_models(api_key)
    ordered: List[str] = []
    if preferred and (not available or preferred in available):
        ordered.append(preferred)
    for name in available[:4] + SAFE_ALIASES:
        if name not in ordered:
            ordered.append(name)
    return ordered


def test_key(api_key: Optional[str] = None) -> Dict[str, Any]:
    key = api_key or get_key()
    if not key:
        return {"configured": False, "ok": False, "message": "មិនទាន់ដាក់ GEMINI_API_KEY ក្នុង .env / Settings", "models": []}
    if key.startswith("AQ."):
        return {"configured": True, "ok": False, "message": "Key ដែលចាប់ផ្ដើមដោយ AQ. ជា Key របស់ Vertex AI — ប្រើមិនបានទេ។ សូមបង្កើត Key ថ្មីដែលចាប់ផ្ដើមដោយ AIza… នៅ aistudio.google.com/apikey", "models": []}
    if key.startswith("your_") or len(key) < 20:
        return {"configured": True, "ok": False, "message": "GEMINI_API_KEY មើលទៅមិនត្រឹមត្រូវ (ខ្លីពេក ឬជាគំរូ)", "models": []}
    models = list_models(key, force=True)
    if not models:
        return {"configured": True, "ok": False, "message": last_error or "Key មិនអាចប្រើ Model ណាមួយបាន", "models": []}
    return {"configured": True, "ok": True, "message": f"Gemini ដំណើរការ ✓ (ប្រើ {models[0]})", "models": models[:8]}
