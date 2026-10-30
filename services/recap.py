"""AI movie recap: one narrator tells the story of the video in Khmer, over the best moments.

1. write_script(): Gemini reads the scanned Khmer dialogue (with times and character names) and
   writes a short recap as scenes — {start, end, text, mood} — opening with a hook and ending
   on a cliffhanger. The member can edit every scene's words and mood before it is voiced.
2. render(): every scene's narration is voiced by ONE narrator voice acting the scene's mood,
   the matching moment of the video is cut to the narration's length with the original sound
   kept quietly underneath, and the clips are joined into one video.
"""

import asyncio
import json
import os
import re
import subprocess
from typing import Callable, Dict, List, Optional

from services import audio_processor, gemini_client, natural_voice, voice_catalog

# The narrator is any channel voice (services/voice_catalog.py): one of the 30 Gemini voices or a
# voice the member made from a sample file.
DEFAULT_NARRATOR = voice_catalog.DEFAULT
MOODS = list(natural_voice.EMOTION_DIRECTIONS.keys())
PREVIEW_TEXT = "នៅយប់នោះ គ្មាននរណាម្នាក់ដឹងទេ ថាអាថ៌កំបាំងដ៏ធំមួយ កំពុងរង់ចាំពួកគេ…"

MIN_CLIP = 2.5      # seconds of picture per scene at least
BED_GAIN = 0.14     # original sound under the narration
_KHMER = re.compile(r"[ក-៿]")


def narrator(nid: Optional[str]) -> Dict:
    return voice_catalog.resolve(nid)


def _fmt(t: float) -> str:
    return f"{int(t // 60)}:{t % 60:04.1f}"


def _dialogue_text(segments: List[dict], limit_chars: int = 60000) -> str:
    rows = []
    for s in segments or []:
        text = str(s.get("khmer_translation") or s.get("text") or "").strip()
        if not text:
            continue
        who = str(s.get("character_name") or s.get("speaker_name") or s.get("speaker_id") or "").strip()
        rows.append(f"[{_fmt(float(s.get('start_time') or 0))}-{_fmt(float(s.get('end_time') or 0))}] {who}: {text}")
    out = "\n".join(rows)
    return out[:limit_chars]


def _all_dialogue(parts: List[dict], limit_chars: int = 60000) -> str:
    """One video: its dialogue. Several episodes: each under its own header, sharing the budget."""
    if len(parts) == 1:
        return _dialogue_text(parts[0]["segments"], limit_chars)
    share = max(2000, limit_chars // len(parts))
    blocks = []
    for n, part in enumerate(parts, 1):
        text = _dialogue_text(part["segments"], share)
        if text:
            blocks.append(f"=== PART {n}: {part['name']} (length {_fmt(part['duration'])}) ===\n{text}")
    return "\n\n".join(blocks)


def _prompt(dialogue: str, parts: List[dict], target_sec: float) -> str:
    scenes = max(4, min(40, int(target_sec / 9)))
    total = sum(p["duration"] for p in parts)
    if len(parts) == 1:
        what = "one video"
        where = ("- Each scene points at the moment of the video it talks about: part is 1, start and end in SECONDS "
                 "from the start of the video (numbers like 73.5), inside the video, in increasing order, not overlapping. ")
    else:
        what = f"a series of {len(parts)} episodes (PART 1 to PART {len(parts)}, in story order)"
        where = ("- Tell the WHOLE series as one story, from the first part to the last, covering every part. "
                 "Each scene points at the moment it talks about: part is the PART number, start and end in SECONDS "
                 "from the start of THAT part (numbers like 73.5), inside that part, scenes in story order, not overlapping. ")
    return (
        "You write scripts for a popular Cambodian YouTube/TikTok channel that retells Chinese dramas and movies "
        f"in Khmer (រឿងសង្ខេប / សម្រាយរឿង). Below is the dialogue of {what}, already translated to Khmer, "
        "with times (minutes:seconds) and who speaks.\n\n"
        f"Total length: {_fmt(total)}. Write a recap that takes about {int(target_sec)} seconds to narrate, "
        f"in about {scenes} scenes.\n\n"
        "RULES:\n"
        "- One narrator tells the story to the viewer in the third person, in natural spoken Khmer that any "
        "Cambodian understands at once. Short, vivid sentences. Use the characters' names when known.\n"
        "- Write ONLY Khmer script: names transliterated into Khmer, no Chinese, English or Latin letters.\n"
        "- Scene 1 is a HOOK: one gripping sentence that makes the viewer stay.\n"
        "- The last scene ends on a CLIFFHANGER or a strong question that makes the viewer want the next part.\n"
        "- Follow the real story in time order; never invent events that are not in the dialogue.\n"
        + where +
        "Pick the most dramatic moments. A scene's text should take about as long to say as its moment lasts "
        "(about 13 Khmer letters per second).\n"
        f"- mood is how the narrator should sound for that scene, one of: {', '.join(MOODS)}.\n\n"
        "Return ONLY JSON:\n"
        '{"title": "short catchy Khmer title", "scenes": [{"part": 1, "start": 12.0, "end": 20.5, "text": "...", "mood": "dramatic"}]}\n\n'
        "DIALOGUE:\n" + dialogue
    )


def _parse(raw: str) -> dict:
    m = re.search(r"```json\s*([\s\S]*?)\s*```", raw)
    text = m.group(1) if m else raw
    m2 = re.search(r"\{[\s\S]*\}", text)
    if not m2:
        raise ValueError("Gemini ឆ្លើយតបមិនមែនជា JSON")
    return json.loads(m2.group(0))


def clean_scenes(scenes: List[dict], durations: List[float]) -> List[dict]:
    """Keep only usable scenes: a real part, Khmer text, times inside that part, story order, a known mood.
    durations[i] is the length of part i + 1 (a single video has one part)."""
    out: List[dict] = []
    for sc in scenes or []:
        try:
            part = int(sc.get("part") or 1)
            start = float(sc.get("start", 0))
            end = float(sc.get("end", start + 6))
        except (TypeError, ValueError):
            continue
        if not 1 <= part <= len(durations):
            continue
        duration = float(durations[part - 1] or 0)
        text = re.sub(r"\s+", " ", str(sc.get("text") or "")).strip()[:600]
        if not text or not _KHMER.search(text):
            continue
        start = max(0.0, min(start, max(0.0, duration - MIN_CLIP)))
        end = max(start + MIN_CLIP, min(end, duration)) if duration else max(start + MIN_CLIP, end)
        mood = str(sc.get("mood") or "neutral").strip().lower()
        out.append({"part": part, "start": round(start, 2), "end": round(end, 2), "text": text,
                    "mood": mood if mood in MOODS else "neutral"})
    out.sort(key=lambda s: (s["part"], s["start"]))
    return out


def write_script(parts: List[dict], target_sec: float) -> dict:
    """{"title", "scenes"} from Gemini. parts: [{"name", "duration", "segments"}] — one for a single
    video, one per episode/chunk for a series. Raises RuntimeError with a Khmer message on failure."""
    key = gemini_client.get_key()
    if not key:
        raise RuntimeError("Recap ត្រូវការ Gemini API key — សូមដាក់ក្នុង ការកំណត់")
    dialogue = _all_dialogue(parts)
    if not dialogue:
        raise RuntimeError("មិនមានឃ្លាសម្រាប់សរសេរ Recap — សូមស្កេនវីដេអូសិន")
    prompt = _prompt(dialogue, parts, target_sec)
    last_err = ""
    for model_name in gemini_client.candidate_models(None, key):
        try:
            resp = gemini_client.request(
                "POST", f"{gemini_client.API_ROOT}/models/{model_name}:generateContent", key,
                headers={"Content-Type": "application/json"},
                json={"contents": [{"parts": [{"text": prompt}]}],
                      "generationConfig": {"temperature": 0.7, "maxOutputTokens": 8192,
                                           "responseMimeType": "application/json"}},
                timeout=120,
            )
        except Exception as e:
            last_err = f"មិនអាចភ្ជាប់ទៅ Gemini: {e}"
            continue
        if resp.status_code != 200:
            last_err = gemini_client.explain_error(resp.status_code, resp.text)
            continue
        try:
            raw = "".join(p.get("text", "") for p in resp.json()["candidates"][0]["content"]["parts"])
            data = _parse(raw)
        except Exception:
            last_err = "Gemini ឆ្លើយតបមិនត្រឹមត្រូវ — សូមសាកម្ដងទៀត"
            continue
        scenes = clean_scenes(data.get("scenes") or [], [p["duration"] for p in parts])
        if len(scenes) < 2:
            last_err = "Gemini សរសេរ Recap មិនបានគ្រប់ — សូមសាកម្ដងទៀត"
            continue
        title = re.sub(r"[\\/:*?\"<>|\n]", " ", str(data.get("title") or "")).strip()[:80]
        return {"title": title, "scenes": scenes, "model": model_name}
    raise RuntimeError(last_err or "សរសេរ Recap មិនបាន")


async def voice_scene(text: str, mood: str, out_path: str, nid: str) -> str:
    """One narration line in the narrator's voice, acting the mood. Returns the engine used."""
    n = narrator(nid)
    res = await natural_voice.synthesize_natural(
        text, out_path, gender=n["gender"], role="", emotion=mood, intensity=None,
        instruction="You are the narrator of a Khmer movie-recap channel telling the story to the viewer — "
                    "gripping storyteller, not a character in the scene."
                    + (f" Your voice: {n['style']}" if n.get("style") else ""),
        voice=n["id"], who=n["who"], edge_voice=n["edge"])
    if n.get("pitch"):
        await asyncio.to_thread(voice_catalog.shift_pitch_file, out_path, n["pitch"])
    return res["engine"]


def _cut_clip(video: str, start: float, length: float, voice: Optional[str], out: str,
              has_audio: bool, logo_filter: str, size: tuple) -> None:
    w, h = size
    vf = ",".join(f for f in (logo_filter, f"scale={w}:{h}:force_original_aspect_ratio=decrease",
                               f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2", "fps=30", "format=yuv420p") if f)
    cmd = ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", video]
    if voice:
        cmd += ["-i", voice]
    if not has_audio:
        cmd += ["-f", "lavfi", "-t", f"{length:.3f}", "-i", "anullsrc=r=44100:cl=stereo"]
    bed = "0:a" if has_audio else f"{2 if voice else 1}:a"
    af = f"[{bed}]aresample=44100,aformat=channel_layouts=stereo,volume={BED_GAIN}[bed]"
    if voice:
        af += (";[1:a]aresample=44100,aformat=channel_layouts=stereo,adelay=150|150[nar];"
               "[bed][nar]amix=inputs=2:duration=first:normalize=0,apad[a]")
    else:
        af += ";[bed]apad[a]"
    cmd += ["-filter_complex", f"[0:v]{vf}[v];{af}", "-map", "[v]", "-map", "[a]", "-t", f"{length:.3f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", out]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(out):
        raise RuntimeError(f"ffmpeg clip failed: {r.stderr[-300:]}")


def _video_size(path: str) -> tuple:
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                        "-of", "csv=p=0:s=x", path], capture_output=True, text=True)
    try:
        w, h = (int(v) for v in r.stdout.strip().split("\n")[0].split("x")[:2])
        return (w // 2 * 2, h // 2 * 2)
    except Exception:
        return (1280, 720)


async def render(videos: List[str], scenes: List[dict], nid: str, out_path: str, work_dir: str,
                 logo_filters: Optional[List[str]] = None,
                 on_progress: Optional[Callable[[str, int, int], None]] = None) -> dict:
    """Voice every scene and join the matching moments into one recap video at out_path.
    videos[i] is part i + 1 (one video, or every episode of a series); logo_filters lines up with it."""
    durations = [audio_processor.get_media_duration(v) for v in videos]
    scenes = clean_scenes(scenes, durations)
    if not scenes:
        raise RuntimeError("គ្មានឈុតសម្រាប់ Recap")
    tag = os.path.splitext(os.path.basename(out_path))[0]
    voices = [os.path.join(work_dir, f"{tag}_n{i}.wav") for i in range(len(scenes))]
    done = {"n": 0}
    total = len(scenes)

    async def one(i: int) -> str:
        engine = await voice_scene(scenes[i]["text"], scenes[i]["mood"], voices[i], nid)
        done["n"] += 1
        if on_progress:
            on_progress("voices", done["n"], total)
        return engine

    engines = await asyncio.gather(*(one(i) for i in range(total)))
    if on_progress:
        on_progress("video", total, total)

    has_audio = [audio_processor.has_audio_stream(v) for v in videos]
    size = _video_size(videos[scenes[0]["part"] - 1])
    clips: List[str] = []
    try:
        for i, sc in enumerate(scenes):
            nar_len = audio_processor.get_media_duration(voices[i]) if os.path.exists(voices[i]) else 0.0
            length = max(MIN_CLIP, nar_len + 0.45)
            k = sc["part"] - 1
            video, duration = videos[k], durations[k]
            start = sc["start"]
            if duration and start + length > duration:
                start = max(0.0, duration - length)
                length = min(length, duration - start)
            clip = os.path.join(work_dir, f"{tag}_c{i}.mp4")
            await asyncio.to_thread(_cut_clip, video, start, length, voices[i] if nar_len > 0 else None, clip,
                                    has_audio[k], (logo_filters or [""] * len(videos))[k], size)
            clips.append(clip)
        listing = os.path.join(work_dir, f"{tag}_list.txt")
        with open(listing, "w", encoding="utf-8") as f:
            f.writelines(f"file '{os.path.abspath(c)}'\n" for c in clips)
        r = await asyncio.to_thread(subprocess.run, ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-f", "concat",
                                                     "-safe", "0", "-i", listing, "-c", "copy", "-movflags", "+faststart", out_path],
                                    capture_output=True, text=True)
        os.remove(listing)
        if r.returncode != 0 or not os.path.exists(out_path):
            raise RuntimeError(f"ភ្ជាប់ Recap មិនបាន: {r.stderr[-200:]}")
    finally:
        for p in clips + voices:
            try:
                os.remove(p)
            except OSError:
                pass
    return {"scenes": total, "engine": "gemini-tts" if "gemini-tts" in engines else "khmer-expressive",
            "duration": audio_processor.get_media_duration(out_path)}
