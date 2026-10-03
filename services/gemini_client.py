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

_models_cache: Dict[str, Any] = {"key": None, "ts": 0.0, "models": [], "tts": []}
last_error: str = ""


def clean_key(raw: Optional[str]) -> str:
    """Keys are often pasted with quotes, spaces or a line break — Google rejects those."""
    return re.sub(r"\s+", "", (raw or "")).strip("'\"")


def get_key() -> str:
    return clean_key(os.getenv("GEMINI_API_KEY"))


# Since 2026-05-28 AI Studio issues "AQ." keys instead of "AIzaSy..." ones. Google's own
# endpoint accepts both through the x-goog-api-key header (or ?key=); sending an AQ. key as
# "Authorization: Bearer" makes Google expect an OAuth token -> ACCESS_TOKEN_TYPE_UNSUPPORTED.
# So x-goog-api-key is always tried first; Bearer is only a fallback, and whichever works
# is remembered per key.
_AUTH_STYLES = ("x-goog-api-key", "bearer")
_auth_style_by_key: Dict[str, str] = {}


def _headers_for(key: str, style: str) -> Dict[str, str]:
    if style == "bearer":
        return {"Authorization": f"Bearer {key}"}
    return {"x-goog-api-key": key}


def auth_headers(key: str) -> Dict[str, str]:
    return _headers_for(key, _auth_style_by_key.get(key, _AUTH_STYLES[0]))


def _is_auth_style_rejection(resp: requests.Response) -> bool:
    text = (resp.text or "").lower()
    return resp.status_code in (400, 401, 403) and (
        "access_token_type_unsupported" in text
        or "unauthenticated" in text
        or "api key not valid" in text
        or "api_key_invalid" in text
    )


def request(method: str, url: str, key: str, headers: Optional[Dict[str, str]] = None, **kwargs) -> requests.Response:
    """HTTP call to the Gemini API that works for both AIza... and AQ. keys."""
    known = _auth_style_by_key.get(key)
    styles = [known] if known else list(_AUTH_STYLES)
    resp = None
    for style in styles:
        resp = requests.request(method, url, headers={**(headers or {}), **_headers_for(key, style)}, **kwargs)
        if resp.status_code < 400 or not _is_auth_style_rejection(resp):
            if resp.status_code < 400:
                _auth_style_by_key[key] = style
            return resp
    return resp


def explain_error(status: int, body: str) -> str:
    text = body or ""
    if status == 400 and ("API_KEY_INVALID" in text or "API key not valid" in text):
        return "Gemini API Key មិនត្រឹមត្រូវ — សូម Copy Key ថ្មីពី aistudio.google.com/apikey"
    if "api_key_service_blocked" in text.lower() or "service_disabled" in text.lower() or "has not been used in project" in text.lower():
        return (
            "Key ត្រឹមត្រូវ ប៉ុន្តែ Google មិនអនុញ្ញាតឲ្យ Key នេះប្រើ Gemini (Generative Language API)។ "
            "ដំណោះស្រាយ៖ (១) ចូល console.cloud.google.com → APIs & Services → Credentials → ចុចលើ Key → "
            "API restrictions → ជ្រើស 'Don't restrict key' ឬបន្ថែម 'Generative Language API' → Save; "
            "(២) ឬ APIs & Services → Library → 'Generative Language API' → Enable; "
            "(៣) ងាយបំផុត៖ aistudio.google.com/apikey → Create API key → 'Create API key in new project' រួចដាក់ Key ថ្មី"
        )
    if "access_token_type_unsupported" in text.lower():
        return (
            "Google បដិសេធ Key ប្រភេទ AQ. នេះ (401 ACCESS_TOKEN_TYPE_UNSUPPORTED) — នេះជាបញ្ហាខាង Google ដែលកើតលើ Project ខ្លះ។ "
            "ដំណោះស្រាយ៖ aistudio.google.com/apikey → Create API key → 'Create API key in new project' រួចដាក់ Key ថ្មីនោះ"
        )
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
    key = clean_key(api_key) or get_key()
    if not key:
        return []
    if not force and _models_cache["key"] == key and (time.time() - _models_cache["ts"]) < 1800:
        return list(_models_cache["models"])
    try:
        resp = request("GET", f"{API_ROOT}/models", key, params={"pageSize": 200}, timeout=15)
    except Exception as e:
        last_error = f"មិនអាចភ្ជាប់ទៅ Gemini: {e}"
        return []
    if resp.status_code != 200:
        last_error = explain_error(resp.status_code, resp.text)
        return []
    names, tts = [], []
    for m in resp.json().get("models", []):
        if "generateContent" not in (m.get("supportedGenerationMethods") or []):
            continue
        short = (m.get("name") or "").replace("models/", "")
        if not short.startswith("gemini"):
            continue
        if "tts" in short:
            tts.append(short)
        elif not any(x in short for x in _EXCLUDE):
            names.append(short)
    names.sort(key=_model_rank)
    tts.sort(key=_model_rank)
    _models_cache.update({"key": key, "ts": time.time(), "models": names, "tts": tts})
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
    key = clean_key(api_key) or get_key()
    if not key:
        return {"configured": False, "ok": False, "message": "មិនទាន់ដាក់ GEMINI_API_KEY ក្នុង .env / Settings", "models": []}
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
            resp = request(
                "POST",
                f"{API_ROOT}/models/{model_name}:generateContent",
                key,
                headers={"Content-Type": "application/json"},
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


# ── Speech (Gemini TTS) ──────────────────────────────────────────────────────
# Gemini's TTS models act a line from a written direction (emotion, breathing, pauses),
# which sounds far less like "reading text" than classic TTS. Khmer is supported by the
# current Flash TTS models. Output is raw 16-bit mono PCM (24 kHz).

# Used only when ListModels is unavailable; real names are discovered per key.
_TTS_FALLBACK_MODELS = ["gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"]

# After a quota/rate error, stop calling TTS for a while and let callers fall back.
_tts_paused_until = 0.0


class GeminiTTSUnavailable(Exception):
    pass


def tts_models(api_key: Optional[str] = None) -> List[str]:
    key = clean_key(api_key) or get_key()
    list_models(key)
    found = list(_models_cache.get("tts") or []) if _models_cache.get("key") == key else []
    # "pro" TTS is slower/costlier and "lite" is flatter — prefer plain Flash TTS
    found.sort(key=lambda n: (1 if "pro" in n else 0, 1 if "lite" in n else 0, _model_rank(n)))
    return found or list(_TTS_FALLBACK_MODELS)


def tts_available(api_key: Optional[str] = None) -> bool:
    return bool(clean_key(api_key) or get_key()) and time.time() >= _tts_paused_until


def synthesize_speech(prompt: str, voice_name: str, api_key: Optional[str] = None,
                      fallback_voice: Optional[str] = None) -> Dict[str, Any]:
    """Return {"pcm": bytes, "rate": int, "model": str}. Raises GeminiTTSUnavailable."""
    global _tts_paused_until, last_error
    key = clean_key(api_key) or get_key()
    if not key:
        raise GeminiTTSUnavailable("no Gemini key")
    if time.time() < _tts_paused_until:
        raise GeminiTTSUnavailable("Gemini TTS paused after a quota error")

    import base64 as _b64
    err = ""
    for model in tts_models(key)[:3]:
        for voice in [voice_name] + ([fallback_voice] if fallback_voice and fallback_voice != voice_name else []):
            body = {
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {
                    "responseModalities": ["AUDIO"],
                    "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
                },
            }
            try:
                resp = request("POST", f"{API_ROOT}/models/{model}:generateContent", key,
                               headers={"Content-Type": "application/json"}, json=body, timeout=90)
            except Exception as e:
                err = f"Gemini TTS: {e}"
                continue
            if resp.status_code == 429:
                _tts_paused_until = time.time() + 600
                last_error = explain_error(429, resp.text)
                raise GeminiTTSUnavailable(last_error)
            if resp.status_code == 400 and "voice" in resp.text.lower():
                err = f"voice {voice} rejected"
                continue  # try the fallback voice
            if resp.status_code != 200:
                err = explain_error(resp.status_code, resp.text)
                break  # try the next model
            try:
                part = resp.json()["candidates"][0]["content"]["parts"][0]["inlineData"]
                pcm = _b64.b64decode(part["data"])
            except (KeyError, IndexError, ValueError, TypeError):
                err = "Gemini TTS returned no audio"
                break
            m = re.search(r"rate=(\d+)", part.get("mimeType", ""))
            if len(pcm) < 2000:
                err = "Gemini TTS returned empty audio"
                break
            return {"pcm": pcm, "rate": int(m.group(1)) if m else 24000, "model": model}
    raise GeminiTTSUnavailable(err or "Gemini TTS failed")
