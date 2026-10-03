"""
Natural-sounding Khmer dialogue: acted lines with breathing and pauses instead of flat "reading".

1. Gemini TTS (when a Gemini key works): the line is performed from a written direction —
   emotion, natural breaths, phrasing — with one consistent Gemini voice per character.
2. Fallback (no key / quota used up / offline): the Microsoft Khmer voice is rebuilt phrase
   by phrase with an intonation contour, short pauses and soft breaths, sized to the time the
   line has in the video so the timeline does not have to squeeze it.
"""

import os
import re
import asyncio
import subprocess
from typing import Dict, List, Optional, Tuple

import edge_tts

from services import audio_processor, gemini_client

# ── Gemini voices ────────────────────────────────────────────────────────────
# One character keeps one voice: voice = pool[(number - 1) % len(pool)], where number is the
# character's position among characters of the same gender (ប្រុស ១ = 1, ស្រី ២ = 2 …),
# the same numbering the Session casting table shows.
MALE_VOICES = ["Charon", "Puck", "Orus", "Iapetus", "Fenrir", "Enceladus", "Umbriel", "Alnilam", "Achird", "Algieba"]
FEMALE_VOICES = ["Kore", "Leda", "Aoede", "Despina", "Zephyr", "Sulafat", "Achernar", "Vindemiatrix", "Callirrhoe", "Erinome"]
OLD_MALE_VOICES = ["Algenib", "Schedar", "Charon"]
OLD_FEMALE_VOICES = ["Gacrux", "Vindemiatrix"]
SAFE_VOICE = {"male": "Charon", "female": "Kore"}

_OLD_ROLES = {"elder", "old_uncle", "governor", "old_woman"}

ROLE_DESCRIPTIONS = {
    "male_lead": "a young adult man, the hero of the story",
    "female_lead": "a young adult woman, the heroine of the story",
    "servant_female": "a young servant girl",
    "fierce_male": "a fierce, intimidating man",
    "fierce_female": "a fierce, sharp-tongued woman",
    "villain_female": "a cold, scheming woman",
    "general": "a battle-hardened army general",
    "villager": "an ordinary villager",
    "governor": "a powerful middle-aged official",
    "old_uncle": "an old man",
    "elder": "a wise old master",
    "old_woman": "an old woman",
    "child": "a child",
    "crowd": "a person in a crowd",
}

EMOTION_DIRECTIONS = {
    "neutral": "calm and conversational, like talking to someone right in front of you",
    "happy": "warm and cheerful, with a smile in the voice",
    "sad": "sad and heavy, slower, the voice slightly breaking, with a soft sigh",
    "angry": "angry and forceful, tense breathing, sharp emphasis on key words",
    "fearful": "scared and shaky, quick nervous breaths",
    "excited": "excited and energetic, a little breathless",
    "heroic": "determined and strong",
    "dramatic": "dramatic and intense",
}
_EMOTION_ALIASES = {"fear": "fearful", "scared": "fearful", "grief": "sad", "cry": "sad", "shout": "angry",
                    "fierce": "angry", "laugh": "happy", "whisper": "neutral", "nervous": "fearful"}
# Inline audio tags (Gemini 3.x TTS) that set the mood without being spoken
EMOTION_TAGS = {"happy": "[happy]", "excited": "[excited]", "sad": "[sighs]", "fearful": "[trembling]", "angry": "[frustration]"}

_gemini_sem: Optional[asyncio.Semaphore] = None


def _norm_emotion(emotion: Optional[str]) -> str:
    e = str(emotion or "neutral").strip().lower()
    return _EMOTION_ALIASES.get(e, e if e in EMOTION_DIRECTIONS else "neutral")


def gemini_voice_for(gender: str, number: Optional[int], role: str = "") -> Tuple[str, str]:
    """(voice, safe fallback voice) for a character."""
    female = gender == "female"
    if role in _OLD_ROLES:
        pool = OLD_FEMALE_VOICES if female else OLD_MALE_VOICES
    elif role == "child":
        pool = ["Leda"] if female else ["Puck"]
    else:
        pool = FEMALE_VOICES if female else MALE_VOICES
    idx = max(0, int(number or 1) - 1) % len(pool)
    return pool[idx], SAFE_VOICE["female" if female else "male"]


def build_direction_prompt(text: str, *, gender: str, role: str, emotion: str, intensity: Optional[int],
                           instruction: str = "", slot: Optional[float] = None, inline_tags: bool = True) -> str:
    emo = _norm_emotion(emotion)
    who = ROLE_DESCRIPTIONS.get(role) or ("a young woman" if gender == "female" else "a young man")
    strength = ""
    if isinstance(intensity, (int, float)):
        strength = " Keep it subtle." if intensity < 35 else (" Play it big and intense." if intensity > 75 else "")
    pace = "natural pace"
    khmer_chars = sum(1 for c in text if "ក" <= c <= "៿")
    if slot and slot > 0.3:
        cps = khmer_chars / slot
        pace = "quick pace — the line must fit in about %.1f seconds" % slot if cps > 13 else (
            "unhurried pace, it may take about %.1f seconds" % slot if cps < 7 else "natural pace, about %.1f seconds" % slot)
    tag = (EMOTION_TAGS.get(emo, "") + " ") if inline_tags and EMOTION_TAGS.get(emo) else ""
    notes = (instruction or "").strip()
    return (
        "# AUDIO PROFILE\n"
        f"A Cambodian voice actor dubbing a Chinese drama into Khmer, playing {who}.\n\n"
        "### DIRECTOR'S NOTES\n"
        f"Emotion: {EMOTION_DIRECTIONS[emo]}.{strength}\n"
        + (f"Direction: {notes}\n" if notes else "")
        + "Performance: act the line as the character living the scene — never sound like reading text. "
        "Breathe naturally: a small audible breath before speaking and at natural phrase breaks, "
        "short pauses at commas, pitch and rhythm that rise and fall like real speech.\n"
        f"Pace: {pace}.\n"
        "Language: Khmer (Cambodia), native Phnom Penh accent.\n\n"
        "#### TRANSCRIPT\n"
        f"{tag}{text}"
    )


def voxcpm_style(emotion: Optional[str], instruction: str = "") -> str:
    """VoxCPM2 'controllable cloning': a style description in parentheses before the text."""
    emo = _norm_emotion(emotion)
    base = EMOTION_DIRECTIONS[emo].split(",")[0]
    extra = f", {instruction.strip().rstrip('.')}" if instruction and len(instruction) < 120 else ""
    return f"(natural acted speech with breathing and pauses, {base}{extra})"


def _run(cmd: List[str]):
    subprocess.run(cmd, capture_output=True, check=True)


def _pcm_to_wav(pcm: bytes, rate: int, out_path: str):
    pcm_path = out_path + ".pcm"
    with open(pcm_path, "wb") as f:
        f.write(pcm)
    try:
        # Trim only real silence (-60 dB) so quiet breaths at the start/end are kept
        _run(["ffmpeg", "-nostdin", "-y", "-f", "s16le", "-ar", str(rate), "-ac", "1", "-i", pcm_path,
              "-af", "silenceremove=start_periods=1:start_threshold=-60dB,areverse,"
                     "silenceremove=start_periods=1:start_threshold=-60dB,areverse",
              "-ar", "44100", "-ac", "2", out_path])
    finally:
        try:
            os.remove(pcm_path)
        except Exception:
            pass


async def gemini_line(text: str, out_path: str, *, gender: str, role: str, emotion: str, intensity: Optional[int],
                      instruction: str, number: Optional[int], slot: Optional[float]) -> str:
    global _gemini_sem
    if _gemini_sem is None:
        _gemini_sem = asyncio.Semaphore(2)
    voice, safe = gemini_voice_for(gender, number, role)
    models = await asyncio.to_thread(gemini_client.tts_models)
    prompt = build_direction_prompt(text, gender=gender, role=role, emotion=emotion, intensity=intensity,
                                    instruction=instruction, slot=slot,
                                    inline_tags=bool(models) and models[0].startswith("gemini-3"))
    async with _gemini_sem:
        res = await asyncio.to_thread(gemini_client.synthesize_speech, prompt, voice, None, safe)
    await asyncio.to_thread(_pcm_to_wav, res["pcm"], res["rate"], out_path)
    return out_path


# ── Expressive fallback with the Microsoft Khmer voice ───────────────────────

_PUNCT = "។៕!?,…！？，"


def split_phrases(text: str, max_phrases: int = 4) -> List[Tuple[str, str]]:
    """[(phrase, boundary)] where boundary is 'space' | 'comma' | 'stop' | 'question' | 'end'."""
    out: List[Tuple[str, str]] = []
    buf = ""
    for tok in re.split(r"(\s+|[" + re.escape(_PUNCT) + r"]+)", text.strip()):
        if not tok:
            continue
        if tok.isspace():
            if buf.strip():
                out.append((buf.strip(), "space"))
            buf = ""
        elif all(c in _PUNCT for c in tok):
            buf += tok
            kind = "question" if ("?" in tok or "？" in tok) else "stop" if any(c in tok for c in "។៕!！") else "comma"
            if buf.strip():
                out.append((buf.strip(), kind))
            buf = ""
        else:
            buf += tok
    if buf.strip():
        out.append((buf.strip(), "end"))
    if not out:
        return [(text.strip(), "end")]

    def size(p: str) -> int:
        return sum(1 for c in p if "ក" <= c <= "៿")

    # Merge fragments too short to say on their own, then cap the number of phrases
    merged: List[Tuple[str, str]] = []
    for phrase, kind in out:
        if merged and (size(phrase) < 6 or size(merged[-1][0]) < 6) and merged[-1][1] in ("space", "comma"):
            merged[-1] = (merged[-1][0] + " " + phrase, kind)
        else:
            merged.append((phrase, kind))
    while len(merged) > max_phrases:
        i = min(range(len(merged) - 1), key=lambda k: size(merged[k][0]) + size(merged[k + 1][0]))
        merged[i:i + 2] = [(merged[i][0] + " " + merged[i + 1][0], merged[i + 1][1])]
    last_phrase, last_kind = merged[-1]
    merged[-1] = (last_phrase, "question" if last_kind == "question" else "end")
    return merged


def _hz(v) -> int:
    try:
        return int(str(v).replace("Hz", "").replace("+", ""))
    except Exception:
        return 0


def _pct(v) -> int:
    try:
        return int(str(v).replace("%", "").replace("+", ""))
    except Exception:
        return 0


_TRIM = ("silenceremove=start_periods=1:start_threshold=-50dB,areverse,"
         "silenceremove=start_periods=1:start_threshold=-50dB,areverse")
_GAP = {"space": 0.12, "comma": 0.2, "stop": 0.3, "question": 0.3}
BREATH_SEC = 0.32


async def expressive_edge_tts(text: str, out_path: str, voice: str, pitch: str = "+0Hz", rate: str = "+0%",
                              emotion: str = "neutral", intensity: Optional[int] = None,
                              slot: Optional[float] = None, breaths: bool = True) -> str:
    phrases = split_phrases(text)
    n = len(phrases)
    base_p, base_r = _hz(pitch), _pct(rate)
    work = out_path + "_parts"
    os.makedirs(work, exist_ok=True)
    try:
        async def synth(i: int, phrase: str, kind: str) -> Tuple[str, float]:
            # Intonation contour: start a little higher, settle lower and slower at the end;
            # questions rise at the end.
            p = base_p + (3 if i == 0 and n > 1 else 0)
            r = base_r
            if i == n - 1:
                p += 6 if kind == "question" else (-4 if n > 1 else 0)
                r -= 5 if n > 1 else 0
            raw = os.path.join(work, f"p{i}.mp3")
            trimmed = os.path.join(work, f"p{i}.wav")
            await edge_tts.Communicate(phrase, voice, pitch=f"{p:+d}Hz", rate=f"{r:+d}%").save(raw)
            await asyncio.to_thread(_run, ["ffmpeg", "-nostdin", "-y", "-i", raw, "-af", _TRIM,
                                           "-ar", "44100", "-ac", "2", trimmed])
            return trimmed, audio_processor.get_media_duration(trimmed)

        parts = await asyncio.gather(*(synth(i, p, k) for i, (p, k) in enumerate(phrases)))
        speech = sum(d for _, d in parts)

        emo = _norm_emotion(emotion)
        lead_breath = breaths and (emo in ("sad", "fearful", "angry", "excited") or (intensity or 0) >= 60)
        gaps = [_GAP[k] for _, k in phrases[:-1]]
        mid_breaths = [breaths and k in ("stop", "question") for _, k in phrases[:-1]]

        # Fit pauses and breaths into the time this line has in the video
        if slot and slot > 0:
            room = slot + 0.3 - speech

            def planned() -> float:
                return sum(gaps) + BREATH_SEC * (sum(mid_breaths) + (1 if lead_breath else 0))

            if planned() > room:
                lead_breath = False
            while planned() > room and any(mid_breaths):
                last = max(i for i, b in enumerate(mid_breaths) if b)
                mid_breaths[last] = False
            if planned() > room and sum(gaps) > 0:
                scale = max(0.35, room / sum(gaps)) if room > 0 else 0.35
                gaps = [max(0.05, g * scale) for g in gaps]

        # ffmpeg inputs in playback order: (input args, filter for that input)
        filters: List[str] = []
        items: List[Tuple[List[str], str]] = []
        breath_filter = ("bandpass=f=1100:width_type=h:w=1800,highpass=f=250,"
                         f"afade=t=in:d={BREATH_SEC * 0.45:.2f},afade=t=out:st={BREATH_SEC * 0.45:.2f}:d={BREATH_SEC * 0.55:.2f},"
                         "volume=0.28,aformat=sample_rates=44100:channel_layouts=stereo")
        silence = lambda d: (["-f", "lavfi", "-t", f"{d:.3f}", "-i", "anullsrc=r=44100:cl=stereo"], "anull")
        breath = (["-f", "lavfi", "-t", f"{BREATH_SEC:.2f}", "-i", "anoisesrc=color=pink:r=44100:a=0.6"], breath_filter)

        if lead_breath:
            items += [breath, silence(0.06)]
        for i, (path, _) in enumerate(parts):
            items.append((["-i", path], "aformat=sample_rates=44100:channel_layouts=stereo"))
            if i < len(gaps):
                if mid_breaths[i]:
                    items += [silence(max(0.05, gaps[i] * 0.5)), breath, silence(0.05)]
                else:
                    items.append(silence(gaps[i]))

        if len(items) == 1:
            await asyncio.to_thread(_run, ["ffmpeg", "-nostdin", "-y", "-i", parts[0][0], "-ar", "44100", "-ac", "2", out_path])
            return out_path

        args: List[str] = []
        for idx, (a, flt) in enumerate(items):
            args += a
            filters.append(f"[{idx}:a]{flt}[s{idx}]")
        graph = ";".join(filters) + ";" + "".join(f"[s{i}]" for i in range(len(items))) + f"concat=n={len(items)}:v=0:a=1[out]"
        await asyncio.to_thread(_run, ["ffmpeg", "-nostdin", "-y", *args, "-filter_complex", graph,
                                       "-map", "[out]", "-ar", "44100", "-ac", "2", out_path])
        return out_path
    finally:
        import shutil
        shutil.rmtree(work, ignore_errors=True)


async def synthesize_natural(text: str, out_path: str, *, gender: str = "male", role: str = "",
                             emotion: str = "neutral", intensity: Optional[int] = None, instruction: str = "",
                             character_number: Optional[int] = None, slot: Optional[float] = None,
                             edge_voice: str = "km-KH-PisethNeural", edge_pitch: str = "+0Hz",
                             edge_rate: str = "+0%") -> Dict[str, str]:
    """Voice one line naturally. Returns {"path", "engine"}; engine is 'gemini-tts' or 'khmer-expressive'."""
    if gemini_client.tts_available():
        try:
            await gemini_line(text, out_path, gender=gender, role=role, emotion=emotion, intensity=intensity,
                              instruction=instruction, number=character_number, slot=slot)
            if os.path.exists(out_path) and os.path.getsize(out_path) > 2000:
                return {"path": out_path, "engine": "gemini-tts"}
        except gemini_client.GeminiTTSUnavailable as e:
            print(f"Gemini TTS unavailable, using expressive Khmer voice: {e}")
        except Exception as e:
            print(f"Gemini TTS notice, using expressive Khmer voice: {e}")
    try:
        await expressive_edge_tts(text, out_path, edge_voice, edge_pitch, edge_rate, emotion, intensity, slot)
    except Exception as e:
        print(f"Expressive voice notice, using plain voice: {e}")
        tmp = out_path + ".mp3"
        await edge_tts.Communicate(text, edge_voice, pitch=edge_pitch, rate=edge_rate).save(tmp)
        await asyncio.to_thread(_run, ["ffmpeg", "-nostdin", "-y", "-i", tmp, "-ar", "44100", "-ac", "2", out_path])
        try:
            os.remove(tmp)
        except Exception:
            pass
    return {"path": out_path, "engine": "khmer-expressive"}


def character_numbers(segments: List[dict]) -> Dict[str, Tuple[str, int]]:
    """speaker key -> (gender, number) using the same rule as the Session casting table:
    gender = majority of the character's lines, numbered per gender by first appearance."""
    order: List[str] = []
    counts: Dict[str, List[int]] = {}
    for s in segments:
        key = s.get("speaker_id") or s.get("speaker_name") or "speaker_1"
        if key not in counts:
            counts[key] = [0, 0]
            order.append(key)
        counts[key][1 if s.get("gender") == "female" else 0] += 1
    numbers: Dict[str, Tuple[str, int]] = {}
    seen = {"male": 0, "female": 0}
    for key in order:
        g = "female" if counts[key][1] > counts[key][0] else "male"
        seen[g] += 1
        numbers[key] = (g, seen[g])
    return numbers
