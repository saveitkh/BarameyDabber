"""
Gemini helper: validate the API key and pick models that really exist for it.

Model names change often; hard-coded names that do not exist return HTTP 404 and the
scan silently finds "no dialogue". Here we ask Google which models this key can use
(ListModels) and translate errors into a clear Khmer message.
"""

import os
import re
import json
import time
import logging
from typing import Dict, List, Optional, Any

import requests

logger = logging.getLogger("gemini_client")

API_ROOT = "https://generativelanguage.googleapis.com/v1beta"
# Google-maintained aliases that always point to the current Flash models
SAFE_ALIASES = ["gemini-flash-latest", "gemini-flash-lite-latest"]
_EXCLUDE = ("tts", "image", "embedding", "live", "native-audio", "thinking-exp", "learnlm", "gemma", "robotics", "computer-use")

# Matches the 6 emotions the Session Studio's casting table offers (Khmer labels in
# src/components/session/DubbingStudioPanel.tsx). "fear" is normalised to "fearful".
EMOTION_IDS = ["neutral", "happy", "sad", "angry", "fearful", "excited"]
_EMOTION_SYNONYMS = {
    "fear": "fearful", "scared": "fearful", "afraid": "fearful", "anxious": "fearful",
    "joy": "happy", "joyful": "happy", "glad": "happy", "cheerful": "happy",
    "sorrow": "sad", "sorrowful": "sad", "upset": "sad", "grief": "sad",
    "mad": "angry", "furious": "angry", "rage": "angry",
    "thrilled": "excited", "enthusiastic": "excited", "surprised": "excited",
}

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


_EMOTION_PROMPT = (
    "You are a Cambodian Khmer dubbing director reading ONE line of dialogue before it is "
    "recorded by a voice actor.\n\n"
    "Khmer line:\n\"\"\"\n{text}\n\"\"\"\n\n"
    "Classify the emotion a voice actor should perform for this line, then give a short, "
    "concrete speaking direction in English.\n\n"
    "Reply with ONLY a single JSON object, no markdown code fences, no extra commentary, in "
    "exactly this shape:\n"
    '{{"emotion": "neutral|happy|sad|angry|fearful|excited", "intensity": <integer 0-100>, '
    '"instruction": "<one short English sentence of voice-acting direction>"}}\n\n'
    "emotion must be exactly one of: neutral, happy, sad, angry, fearful, excited.\n"
    "intensity is how strongly that emotion should be performed (0 = barely noticeable, "
    "100 = extreme)."
)


def _normalize_emotion(raw: Any) -> str:
    val = str(raw or "neutral").strip().lower()
    if val in EMOTION_IDS:
        return val
    return _EMOTION_SYNONYMS.get(val, "neutral")


def _normalize_intensity(raw: Any) -> int:
    try:
        return max(0, min(100, int(round(float(raw)))))
    except (TypeError, ValueError):
        return 50


def analyze_text_emotion(text: str, api_key: Optional[str] = None, preferred_model: Optional[str] = None) -> Dict[str, Any]:
    """
    Detect the emotion of one line of Khmer dialogue with Gemini.

    Returns {"success", "emotion", "intensity", "instruction", "model"?} — on failure
    "success" is False and "error" holds a Khmer-readable message, while emotion/intensity
    still carry safe neutral defaults so callers can proceed without special-casing errors.
    """
    key = api_key or get_key()
    clean_text = (text or "").strip()

    if not key:
        return {
            "success": False, "error": "មិនទាន់ដាក់ GEMINI_API_KEY ក្នុង .env",
            "emotion": "neutral", "intensity": 50, "instruction": "",
        }
    if not clean_text:
        return {"success": True, "emotion": "neutral", "intensity": 30, "instruction": "Speak plainly, no strong emotion."}

    prompt = _EMOTION_PROMPT.format(text=clean_text[:600])
    last_err = ""

    for model_name in candidate_models(preferred_model, key):
        try:
            resp = requests.post(
                f"{API_ROOT}/models/{model_name}:generateContent",
                headers={"x-goog-api-key": key, "Content-Type": "application/json"},
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.2, "maxOutputTokens": 200},
                },
                timeout=20,
            )
        except Exception as e:
            last_err = f"មិនអាចភ្ជាប់ទៅ Gemini: {e}"
            continue

        if resp.status_code == 429:
            last_err = explain_error(429, resp.text)
            continue
        if resp.status_code != 200:
            last_err = explain_error(resp.status_code, resp.text)
            continue

        try:
            raw = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, ValueError):
            last_err = "Gemini ឆ្លើយតបមិនត្រឹមត្រូវ"
            continue

        match = re.search(r"\{[\s\S]*\}", raw)
        if not match:
            last_err = "Gemini ឆ្លើយតបមិនមែនជា JSON"
            continue
        try:
            data = json.loads(match.group(0))
        except ValueError:
            last_err = "Gemini ឆ្លើយតបមិនមែនជា JSON"
            continue

        return {
            "success": True,
            "emotion": _normalize_emotion(data.get("emotion")),
            "intensity": _normalize_intensity(data.get("intensity")),
            "instruction": str(data.get("instruction") or "").strip()[:200],
            "model": model_name,
        }

    return {
        "success": False, "error": last_err or "Gemini emotion detection failed",
        "emotion": "neutral", "intensity": 50, "instruction": "",
    }
