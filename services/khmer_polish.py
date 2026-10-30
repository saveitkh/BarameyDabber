"""Second translation pass: every line fully in Khmer, names the same everywhere.

The first pass (khmer_dubber.transcribe_chunk_with_gemini) listens to ~90 s of audio at a time and
translates on the fly, so it can leave Chinese/English words in a line, drop words, or spell one
name three ways. This pass reads the WHOLE dialogue as text (Chinese original + draft Khmer + who
speaks), with the lines before it as context and a name glossary, and rewrites each line:

- the full meaning of the Chinese line, no word left out, nothing added;
- only Khmer script (names transliterated, numbers in Khmer), checked line by line afterwards;
- one Khmer spelling per name, kept in a glossary that a long movie / series shares across parts;
- natural spoken Khmer that fits the time the line has on screen.

A line the pass cannot fix keeps its draft (with foreign letters removed), so nothing is lost.
"""

import json
import os
import re
from typing import Dict, List, Optional

from services import gemini_client

BATCH = int(os.getenv("TRANSLATE_POLISH_BATCH", "60"))
CONTEXT = 6          # earlier lines shown (read-only) so a batch continues the scene
CPS = 13.0           # Khmer letters spoken per second
_KHMER = re.compile(r"[ក-៿]")
_FOREIGN = re.compile(r"[一-鿿㐀-䶿぀-ヿ가-힯฀-๿A-Za-z]")


def enabled() -> bool:
    return os.getenv("TRANSLATE_POLISH", "1") != "0" and bool(gemini_client.get_key())


def is_clean(text: str) -> bool:
    return bool(text) and bool(_KHMER.search(text)) and not _FOREIGN.search(text)


def _who(s: dict) -> str:
    name = str(s.get("character_name") or s.get("speaker_name") or s.get("speaker_id") or "").strip()
    return f"{name} ({'female' if s.get('gender') == 'female' else 'male'})"


def _row(n: int, s: dict) -> str:
    slot = max(0.5, float(s.get("end_time") or 0) - float(s.get("start_time") or 0))
    return json.dumps({"id": n, "who": _who(s), "seconds": round(slot, 1),
                       "chinese": str(s.get("chinese_text") or "").strip(),
                       "draft": str(s.get("khmer_translation") or "").strip()}, ensure_ascii=False)


def _prompt(rows: List[str], context: List[str], glossary: Dict[str, str]) -> str:
    gl = "\n".join(f"{k} = {v}" for k, v in list(glossary.items())[:200]) or "(empty)"
    return (
        "You are the head translator of a Cambodian studio that dubs Chinese dramas into Khmer. "
        "Each line below has the original Chinese, who says it, how many seconds it lasts on screen, "
        "and a rough Khmer draft. Rewrite the Khmer of EVERY line.\n\n"
        "RULES:\n"
        "1. Translate the FULL meaning of the Chinese line — no word or idea left out, nothing invented. "
        "If the draft misses something, add it; if the draft is wrong, fix it.\n"
        "2. Write ONLY Khmer script. Never leave a Chinese, English, Thai or other Latin-letter word: "
        "transliterate names into Khmer, write numbers in Khmer, translate titles and terms.\n"
        "3. Names: use the GLOSSARY spelling when a name is in it; for a new name pick one Khmer spelling "
        "and add it to the glossary. Never spell one name two ways.\n"
        "4. Natural, everyday spoken Khmer a Cambodian viewer understands at once, with the right "
        "pronouns and politeness for who is talking to whom (បង/អូន, លោក/នាង, ព្រះអង្គ for royalty…). "
        "Keep the emotion of the line.\n"
        f"5. Length: a line should take about as long to say as its seconds (about {int(CPS)} Khmer letters "
        "per second) — shorten wording rather than meaning.\n"
        "6. If the Chinese is empty, keep the draft's meaning in clean Khmer.\n\n"
        f"GLOSSARY (Chinese = Khmer):\n{gl}\n\n"
        + ("EARLIER LINES (context only, do not return them):\n" + "\n".join(context) + "\n\n" if context else "")
        + "LINES:\n" + "\n".join(rows) + "\n\n"
        'Return ONLY JSON: {"lines": [{"id": 1, "khmer": "..."}], "glossary": {"中文名": "ឈ្មោះខ្មែរ"}}'
    )


def _call(prompt: str, key: str) -> Optional[dict]:
    for model_name in gemini_client.candidate_models(None, key):
        try:
            resp = gemini_client.request(
                "POST", f"{gemini_client.API_ROOT}/models/{model_name}:generateContent", key,
                headers={"Content-Type": "application/json"},
                json={"contents": [{"parts": [{"text": prompt}]}],
                      "generationConfig": {"temperature": 0.3, "maxOutputTokens": 16384,
                                           "responseMimeType": "application/json"}},
                timeout=120)
        except Exception as e:
            print(f"Translation pass 2: {model_name} unreachable ({type(e).__name__})")
            continue
        if resp.status_code != 200:
            gemini_client.last_error = gemini_client.explain_error(resp.status_code, resp.text)
            continue
        try:
            raw = "".join(p.get("text", "") for p in resp.json()["candidates"][0]["content"]["parts"])
            m = re.search(r"\{[\s\S]*\}", raw)
            return json.loads(m.group(0)) if m else None
        except Exception:
            continue
    return None


def _strip_foreign(text: str, glossary: Optional[Dict[str, str]] = None) -> str:
    """Known names become their Khmer spelling first; any other foreign letters are dropped."""
    text = text or ""
    for k in sorted(glossary or {}, key=len, reverse=True):
        if k in text:
            text = text.replace(k, f" {glossary[k]} ")
    return re.sub(r"\s+", " ", _FOREIGN.sub("", text)).strip()


def polish(segments: List[dict], glossary: Optional[Dict[str, str]] = None) -> Dict[str, int]:
    """Rewrite segments' khmer_translation in place. glossary (Chinese -> Khmer) is read and
    extended, so the caller can share it across the parts of one movie or series.
    Returns {'fixed', 'kept', 'cleaned'} counts."""
    stats = {"fixed": 0, "kept": 0, "cleaned": 0}
    key = gemini_client.get_key()
    if glossary is None:
        glossary = {}
    if key:
        for b in range(0, len(segments), BATCH):
            batch = segments[b:b + BATCH]
            rows = [_row(n, s) for n, s in enumerate(batch, 1)]
            context = [f"{_who(s)}: {s.get('khmer_translation') or ''}" for s in segments[max(0, b - CONTEXT):b]]
            data = _call(_prompt(rows, context, glossary), key)
            if not data:
                print(f"Translation pass 2: lines {b + 1}-{b + len(batch)} kept as first draft")
                continue
            for k, v in (data.get("glossary") or {}).items():
                k, v = str(k).strip(), _strip_foreign(str(v))
                if k and v and _KHMER.search(v) and k not in glossary:
                    glossary[k] = v[:40]
            for item in data.get("lines") or []:
                try:
                    n = int(item.get("id"))
                except (TypeError, ValueError):
                    continue
                if not 1 <= n <= len(batch):
                    continue
                text = re.sub(r"\s+", " ", str(item.get("khmer") or "")).strip()
                if is_clean(text):
                    seg = batch[n - 1]
                    if text != seg.get("khmer_translation"):
                        seg.setdefault("khmer_draft", seg.get("khmer_translation"))
                        seg["khmer_translation"] = text
                        stats["fixed"] += 1
                    seg.pop("needs_translation", None)
    # Whatever is still not clean Khmer: drop the foreign letters rather than speak them
    for seg in segments:
        text = str(seg.get("khmer_translation") or "")
        if not is_clean(text):
            cleaned = _strip_foreign(text, glossary)
            if _KHMER.search(cleaned):
                seg["khmer_translation"] = cleaned
                stats["cleaned"] += 1
        else:
            stats["kept"] += 1
    print(f"Translation pass 2: {stats['fixed']} lines improved, {stats['cleaned']} cleaned, "
          f"{len(glossary)} names in the glossary")
    return stats
