"""Every voice the channel can speak with: the 30 Gemini voices, and voices made from a file.

A voice "from a file" is not a clone (that needs VoxCPM2 on a GPU). Gemini listens to the
member's sample and describes the speaker; the closest of the 30 Gemini voices becomes the base,
the description becomes part of every acting direction, and a small pitch shift moves it closer.
The result is a voice of the member's own, clearly different from the four defaults.
"""

import base64
import json
import os
import re
import secrets
import subprocess
import tempfile
import threading
import time
from typing import Dict, List, Optional

from services import gemini_client

EDGE = {"male": "km-KH-PisethNeural", "female": "km-KH-SreymomNeural"}

# id, gender, how Google describes it, Khmer label. The first four are the channel defaults.
_VOICES = [
    ("Charon", "male", "informative, deep", "ធ្ងន់ គួរឲ្យទុកចិត្ត"),
    ("Orus", "male", "firm, warm", "កក់ក្ដៅ ស្និទ្ធស្នាល"),
    ("Kore", "female", "firm, clear", "ទន់ភ្លន់ ស្រួលស្ដាប់"),
    ("Despina", "female", "smooth, lively", "រស់រវើក ទាក់ចិត្ត"),
    ("Puck", "male", "upbeat, young", "ក្មេង រីករាយ"),
    ("Fenrir", "male", "excitable, energetic", "រំភើប មានថាមពល"),
    ("Enceladus", "male", "breathy, soft", "ស្រាលៗ ដូចខ្សឹប"),
    ("Iapetus", "male", "clear", "ច្បាស់ ស្អាត"),
    ("Umbriel", "male", "easy-going", "សម្រាក ងាយស្ដាប់"),
    ("Algieba", "male", "smooth", "រលោង"),
    ("Algenib", "male", "gravelly, older", "ស្អក ចាស់ទុំ"),
    ("Rasalgethi", "male", "informative, measured", "ម៉ឺងម៉ាត់ ដូចអ្នកអានព័ត៌មាន"),
    ("Alnilam", "male", "firm, strong", "រឹងមាំ ខ្លាំង"),
    ("Schedar", "male", "even, mature", "ស្មើៗ ពេញវ័យ"),
    ("Achird", "male", "friendly", "រួសរាយ"),
    ("Zubenelgenubi", "male", "casual", "ធម្មតា ដូចមិត្តភក្ដិ"),
    ("Sadachbia", "male", "lively", "សកម្ម រហ័ស"),
    ("Sadaltager", "male", "knowledgeable", "ចេះដឹង ស្ងប់"),
    ("Zephyr", "female", "bright", "ភ្លឺ ស្រស់"),
    ("Leda", "female", "youthful", "ក្មេង ស្រស់ស្រាយ"),
    ("Aoede", "female", "breezy", "ស្រាលដូចខ្យល់"),
    ("Callirrhoe", "female", "easy-going", "សម្រាក ស្រួលស្ដាប់"),
    ("Autonoe", "female", "bright", "ច្បាស់ ភ្លឺ"),
    ("Erinome", "female", "clear", "ច្បាស់ ស្អាត"),
    ("Laomedeia", "female", "upbeat", "រីករាយ"),
    ("Achernar", "female", "soft", "ទន់ ស្រទន់"),
    ("Gacrux", "female", "mature", "ចាស់ទុំ"),
    ("Pulcherrima", "female", "forward, confident", "ក្លាហាន ជឿជាក់"),
    ("Vindemiatrix", "female", "gentle", "ស្លូតបូត"),
    ("Sulafat", "female", "warm", "កក់ក្ដៅ"),
]
FEATURED = 4
CATALOG: List[Dict] = [
    {"id": v, "gender": g, "trait": t, "label": f"{'ប្រុស' if g == 'male' else 'ស្រី'} · {km}",
     "edge": EDGE[g], "who": f"a {t} {'male' if g == 'male' else 'female'} storyteller",
     "featured": i < FEATURED}
    for i, (v, g, t, km) in enumerate(_VOICES)
]
BY_ID = {v["id"]: v for v in CATALOG}
DEFAULT = "Charon"

_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "custom_voices.json")
_lock = threading.Lock()


def _load() -> Dict[str, List[Dict]]:
    try:
        with open(_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save(data: Dict[str, List[Dict]]) -> None:
    os.makedirs(os.path.dirname(_FILE), exist_ok=True)
    tmp = _FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, _FILE)


def custom_voices(owner: str) -> List[Dict]:
    return _load().get(owner, [])


def resolve(vid: Optional[str]) -> Dict:
    """Voice settings for any id: a Gemini voice, or a custom one (cv_...). Unknown -> default.
    Returns {id (Gemini voice), gender, edge, who, style, pitch (semitones), label}."""
    vid = str(vid or "")
    if vid in BY_ID:
        return {**BY_ID[vid], "style": "", "pitch": 0}
    if vid.startswith("cv_"):
        for items in _load().values():
            for c in items:
                if c["id"] == vid:
                    base = BY_ID.get(c["base"], BY_ID[DEFAULT])
                    return {**base, "label": c["name"], "style": c.get("style", ""),
                            "pitch": int(c.get("pitch") or 0), "who": f"a storyteller whose voice is {c.get('style') or base['trait']}"}
    return {**BY_ID[DEFAULT], "style": "", "pitch": 0}


def is_known(vid: Optional[str]) -> bool:
    vid = str(vid or "")
    return vid in BY_ID or (vid.startswith("cv_") and any(c["id"] == vid for items in _load().values() for c in items))


def shift_pitch_file(path: str, semitones: int) -> None:
    """Move a voice up/down a few semitones in place, keeping its speed."""
    if not semitones or not os.path.exists(path):
        return
    ratio = 2 ** (semitones / 12.0)
    tmp = path + ".pitch.wav"
    r = subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", path, "-af", f"rubberband=pitch={ratio:.4f}", tmp])
    if r.returncode != 0:   # an FFmpeg without rubberband: resample, then put the speed back
        r = subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", path, "-af",
                            f"asetrate=44100*{ratio:.4f},aresample=44100,atempo={1 / ratio:.4f}", tmp])
    if r.returncode == 0 and os.path.exists(tmp):
        os.replace(tmp, path)
    elif os.path.exists(tmp):
        os.remove(tmp)


def _analyse(sample_mp3: bytes, key: str) -> Optional[Dict]:
    voices = "\n".join(f"- {v['id']} ({v['gender']}, {v['trait']})" for v in CATALOG)
    prompt = (
        "Listen to this speaker. We will re-create a voice LIKE this one with a text-to-speech model that "
        "has only these preset voices:\n" + voices + "\n\n"
        "1. base: the preset whose gender, age and sound are closest to this speaker.\n"
        "2. style: ONE English sentence a voice director would give the TTS so it sounds like this "
        "speaker — pitch (high/low), texture (husky, breathy, bright, nasal…), age, pace, energy, attitude. "
        "Describe the voice only, not the words.\n"
        "3. pitch: semitones (-3 to 3) to move the preset closer (negative = deeper).\n"
        "4. gender: male or female.\n"
        'Return ONLY JSON: {"base": "Charon", "style": "...", "pitch": 0, "gender": "male"}'
    )
    for model_name in gemini_client.candidate_models(None, key):
        try:
            resp = gemini_client.request(
                "POST", f"{gemini_client.API_ROOT}/models/{model_name}:generateContent", key,
                headers={"Content-Type": "application/json"},
                json={"contents": [{"parts": [{"text": prompt}, {"inlineData": {
                    "mimeType": "audio/mp3", "data": base64.b64encode(sample_mp3).decode()}}]}],
                      "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"}},
                timeout=90)
        except Exception:
            continue
        if resp.status_code != 200:
            gemini_client.last_error = gemini_client.explain_error(resp.status_code, resp.text)
            continue
        try:
            raw = "".join(p.get("text", "") for p in resp.json()["candidates"][0]["content"]["parts"])
            return json.loads(re.search(r"\{[\s\S]*\}", raw).group(0))
        except Exception:
            continue
    return None


def create_from_file(owner: str, name: str, src_path: str) -> Dict:
    """Make a custom voice from an audio/video sample. Raises RuntimeError (Khmer message)."""
    key = gemini_client.get_key()
    if not key:
        raise RuntimeError("ត្រូវការ Gemini API key ដើម្បីស្ដាប់ឯកសារសម្លេង — សូមដាក់ក្នុង ការកំណត់")
    with tempfile.TemporaryDirectory() as tmp:
        mp3 = os.path.join(tmp, "s.mp3")
        r = subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", src_path, "-vn", "-t", "60",
                            "-ac", "1", "-ar", "16000", "-b:a", "48k", mp3])
        if r.returncode != 0 or not os.path.exists(mp3) or os.path.getsize(mp3) < 2000:
            raise RuntimeError("អានឯកសារសម្លេងមិនបាន — សូមប្រើ mp3, wav, m4a ឬវីដេអូ (យ៉ាងតិច ៥ វិនាទី)")
        with open(mp3, "rb") as f:
            data = _analyse(f.read(), key)
    if not data:
        raise RuntimeError(gemini_client.last_error or "Gemini ស្ដាប់ឯកសារមិនបាន — សូមសាកម្ដងទៀត")
    base = str(data.get("base") or "")
    if base not in BY_ID:
        g = "female" if str(data.get("gender")).lower().startswith("f") else "male"
        base = next(v["id"] for v in CATALOG if v["gender"] == g)
    try:
        pitch = max(-3, min(3, int(round(float(data.get("pitch") or 0)))))
    except (TypeError, ValueError):
        pitch = 0
    style = re.sub(r"\s+", " ", str(data.get("style") or BY_ID[base]["trait"])).strip()[:240]
    item = {"id": f"cv_{secrets.token_hex(5)}", "name": (name or "សម្លេងរបស់ខ្ញុំ").strip()[:40],
            "base": base, "gender": BY_ID[base]["gender"], "style": style, "pitch": pitch,
            "createdAt": int(time.time())}
    with _lock:
        all_ = _load()
        all_.setdefault(owner, []).insert(0, item)
        all_[owner] = all_[owner][:20]
        _save(all_)
    return item


def delete(owner: str, vid: str) -> bool:
    with _lock:
        all_ = _load()
        items = all_.get(owner, [])
        keep = [c for c in items if c["id"] != vid]
        if len(keep) == len(items):
            return False
        all_[owner] = keep
        _save(all_)
        return True


def listing(owner: str) -> List[Dict]:
    """Custom voices first, then the four defaults, then the other Gemini voices."""
    mine = [{"id": c["id"], "gender": c["gender"], "label": c["name"], "desc": c.get("style", ""),
             "group": "mine"} for c in custom_voices(owner)]
    return mine + [{"id": v["id"], "gender": v["gender"], "label": v["label"], "desc": v["trait"],
                    "group": "featured" if v["featured"] else "more"} for v in CATALOG]
