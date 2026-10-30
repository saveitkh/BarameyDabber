"""Two things that make a dub sound like people, not a machine reading a script.

1. Vocal moments (is_vocal_moment): a "line" that is only a laugh, a scream, a sob or a gasp
   (啊！ 哈哈哈 呜呜…) has no words to translate. Voicing "អា!" with TTS sounds fake, so such lines
   are not dubbed: the actor's own sound stays in the soundtrack, which works in every language.

2. Listening back (check_takes): after the AI voice speaks the lines, Gemini listens to them
   (several lines in one request, separated by silence) and writes down what it hears. A line
   whose words do not match the script — a skipped or swallowed word, a garbled name — gets a
   second take, and the better of the two is kept. Like a director asking for one more take.
"""

import base64
import difflib
import json
import os
import re
import subprocess
import tempfile
from typing import Dict, List, Optional

from services import gemini_client

BATCH = int(os.getenv("LISTEN_BACK_BATCH", "8"))
PASS_SCORE = float(os.getenv("LISTEN_BACK_PASS", "0.6"))

# Chinese syllables that are pure sound (laughing, crying, surprise, pain, hesitation)
_CN_SOUNDS = set("啊阿呀哈呵嘿嘻呜唔哎唉嗯哦噢喔哇呃咦哼嘘嗷嗨哟咯欸诶嗐吁嚯嘤呕噗咳")
_CN_IGNORE = set(" 　～~…!！?？,，。.、·-—\"'“”‘’")
# Khmer translations of such sounds
_KM_SOUNDS = {"អា", "អាស", "អូ", "អូយ", "អឺ", "អឹម", "អុញ", "អុះ", "អើ", "អេ", "ហា", "ហាហា", "ហាហាហា",
              "ហឹ", "ហឹម", "ហ៊ឺ", "ហឺ", "ហែ", "ហុះ", "យី", "យីយ", "ឱ", "អុក", "ហ៊ឹះ", "ហិហិ", "ហ៊ិហ៊ិ", "អ៊ឹះ"}
_KHMER = re.compile(r"[ក-៿]")


def is_vocal_moment(seg: dict) -> bool:
    """True when the line is only a non-verbal sound (laugh, scream, sob, gasp)."""
    zh = "".join(c for c in str(seg.get("chinese_text") or "") if c not in _CN_IGNORE)
    if zh:
        return len(zh) <= 8 and all(c in _CN_SOUNDS for c in zh)
    km = re.sub(r"[\s​!！?？.,…៕។~\-]+", " ", str(seg.get("khmer_translation") or "")).split()
    return bool(km) and len(km) <= 4 and all(w in _KM_SOUNDS for w in km)


def enabled() -> bool:
    return os.getenv("LISTEN_BACK", "1") != "0" and bool(gemini_client.get_key())


def _letters(text: str) -> str:
    """Khmer letters only — spacing, zero-width spaces and punctuation do not count."""
    return "".join(c for c in str(text or "") if "ក" <= c <= "៝")


def score(expected: str, heard: str) -> float:
    a, b = _letters(expected), _letters(heard)
    if not a:
        return 1.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def _joined_audio(paths: List[str]) -> Optional[bytes]:
    """The takes one after another with 1.2 s of silence between them, as a small mono mp3."""
    with tempfile.TemporaryDirectory() as tmp:
        listing = os.path.join(tmp, "list.txt")
        gap = os.path.join(tmp, "gap.wav")
        subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
                        "-t", "1.2", gap], check=True)
        parts = []
        for i, p in enumerate(paths):
            norm = os.path.join(tmp, f"{i}.wav")
            r = subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", p, "-ar", "16000", "-ac", "1", norm])
            if r.returncode != 0:
                return None
            parts += [norm, gap]
        with open(listing, "w") as f:
            f.writelines(f"file '{x}'\n" for x in parts)
        out = os.path.join(tmp, "all.mp3")
        r = subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listing,
                            "-c:a", "libmp3lame", "-b:a", "48k", out])
        if r.returncode != 0:
            return None
        with open(out, "rb") as f:
            return f.read()


def _transcribe(audio: bytes, n: int, key: str) -> Optional[List[str]]:
    prompt = (f"This audio has exactly {n} short spoken lines in Khmer, one after another, separated by about "
              "one second of silence. Write down EXACTLY what is said in each line, in Khmer script — do not "
              "correct, complete or translate anything; if a word is unclear, write what you actually hear. "
              f'Return ONLY JSON: {{"lines": ["line 1", "line 2", ...]}} with exactly {n} items in order.')
    for model_name in gemini_client.candidate_models(None, key):
        try:
            resp = gemini_client.request(
                "POST", f"{gemini_client.API_ROOT}/models/{model_name}:generateContent", key,
                headers={"Content-Type": "application/json"},
                json={"contents": [{"parts": [{"text": prompt},
                                              {"inlineData": {"mimeType": "audio/mp3",
                                                              "data": base64.b64encode(audio).decode()}}]}],
                      "generationConfig": {"temperature": 0.0, "responseMimeType": "application/json"}},
                timeout=90)
        except Exception:
            continue
        if resp.status_code != 200:
            continue
        try:
            raw = "".join(p.get("text", "") for p in resp.json()["candidates"][0]["content"]["parts"])
            lines = json.loads(re.search(r"\{[\s\S]*\}", raw).group(0)).get("lines")
        except Exception:
            continue
        if isinstance(lines, list) and len(lines) == n:
            return [str(x) for x in lines]
        return None    # wrong count: the lines cannot be matched up — do not guess
    return None


def check_takes(items: List[Dict]) -> Dict[int, float]:
    """items: [{index, path, text}] -> {index: score 0..1} for every line that could be checked."""
    key = gemini_client.get_key()
    scores: Dict[int, float] = {}
    if not key:
        return scores
    for b in range(0, len(items), BATCH):
        group = [it for it in items[b:b + BATCH] if os.path.exists(it["path"])]
        if not group:
            continue
        try:
            audio = _joined_audio([it["path"] for it in group])
        except Exception:
            audio = None
        heard = _transcribe(audio, len(group), key) if audio else None
        if not heard:
            continue
        for it, h in zip(group, heard):
            scores[it["index"]] = round(score(it["text"], h), 3)
    return scores
