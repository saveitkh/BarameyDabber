"""VoxCPM2 Khmer multi-voice API for the VPS (CPU or GPU).

Voice bank layout (VOICE_DIR):
    <gender>-<age>-<n>/<emotion>.wav   e.g. male-adult-1/normal.wav, male-adult-1/comedy.wav
    <gender>-<age>-<n>/<emotion>.txt   optional transcript -> "ultimate" cloning

A story character asked for with a tag (voice=male, character=<project>|<speaker>) is given
one bank voice the first time and keeps it forever (assignments.json), so two characters of
the same tag get different voices and one character never changes voice between lines.
"""

import collections
import inspect
import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

MODEL_ID = os.getenv("VOXCPM_MODEL", "openbmb/VoxCPM2")
DEVICE = os.getenv("VOXCPM_DEVICE", "auto")
API_KEY = os.getenv("VOXCPM_API_KEY", "").strip()
VOICE_DIR = Path(os.getenv("VOICE_DIR", "/data/voices"))
BANK_SEED_DIR = Path(os.getenv("BANK_SEED_DIR", "/app/voice_bank"))
WORK_DIR = Path(os.getenv("WORK_DIR", "/tmp/voxcpm"))
MAX_REF_SECONDS = 15
DEFAULT_SEED = int(os.getenv("VOXCPM_SEED", "1234"))

UPLOAD_DIR = WORK_DIR / "uploads"
OUTPUT_DIR = WORK_DIR / "outputs"
for d in (VOICE_DIR, UPLOAD_DIR, OUTPUT_DIR):
    d.mkdir(parents=True, exist_ok=True)

ASSIGN_PATH = VOICE_DIR / "assignments.json"
EXPOSED = ["X-Mode", "X-Voice", "X-Emotion", "X-Min-Similarity", "X-Warning"]


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    return default if raw is None else raw.strip().lower() in ("1", "true", "yes", "on")


def safe_name(s: str) -> str:
    return re.sub(r"[^a-z0-9_\-]", "_", (s or "").strip().lower()) or "voice"


def seed_voice_bank():
    """First start: copy the bundled bank into the persistent volume."""
    if not BANK_SEED_DIR.is_dir() or any(p.is_dir() for p in VOICE_DIR.iterdir()):
        return
    for d in BANK_SEED_DIR.iterdir():
        if d.is_dir():
            shutil.copytree(d, VOICE_DIR / d.name, dirs_exist_ok=True)
    print(f"📦 Voice bank seeded from {BANK_SEED_DIR}")


def process_reference(src: str, voice: str, emotion: str = "normal", text: str = "") -> Path:
    """Mono 48 kHz, leading silence trimmed, loudness evened out."""
    voice, emotion = safe_name(voice), safe_name(emotion)
    dst_dir = VOICE_DIR / voice
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst = dst_dir / f"{emotion}.wav"
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", "48000",
           "-af", "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1,loudnorm=I=-20:TP=-2:LRA=11"]
    if not text:
        cmd += ["-t", str(MAX_REF_SECONDS)]  # with a transcript the clip must stay whole
    cmd.append(str(dst))
    subprocess.run(cmd, check=True, timeout=180)
    txt = dst.with_suffix(".txt")
    if text.strip():
        txt.write_text(text.strip(), encoding="utf-8")
    elif txt.exists():
        txt.unlink()
    return dst


# ---------------------------------------------------------------- voice bank
VOICES: dict = {}
ASSIGN: dict = {}
BANK_LOCK = threading.Lock()


def scan_voices():
    with BANK_LOCK:
        VOICES.clear()
        for vd in sorted(VOICE_DIR.iterdir()):
            if not vd.is_dir():
                continue
            for wav in sorted(vd.glob("*.wav")):
                txt = wav.with_suffix(".txt")
                VOICES.setdefault(vd.name, {})[wav.stem] = {
                    "wav": str(wav),
                    "text": txt.read_text(encoding="utf-8").strip() if txt.exists() else "",
                }


def load_assignments():
    ASSIGN.clear()
    if ASSIGN_PATH.exists():
        try:
            ASSIGN.update(json.loads(ASSIGN_PATH.read_text(encoding="utf-8")))
        except Exception:
            pass


def pick_ref(voice: str, emotion: str = "", character: str = ""):
    """voice is a full name (male-adult-1) or a tag (male-adult, male, female)."""
    q = voice.strip().lower()
    with BANK_LOCK:
        cands = [q] if q in VOICES else sorted(v for v in VOICES if v.startswith(q))
        if not cands:
            raise KeyError(f"មិនមានសំឡេង/tag '{voice}' — មាន: {list(VOICES)}")
        chosen = cands[0]
        ch = character.strip().lower()
        if ch and len(cands) > 1:
            key = f"{q}|{ch}"
            if ASSIGN.get(key) in cands:
                chosen = ASSIGN[key]
            else:
                used = collections.Counter(ASSIGN.values())
                chosen = min(cands, key=lambda v: (used[v], cands.index(v)))
                ASSIGN[key] = chosen
                ASSIGN_PATH.write_text(json.dumps(ASSIGN, ensure_ascii=False, indent=1), encoding="utf-8")
        v = VOICES[chosen]
        e = emotion.strip().lower()
        if e not in v:
            e = "normal" if "normal" in v else next(iter(v))
        return v[e]["wav"], v[e]["text"], e, chosen


def khmer_ratio(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    return (sum(1 for c in letters if "ក" <= c <= "៿") / len(letters)) if letters else 1.0


def split_text(text: str, max_chars: int = 90):
    parts = [p.strip() for p in re.split(r"(?<=[។៕!?.\n])", text) if p.strip()]
    out, cur = [], ""
    for p in parts:
        if cur and len(cur) + len(p) > max_chars:
            out.append(cur)
            cur = p
        else:
            cur = (cur + " " + p).strip()
    if cur:
        out.append(cur)
    return out or [text.strip()]


# ---------------------------------------------------------------- model
STATE = {"status": "loading", "error": "", "device": "", "sample_rate": 48000}
MODEL = {"m": None, "accept": None}
ENCODER = {"e": None}
GEN_LOCK = threading.Lock()
REF_EMB: dict = {}
LAST_REPORT = {"min": None}


def load_model():
    try:
        import torch
        import voxcpm

        torch.set_num_threads(max(1, os.cpu_count() or 1))
        device = DEVICE if DEVICE != "auto" else ("cuda" if torch.cuda.is_available() else "cpu")
        on_gpu = device.startswith("cuda")
        print(f"⏳ Loading {MODEL_ID} on {device} ...")
        m = voxcpm.VoxCPM.from_pretrained(
            MODEL_ID,
            device=device,
            # torch.compile and the denoiser cost minutes + GBs of RAM on a CPU box
            optimize=_env_flag("VOXCPM_OPTIMIZE", on_gpu),
            load_denoiser=_env_flag("VOXCPM_DENOISER", on_gpu),
        )
        target = getattr(m, "_generate", m.generate)
        params = inspect.signature(target).parameters
        MODEL["accept"] = None if any(p.kind == p.VAR_KEYWORD for p in params.values()) else set(params)
        MODEL["m"] = m
        STATE["sample_rate"] = getattr(getattr(m, "tts_model", None), "sample_rate", 48000)
        STATE["device"] = device

        if _env_flag("SPEAKER_CHECK", on_gpu):
            try:
                from resemblyzer import VoiceEncoder

                ENCODER["e"] = VoiceEncoder(device=device)
                print("🛡️ Speaker check on")
            except Exception as e:
                print("⚠️ Speaker check unavailable:", e)
        STATE["status"] = "ready"
        print(f"✅ VoxCPM2 ready on {device.upper()} | {STATE['sample_rate']} Hz")
    except Exception as e:
        STATE["status"] = "error"
        STATE["error"] = str(e)
        print("❌ VoxCPM2 failed to load:", e)


def _ref_embedding(path: str):
    from resemblyzer import preprocess_wav

    if path not in REF_EMB:
        REF_EMB[path] = ENCODER["e"].embed_utterance(preprocess_wav(path))
    return REF_EMB[path]


def _similarity(w, ref_emb, sr):
    if len(w) < sr * 1.2:  # too short to measure reliably
        return None
    try:
        from resemblyzer import preprocess_wav

        e = ENCODER["e"].embed_utterance(preprocess_wav(w, source_sr=sr))
        return float(np.dot(e, ref_emb))
    except Exception:
        return None


def generate_speech(text, ref=None, prompt_text="", style="", mode="auto",
                    timesteps=10, cfg=2.0, seed=-1, denoise=False, tries=1, sim_threshold=0.80):
    import torch

    model, accept, sr = MODEL["m"], MODEL["accept"], STATE["sample_rate"]
    if ref and mode in ("auto", "ultimate") and prompt_text and not style:
        used = "ultimate"
    elif ref:
        used = "clone"
    else:
        used = "design"
    chunks, wavs, sims = split_text(text), [], []
    gap = np.zeros(int(sr * 0.12), dtype=np.float32)
    ref_emb = _ref_embedding(ref) if (ENCODER["e"] is not None and ref) else None
    n_try = max(1, min(int(tries), 6)) if ref_emb is not None else 1
    base_seed = seed if seed >= 0 else DEFAULT_SEED
    with GEN_LOCK:
        for c in chunks:
            best, best_s = None, -1.0
            for t in range(n_try):
                s = base_seed + t * 101
                torch.manual_seed(s)
                kw = dict(text=c, cfg_value=cfg, inference_timesteps=timesteps, normalize=True,
                          denoise=denoise, retry_badcase=True, seed=s)
                if used == "ultimate":
                    kw.update(prompt_wav_path=ref, prompt_text=prompt_text, reference_wav_path=ref)
                else:
                    if used == "clone":
                        kw["reference_wav_path"] = ref
                    if style:
                        kw["text"] = f"({style}){c}"
                if accept is not None:
                    kw = {k: v for k, v in kw.items() if k in accept}
                w = np.asarray(model.generate(**kw), dtype=np.float32).squeeze()
                sim = _similarity(w, ref_emb, sr) if ref_emb is not None else None
                if sim is None:
                    best = w
                    break
                if sim > best_s:
                    best, best_s = w, sim
                if sim >= sim_threshold:
                    break
            if best_s >= 0:
                sims.append(round(best_s, 3))
            wavs += [best, gap]
    LAST_REPORT["min"] = min(sims) if sims else None
    return np.concatenate(wavs[:-1]) if wavs else np.zeros(1, dtype=np.float32), used


# ---------------------------------------------------------------- API
@asynccontextmanager
async def lifespan(_app):
    seed_voice_bank()
    scan_voices()
    load_assignments()
    threading.Thread(target=load_model, daemon=True).start()
    yield


app = FastAPI(title="VoxCPM2 Khmer Multi-Voice API", lifespan=lifespan)


def require_key(x_api_key: str = Header(default="")):
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(401, "bad api key")


def require_ready():
    if STATE["status"] != "ready":
        raise HTTPException(503, f"VoxCPM2 {STATE['status']}: {STATE['error'] or 'កំពុងផ្ទុកម៉ូដែល...'}")


@app.get("/")
def home():
    body = {"status": STATE["status"], "model": MODEL_ID, "device": STATE["device"],
            "voices": {v: list(e) for v, e in VOICES.items()}}
    if STATE["status"] != "ready":
        # The studio treats non-200 as offline while the model is still loading
        raise HTTPException(503, detail=body | {"error": STATE["error"]})
    return body


@app.get("/api/voices", dependencies=[Depends(require_key)])
def list_voices():
    return {v: {e: {"has_transcript": bool(i["text"])} for e, i in emos.items()} for v, emos in VOICES.items()}


@app.get("/api/voices/{voice}/{emotion}.wav", dependencies=[Depends(require_key)])
def voice_preview(voice: str, emotion: str):
    entry = VOICES.get(voice, {}).get(emotion)
    if not entry:
        raise HTTPException(404, "voice not found")
    return FileResponse(entry["wav"], media_type="audio/wav")


@app.get("/api/assignments", dependencies=[Depends(require_key)])
def list_assignments():
    return ASSIGN


@app.post("/api/voices/register", dependencies=[Depends(require_key)])
async def register_voice(voice: str = Form(...), emotion: str = Form("normal"),
                         transcript: str = Form(""), audio: UploadFile = File(...)):
    tmp = UPLOAD_DIR / f"reg_{uuid.uuid4().hex}{Path(audio.filename or 'a.wav').suffix[:8]}"
    tmp.write_bytes(await audio.read())
    try:
        await run_in_threadpool(process_reference, str(tmp), voice, emotion, transcript)
        scan_voices()
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        tmp.unlink(missing_ok=True)
    return {"ok": True, "voices": {v: list(e) for v, e in VOICES.items()}}


@app.delete("/api/voices/{voice}", dependencies=[Depends(require_key)])
def delete_voice(voice: str):
    if voice not in VOICES:
        raise HTTPException(404, "voice not found")
    shutil.rmtree(VOICE_DIR / voice, ignore_errors=True)
    with BANK_LOCK:
        for k in [k for k, v in ASSIGN.items() if v == voice]:
            ASSIGN.pop(k)
        ASSIGN_PATH.write_text(json.dumps(ASSIGN, ensure_ascii=False, indent=1), encoding="utf-8")
    scan_voices()
    return {"ok": True}


@app.post("/api/clone-and-speak", dependencies=[Depends(require_key)])
async def clone_and_speak(
    text: str = Form(...),
    reference_audio: UploadFile = File(None),
    voice: str = Form(""),
    character: str = Form(""),
    emotion: str = Form(""),
    style: str = Form(""),
    prompt_text: str = Form(""),
    mode: str = Form("auto"),
    timesteps: int = Form(int(os.getenv("VOXCPM_TIMESTEPS", "10"))),
    cfg_value: float = Form(2.0),
    seed: int = Form(-1),
    denoise: bool = Form(False),
    tries: int = Form(int(os.getenv("VOXCPM_TRIES", "1"))),
):
    require_ready()
    ref, ptxt, emo, upload = None, prompt_text.strip(), "", None
    try:
        if reference_audio is not None and reference_audio.filename:
            upload = UPLOAD_DIR / f"{uuid.uuid4().hex}{Path(reference_audio.filename).suffix[:8]}"
            upload.write_bytes(await reference_audio.read())
            if upload.stat().st_size >= 1000:
                ref = str(upload)
        elif voice.strip():
            try:
                ref, ptxt, emo, voice = pick_ref(voice, emotion, character)
            except KeyError as e:
                raise HTTPException(404, str(e))
        wav, used = await run_in_threadpool(
            generate_speech, text.strip(), ref, ptxt, style.strip(), mode,
            max(4, min(int(timesteps), 30)), cfg_value, seed, denoise, tries)
        out = OUTPUT_DIR / f"out_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}.wav"
        sf.write(str(out), wav, STATE["sample_rate"])
        return FileResponse(str(out), media_type="audio/wav", headers={
            "X-Mode": used, "X-Voice": voice, "X-Emotion": emo,
            "X-Min-Similarity": str(LAST_REPORT["min"]),
            "X-Warning": "non-khmer-text" if khmer_ratio(text) < 0.6 else "",
            "Access-Control-Expose-Headers": ", ".join(EXPOSED),
        })
    except HTTPException:
        raise
    except Exception as e:
        print("❌", e)
        raise HTTPException(500, str(e))
    finally:
        if upload is not None:
            upload.unlink(missing_ok=True)
        _prune_outputs()


def _prune_outputs(keep_seconds: int = 3600):
    cutoff = time.time() - keep_seconds
    for f in OUTPUT_DIR.glob("out_*.wav"):
        try:
            if f.stat().st_mtime < cutoff:
                f.unlink()
        except OSError:
            pass
