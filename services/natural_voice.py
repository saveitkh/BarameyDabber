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
                           instruction: str = "", slot: Optional[float] = None, inline_tags: bool = True,
                           who: Optional[str] = None) -> str:
    emo = _norm_emotion(emotion)
    who = who or ROLE_DESCRIPTIONS.get(role) or ("a young woman" if gender == "female" else "a young man")
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


def _sem() -> asyncio.Semaphore:
    global _gemini_sem
    if _gemini_sem is None:
        _gemini_sem = asyncio.Semaphore(int(os.getenv("AI_VOICE_CONCURRENCY", "2")))
    return _gemini_sem


async def gemini_line(text: str, out_path: str, *, gender: str, role: str, emotion: str, intensity: Optional[int],
                      instruction: str, number: Optional[int], slot: Optional[float],
                      voice: Optional[str] = None, who: Optional[str] = None) -> str:
    picked, safe = gemini_voice_for(gender, number, role)
    voice = voice or picked
    models = await asyncio.to_thread(gemini_client.tts_models)
    prompt = build_direction_prompt(text, gender=gender, role=role, emotion=emotion, intensity=intensity,
                                    instruction=instruction, slot=slot, who=who,
                                    inline_tags=bool(models) and models[0].startswith("gemini-3"))
    async with _sem():
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
                             edge_rate: str = "+0%", voice: Optional[str] = None, who: Optional[str] = None) -> Dict[str, str]:
    """Voice one line naturally. Returns {"path", "engine"}; engine is 'gemini-tts' or 'khmer-expressive'."""
    if gemini_client.tts_available():
        try:
            await gemini_line(text, out_path, gender=gender, role=role, emotion=emotion, intensity=intensity,
                              instruction=instruction, number=character_number, slot=slot, voice=voice, who=who)
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


# ── AI voice cast (no cloning) ───────────────────────────────────────────────
# Every character gets its own AI voice that fits its gender and age, the way a dubbing
# studio casts 4-5 actors: boy/girl, young man/woman, mature man/woman, old man/woman.
# A line is then acted with the emotion and loudness the original actor used.
AI_PREFIX = "ai:"
AI_AUTO = "ai:auto"

AI_POOLS: Dict[Tuple[str, str], List[str]] = {
    ("male", "child"): ["Puck", "Fenrir"],
    ("female", "child"): ["Leda", "Laomedeia"],
    ("male", "young"): ["Puck", "Achird", "Fenrir", "Iapetus", "Sadachbia", "Zubenelgenubi"],
    ("female", "young"): ["Leda", "Zephyr", "Aoede", "Autonoe", "Laomedeia"],
    ("male", "adult"): ["Charon", "Orus", "Alnilam", "Algieba", "Umbriel", "Enceladus"],
    ("female", "adult"): ["Kore", "Despina", "Erinome", "Callirrhoe", "Sulafat", "Pulcherrima"],
    ("male", "old"): ["Algenib", "Schedar", "Rasalgethi", "Sadaltager"],
    ("female", "old"): ["Gacrux", "Vindemiatrix", "Achernar"],
}
AI_VOICE_GENDER = {v: g for (g, _a), pool in AI_POOLS.items() for v in pool}
AGES = ("child", "young", "adult", "old")
_NEAR_AGES = {"child": ["young", "adult", "old"], "young": ["adult", "child", "old"],
              "adult": ["young", "old", "child"], "old": ["adult", "young", "child"]}
AGE_DESCRIPTIONS = {
    ("male", "child"): "a young boy about ten years old", ("female", "child"): "a young girl about ten years old",
    ("male", "young"): "a young man in his twenties", ("female", "young"): "a young woman in her twenties",
    ("male", "adult"): "a mature man in his forties", ("female", "adult"): "a mature woman in her forties",
    ("male", "old"): "an old man in his seventies, slower and a little husky",
    ("female", "old"): "an old woman in her seventies, slower and a little frail",
}
# Roles that say more than the age alone (a fierce general, a scheming lady)
_FLAVOUR_ROLES = {"fierce_male", "fierce_female", "villain_female", "general", "governor", "servant_female", "elder"}
_CHILD_WORDS = ("កុមារ", "ក្មេងប្រុស", "ក្មេងស្រី", "កូនតូច", "ទារក", "ក្មេងតូច")
_YOUNG_WORDS = ("វ័យក្មេង", "យុវ", "ក្រមុំ", "កំលោះ", "នារី")
_OLD_WORDS = ("ចាស់", "យាយ", "លោកតា", "ជីដូន", "ជីតា", "ព្រឹទ្ធ")
_YOUNG_ROLES = {"male_lead", "female_lead", "servant_female"}
_ADULT_ROLES = {"general", "governor", "fierce_male", "fierce_female", "villain_female"}


def is_ai_voice(voice_id: Optional[str]) -> bool:
    return str(voice_id or "").startswith(AI_PREFIX)


def character_age(segs: List[dict]) -> str:
    """child | young | adult | old, from the scan's role, the character's name and its pitch."""
    roles = [s.get("speaker_role") or "" for s in segs]
    role = max(set(roles), key=roles.count) if roles else ""
    name = " ".join({(s.get("speaker_name") or "") for s in segs})
    female = sum(1 for s in segs if s.get("gender") == "female") * 2 > len(segs)
    try:
        f0 = float(next((s.get("voice_f0") for s in segs if s.get("voice_f0")), 0) or 0)
    except (TypeError, ValueError):
        f0 = 0.0
    if role == "child" or any(w in name for w in _CHILD_WORDS):
        return "child"
    if role in ("elder", "old_uncle", "old_woman") or any(w in name for w in _OLD_WORDS):
        return "old"
    if role in _YOUNG_ROLES or any(w in name for w in _YOUNG_WORDS):
        return "young"
    if role in _ADULT_ROLES:
        return "adult"
    if f0:
        if (female and f0 >= 290) or (not female and f0 >= 170):
            return "young"
        if not female and f0 <= 110:
            return "adult"
    return "young"


def _char_key(s: dict) -> str:
    return s.get("speaker_id") or s.get("speaker_name") or "speaker_1"


def cast_ai_voices(segments: List[dict]) -> Dict[str, Dict[str, str]]:
    """{character: {voice, gender, age, who}} — one distinct AI voice per character.
    A voice the user picked (ai:<Voice>) is kept; the main characters choose first."""
    groups: Dict[str, List[dict]] = {}
    for s in segments:
        groups.setdefault(_char_key(s), []).append(s)
    info: Dict[str, Dict] = {}
    for k, segs in groups.items():
        gender = "female" if sum(1 for s in segs if s.get("gender") == "female") * 2 > len(segs) else "male"
        picked = next((str(s.get("voiceId"))[len(AI_PREFIX):] for s in segs
                       if is_ai_voice(s.get("voiceId")) and s.get("voiceId") != AI_AUTO), "")
        roles = [s.get("speaker_role") or "" for s in segs]
        info[k] = {"gender": gender, "age": character_age(segs), "role": max(set(roles), key=roles.count),
                   "voice": picked if picked in AI_VOICE_GENDER else "", "lines": len(segs)}
    used = {i["voice"] for i in info.values() if i["voice"]}
    for k in sorted(info, key=lambda k: -info[k]["lines"]):
        it = info[k]
        if not it["voice"]:
            order = [it["age"]] + _NEAR_AGES[it["age"]]
            cands = [v for a in order for v in AI_POOLS[(it["gender"], a)]]
            free = [v for v in cands if v not in used]
            it["voice"] = free[0] if free else cands[len(used) % len(cands)]
            used.add(it["voice"])
        flavour = ROLE_DESCRIPTIONS.get(it["role"]) if it["role"] in _FLAVOUR_ROLES else None
        it["who"] = f"{AGE_DESCRIPTIONS[(it['gender'], it['age'])]}" + (f" — {flavour}" if flavour else "")
    return {k: {kk: vv for kk, vv in v.items() if kk != "lines"} for k, v in info.items()}


def line_intensities(segments: List[dict], audio_path: str) -> Dict[int, int]:
    """{line index: 10-95}: how loud the original actor said each line compared with how that
    character usually speaks — shouting plays big, whispering plays subtle."""
    try:
        import numpy as np
        from services import voice_check
        x = voice_check.load_audio(audio_path)
        sr = voice_check.SR
    except Exception as e:  # noqa: BLE001 - loudness is a refinement, never a reason to fail
        print(f"Line loudness skipped: {e}")
        return {}
    level: Dict[int, float] = {}
    for i, s in enumerate(segments):
        a, b = int(max(0.0, float(s.get("start_time") or 0)) * sr), int(float(s.get("end_time") or 0) * sr)
        if b - a >= int(sr * 0.3):
            seg = x[a:min(b, len(x))]
            if len(seg):
                level[i] = 20 * float(np.log10(np.sqrt(float((seg ** 2).mean())) + 1e-6))
    by_char: Dict[str, List[float]] = {}
    for i, db in level.items():
        by_char.setdefault(_char_key(segments[i]), []).append(db)
    out: Dict[int, int] = {}
    for i, db in level.items():
        med = float(np.median(by_char[_char_key(segments[i])]))
        out[i] = int(max(10, min(95, 50 + (db - med) * 6)))
    return out


# ── Several lines in one request ─────────────────────────────────────────────
# One TTS request per line hits Gemini's per-minute limit quickly, and every refused line used
# to fall back to the robotic voice in the middle of the video. Lines of one character are
# therefore acted together (a few per request, a long silence between them) and cut apart
# again. The cut is only trusted when the long silences are clearly longer than any pause
# inside a line and every piece's length fits its text; otherwise those lines are voiced one
# by one, and if the model never leaves the silences, batching switches itself off.
BATCH_LINES = int(os.getenv("AI_VOICE_BATCH", "6"))
_batch_off_until = 0.0


def _khmer_len(text: str) -> int:
    return max(1, sum(1 for c in text if "ក" <= c <= "៿"))


def split_on_pauses(pcm: bytes, rate: int, texts: List[str]) -> Optional[List[bytes]]:
    """Cut one recording of len(texts) lines at its len(texts)-1 longest silences, or None."""
    import numpy as np
    n = len(texts)
    if n == 1:
        return [pcm]
    a = np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype=np.int16).astype(np.float32) / 32768.0
    hop = max(1, int(rate * 0.01))
    frames = len(a) // hop
    if frames < 20:
        return None
    rms = np.sqrt((a[: frames * hop].reshape(frames, hop) ** 2).mean(axis=1))
    silent = rms < max(1e-4, float(rms.max()) * 0.03)
    runs, start = [], None
    for f, quiet in enumerate(silent):
        if quiet and start is None:
            start = f
        elif not quiet and start is not None:
            runs.append((start, f))
            start = None
    # pauses between words, not the silence before the first or after the last word
    first_voice = int(np.argmax(~silent)) if (~silent).any() else 0
    last_voice = frames - int(np.argmax((~silent)[::-1]))
    runs = [r for r in runs if r[0] > first_voice and r[1] < last_voice]
    if len(runs) < n - 1:
        return None
    runs.sort(key=lambda r: r[1] - r[0], reverse=True)
    cuts, others = runs[: n - 1], runs[n - 1:]
    shortest_cut = min(r[1] - r[0] for r in cuts) * 0.01
    longest_other = max((r[1] - r[0] for r in others), default=0) * 0.01
    if shortest_cut < 0.7 or (longest_other and shortest_cut < 1.3 * longest_other):
        return None
    bounds = [0] + [((r[0] + r[1]) // 2) * hop * 2 for r in sorted(cuts)] + [len(pcm)]
    pieces = [pcm[bounds[i]:bounds[i + 1]] for i in range(n)]
    durs = [len(p) / 2 / rate for p in pieces]
    rates = [_khmer_len(t) / max(0.1, d) for t, d in zip(texts, durs)]
    med = float(np.median(rates))
    if any(d < 0.3 for d in durs) or any(r < 0.45 * med or r > 2.2 * med for r in rates):
        return None
    return pieces


def build_batch_prompt(lines: List[dict], who: str, inline_tags: bool) -> str:
    moods = []
    script = []
    for n, ln in enumerate(lines, 1):
        emo = _norm_emotion(ln.get("emotion"))
        inten = ln.get("intensity")
        size = ""
        if isinstance(inten, (int, float)):
            size = ", subtle" if inten < 35 else (", big and intense" if inten > 75 else "")
        moods.append(f"{n}. {EMOTION_DIRECTIONS[emo]}{size}")
        tag = (EMOTION_TAGS.get(emo, "") + " ") if inline_tags and EMOTION_TAGS.get(emo) else ""
        script.append(f"{tag}{ln['text']}")
    return (
        "# AUDIO PROFILE\n"
        f"A Cambodian voice actor dubbing a Chinese drama into Khmer, playing {who}.\n\n"
        "### DIRECTOR'S NOTES\n"
        "Act every line below as its own moment of the scene, with the mood written for it — never like "
        "reading text. Breathe naturally, with pitch and rhythm like real speech.\n"
        "IMPORTANT: after EVERY line stay completely silent for two full seconds before the next line. "
        "Never read the numbers or these notes aloud.\n"
        "Language: Khmer (Cambodia), native Phnom Penh accent.\n"
        "Mood of each line, in order:\n" + "\n".join(moods) + "\n\n"
        "#### TRANSCRIPT\n" + "\n\n".join(script)
    )


async def gemini_batch(lines: List[dict], out_paths: List[str], *, voice: str, gender: str, who: str) -> bool:
    """Act several lines of one character in one request. True when every out_path was written."""
    global _batch_off_until
    import time as _time
    models = await asyncio.to_thread(gemini_client.tts_models)
    prompt = build_batch_prompt(lines, who, inline_tags=bool(models) and models[0].startswith("gemini-3"))
    async with _sem():
        res = await asyncio.to_thread(gemini_client.synthesize_speech, prompt, voice, None, SAFE_VOICE[gender])
    pieces = await asyncio.to_thread(split_on_pauses, res["pcm"], res["rate"], [ln["text"] for ln in lines])
    if not pieces:
        _batch_off_until = _time.time() + 3600
        print(f"🎙️ AI batch of {len(lines)} lines could not be cut cleanly — voicing them one by one")
        return False
    for piece, path in zip(pieces, out_paths):
        await asyncio.to_thread(_pcm_to_wav, piece, res["rate"], path)
    print(f"🎙️ AI batch ok: {len(lines)} lines in one request ({voice})")
    return True


def batching_on() -> bool:
    import time as _time
    return BATCH_LINES > 1 and _time.time() >= _batch_off_until
