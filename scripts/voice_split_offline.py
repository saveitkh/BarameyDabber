#!/usr/bin/env python3
"""
voice_split_offline.py — split a dialogue track into one audio file per character.

Fully offline (numpy + scipy + ffmpeg, no AI model download). Built for anime /
donghua episodes with many characters:

  * the number of characters is found automatically (no fixed 2-6 limit)
  * with --profiles, characters are remembered across episodes: a known voice
    keeps its id (S01, S02 …) and a voice never heard before becomes a NEW id
  * lines that need a human are flagged instead of silently guessed:
      mixed    — two voices in one line (overlap or a turn change)
      unsure   — the voice is between two characters
      missed   — quiet speech the detector skipped (listed separately)
  * review.html lets you fix only those lines (listen, reassign, split, add,
    rename/merge characters) and save edits.json; `apply` re-exports.

Usage:
    # 1) split (first episode creates the profile file, later episodes reuse it)
    python3 scripts/voice_split_offline.py split ep01.mp4 --outdir out_ep01 --profiles voices.json

    # 2) open out_ep01/review.html, fix the flagged lines, click "រក្សាទុក edits.json"

    # 3) re-export with your fixes (also teaches voices.json the corrected voices)
    python3 scripts/voice_split_offline.py apply out_ep01 --edits edits.json --profiles voices.json
    (or just:  apply ~/Downloads/edits.json --profiles voices.json — the folder is found by episode)

    Windows: drag a video (or the saved edits.json) onto VOICE_SPLIT.bat

    Old form still works:  python3 scripts/voice_split_offline.py input.mp4 --outdir out/ [--k 3]

Outputs (in --outdir):
    S01.wav, S02.wav …        each character's lines joined (mixed lines left out)
    S01_best.wav …            ~15 s of that character's clearest lines (voice-clone reference)
    S01_timeline.json …       where every clip came from in the source
    segments.json             every line: start, end, speaker, confidence, flags
    project.json              full state used by review.html and `apply`
    review.html, source.mp3   the review page and the audio it plays

CAVEAT: this is acoustic clustering (timbre + pitch), not neural speaker ID.
Similar voices can be mixed up; that is what the flags and review page are for.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import wave

import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.fft import dct
from scipy.ndimage import median_filter, percentile_filter
from scipy.signal import butter, resample_poly, sosfilt
from scipy.spatial.distance import pdist

ENGINE = "heuristic-v2"
SR = 16000            # analysis rate
EXPORT_SR = 24000     # rate of the exported character files
HOP = 160             # 10 ms
FRAME = 400           # 25 ms
N_MFCC = 13

# Feature layout: 12 MFCC means, 12 MFCC stds, log2 F0, F0 spread, voiced ratio
N_MEAN, N_STD = 12, 12
IDX_F0 = N_MEAN + N_STD
WEIGHTS = np.array([1.0] * N_MEAN + [0.25] * N_STD + [4.0, 0.3, 0.3])
# Pitch is compared in musical steps, the same for every episode: 0.2 octave (~2.4 semitones) = 1 unit
F0_UNIT = 0.2
# Dimensions a short part of a line still has (for the two-voices check)
PART_DIMS = np.r_[0:N_MEAN, IDX_F0]
NORM = float(np.sqrt(np.mean(WEIGHTS ** 2)))

MALE_F0_MAX = 165.0   # Hz; a rough guess, shown to the user as ប្រុស/ស្រី


def log(msg):
    print(msg, file=sys.stderr, flush=True)


# ───────────────────────────── audio I/O ─────────────────────────────

def decode(src, sr):
    """Any ffmpeg-readable file -> mono float32 at `sr`."""
    out = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", src, "-vn", "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"],
        check=True, stdout=subprocess.PIPE,
    ).stdout
    return np.frombuffer(out, dtype=np.int16).astype(np.float32) / 32768.0


def make_review_audio(src, outdir):
    """Small mono copy the review page plays (CBR so the browser seeks accurately)."""
    for name, codec in (("source.mp3", ["-c:a", "libmp3lame", "-b:a", "64k"]), ("source.m4a", ["-c:a", "aac", "-b:a", "64k"])):
        dest = os.path.join(outdir, name)
        try:
            subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "22050", *codec, dest],
                           check=True)
            return name
        except subprocess.CalledProcessError:
            continue
    raise RuntimeError("ffmpeg could not write the review audio")


def separate_vocals(src, outdir, mode):
    """Strip music/effects with Demucs (when installed) so quiet lines under music are found and the
    character files hold only the voice. Returns a path to the vocals, or None to use the full mix."""
    if mode == "no":
        return None
    try:
        import demucs  # noqa: F401
    except ImportError:
        if mode == "yes":
            raise SystemExit("Demucs is not installed (pip install demucs) — or pass --vocals, or --separate no")
        log("  (Demucs not installed — analysing the full mix; install it to find lines hidden under music)")
        return None
    tmp = os.path.join(outdir, "_demucs")
    log("Removing music with Demucs (a few minutes on a CPU)…")
    try:
        wav_in = os.path.join(outdir, "_mix.wav")
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", src, "-vn", "-ac", "2", "-ar", "44100", wav_in], check=True)
        subprocess.run([sys.executable, "-m", "demucs.separate", "-n", "htdemucs", "--two-stems=vocals", "-o", tmp, wav_in],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        stem = os.path.join(tmp, "htdemucs", "_mix", "vocals.wav")
        dest = os.path.join(outdir, "vocals.flac")
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", stem, "-ac", "1", "-ar", str(EXPORT_SR), dest], check=True)
        return dest
    except (subprocess.CalledProcessError, OSError) as e:
        detail = (getattr(e, "stderr", b"") or b"").decode(errors="ignore").strip().splitlines()[-1:] or [str(e)]
        if mode == "yes":
            raise SystemExit(f"Demucs failed: {detail[0]}")
        log(f"  (Demucs failed: {detail[0]} — analysing the full mix)")
        return None
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)
        if os.path.exists(os.path.join(outdir, "_mix.wav")):
            os.remove(os.path.join(outdir, "_mix.wav"))


def write_wav(path, data, sr):
    pcm = (np.clip(data, -1, 1) * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


# ───────────────────────────── speech detection ─────────────────────────────

def band_energy_db(audio):
    """Frame energy (dB) of the 250-3800 Hz speech band, so bass/cymbals of the music count less."""
    sos = butter(4, [250, 3800], btype="band", fs=SR, output="sos")
    y = sosfilt(sos, audio).astype(np.float64)
    n = 1 + max(0, len(y) - FRAME) // HOP
    sq = np.concatenate([[0.0], np.cumsum(y * y)])
    starts = np.arange(n) * HOP
    e = (sq[np.minimum(starts + FRAME, len(y))] - sq[starts]) / FRAME
    return 10 * np.log10(e + 1e-12)


def runs(mask):
    """[(start, end)] frame ranges where mask is True."""
    d = np.diff(np.concatenate([[0], mask.astype(np.int8), [0]]))
    return list(zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1)))


def detect_speech(audio, margin_db=6.0, min_dur=0.35, merge_gap=0.25, max_dur=8.0):
    """Returns (segments, missed): speech ranges in seconds, and quieter speech-like ranges to review."""
    db = band_energy_db(audio)
    floor = percentile_filter(db, 10, size=601, mode="nearest")   # 6 s rolling noise/music floor
    mask = median_filter(db > floor + margin_db, size=5)          # drop 1-2 frame blips

    merged = []
    for s, e in runs(mask):
        if merged and s - merged[-1][1] <= merge_gap * 100:
            merged[-1][1] = e
        else:
            merged.append([s, e])

    smooth = np.convolve(db, np.ones(15) / 15, mode="same")
    segs = []
    for s, e in merged:
        if e - s < min_dur * 100:
            continue
        # Long stretches usually hold several lines: cut at the quietest moment
        while e - s > max_dur * 100:
            lo, hi = s + int(2.0 * 100), s + int(max_dur * 100)
            cut = lo + int(np.argmin(smooth[lo:hi]))
            segs.append((s, cut))
            s = cut
        segs.append((s, e))

    # Quieter speech-band activity well away from any detected line → maybe a missed line
    taken = np.zeros_like(mask)
    for s, e in segs:
        taken[max(0, s - 20):e + 20] = True
    weak = median_filter((db > floor + margin_db * 0.5) & ~taken, size=9)
    missed = [(s, e) for s, e in runs(weak) if e - s >= 50]

    to_sec = lambda r: (round(r[0] * HOP / SR, 3), round(r[1] * HOP / SR, 3))
    return [to_sec(r) for r in segs], [to_sec(r) for r in missed]


# ───────────────────────────── voice fingerprint ─────────────────────────────

def _mel_filterbank(n_fft=512, n_mels=26, low=50):
    hz2mel = lambda f: 2595 * np.log10(1 + f / 700)
    mel2hz = lambda m: 700 * (10 ** (m / 2595) - 1)
    bins = np.floor((n_fft + 1) * mel2hz(np.linspace(hz2mel(low), hz2mel(SR / 2), n_mels + 2)) / SR).astype(int)
    fb = np.zeros((n_mels, n_fft // 2 + 1))
    for m in range(1, n_mels + 1):
        a, b, c = bins[m - 1], bins[m], bins[m + 1]
        if b > a:
            fb[m - 1, a:b] = (np.arange(a, b) - a) / (b - a)
        if c > b:
            fb[m - 1, b:c] = (c - np.arange(b, c)) / (c - b)
    return fb


_FBANK = _mel_filterbank()
_WINDOW = np.hamming(FRAME)
PITCH_FRAME = 640     # 40 ms
_PWINDOW = np.hanning(PITCH_FRAME)


def frame_features(sig):
    """Per 10 ms frame: MFCC (n,13), F0 in Hz (0 = unvoiced), energy dB."""
    if len(sig) < FRAME:
        sig = np.pad(sig, (0, FRAME - len(sig)))
    n = 1 + (len(sig) - FRAME) // HOP
    idx = np.arange(FRAME)[None, :] + HOP * np.arange(n)[:, None]
    fr = sig[idx] * _WINDOW
    spec = np.fft.rfft(fr, n=512, axis=1)
    power = (np.abs(spec) ** 2) / 512
    mfcc = dct(np.log(np.maximum(power @ _FBANK.T, 1e-10)), type=2, axis=1, norm="ortho")[:, :N_MFCC]
    energy = 10 * np.log10(np.mean(fr ** 2, axis=1) + 1e-12)

    # YIN pitch (70-400 Hz) on the low-passed frames, all frames at once through the FFT.
    # The cumulative-mean normalisation avoids the octave errors plain autocorrelation makes.
    # 40 ms frames: a low voice (80 Hz) needs room for two pitch periods
    pf = np.pad(sig, (0, PITCH_FRAME - FRAME))[np.arange(PITCH_FRAME)[None, :] + HOP * np.arange(n)[:, None]]
    frc = (pf - pf.mean(axis=1, keepdims=True)) * _PWINDOW
    spec2 = np.fft.rfft(frc, n=2048, axis=1)
    spec2[:, int(1100 * 2048 / SR):] = 0                     # keep < 1.1 kHz: harmonics, not formants
    ac = np.fft.irfft(np.abs(spec2) ** 2, axis=1)[:, :PITCH_FRAME]
    lag_min, lag_max = SR // 400, SR // 70
    diff = 2 * (ac[:, :1] - ac[:, :lag_max + 1])
    cum = np.cumsum(diff[:, 1:], axis=1) / np.arange(1, lag_max + 1)
    cmnd = np.ones_like(diff)
    cmnd[:, 1:] = diff[:, 1:] / np.maximum(cum, 1e-12)
    band = cmnd[:, lag_min:lag_max + 1]
    below = band < 0.2
    first = np.where(below.any(1), below.argmax(1), band.argmin(1))
    # Walk to the bottom of that dip
    for _ in range(8):
        nxt = np.minimum(first + 1, band.shape[1] - 1)
        step = band[np.arange(n), nxt] < band[np.arange(n), first]
        if not step.any():
            break
        first = np.where(step, nxt, first)
    quality = band[np.arange(n), first]
    f0 = np.where((quality < 0.45) & (energy > energy.max() - 35), SR / (lag_min + first), 0.0)
    return mfcc, f0, energy


def summarize(mfcc, f0, energy):
    """One fingerprint vector for a stretch of frames."""
    loud = energy > np.median(energy) - 10
    voiced = f0 > 0
    use = voiced & loud if (voiced & loud).sum() >= 5 else loud
    m = mfcc[use][:, 1:] if use.sum() else mfcc[:, 1:]
    lf0 = np.log2(f0[voiced]) if voiced.sum() >= 3 else np.array([np.nan])
    spread = float(np.subtract(*np.percentile(lf0, [75, 25]))) if lf0.size >= 3 else np.nan
    return np.concatenate([m.mean(0), m.std(0), [np.median(lf0), spread, voiced.mean()]])


def fingerprint(audio, segments):
    """Per line: full fingerprint, plus fingerprints of its first and second half (for the two-voices check)."""
    feats, halves = [], []
    for s, e in segments:
        mfcc, f0, energy = frame_features(audio[int(s * SR):int(e * SR)])
        feats.append(summarize(mfcc, f0, energy))
        if e - s >= 1.6:
            h = len(energy) // 2
            halves.append((summarize(mfcc[:h], f0[:h], energy[:h]), summarize(mfcc[h:], f0[h:], energy[h:])))
        else:
            halves.append(None)
    X = np.array(feats) if feats else np.zeros((0, len(WEIGHTS)))
    return X, halves


class Scale:
    """Robust per-dimension scaling + weights, so distances mean the same across episodes."""

    def __init__(self, center, spread):
        self.center = np.asarray(center, float)
        self.spread = np.maximum(np.asarray(spread, float), 1e-6)

    @classmethod
    def fit(cls, X):
        center = np.nanmedian(X, axis=0)
        q75, q25 = np.nanpercentile(X, [75, 25], axis=0)
        spread = (q75 - q25) / 1.349
        spread[IDX_F0] = F0_UNIT
        return cls(center, spread)

    def __call__(self, X, dims=None):
        X = np.atleast_2d(np.asarray(X, float))
        dims = slice(None) if dims is None else dims
        Z = (X - self.center[dims]) / self.spread[dims]
        Z = np.where(np.isnan(Z), 0.0, Z)     # unknown pitch → "average"
        return Z * WEIGHTS[dims] / NORM


# ───────────────────────────── clustering ─────────────────────────────

def refine(Z, labels, rounds=3):
    """Move each line to its nearest character centre (fixes chaining of average linkage)."""
    for _ in range(rounds):
        ks = np.unique(labels)
        C = np.array([Z[labels == k].mean(0) for k in ks])
        new = ks[np.argmin(((Z[:, None, :] - C[None]) ** 2).sum(-1), axis=1)]
        if np.array_equal(new, labels):
            break
        labels = new
    _, labels = np.unique(labels, return_inverse=True)
    return labels


def separation(Z, labels):
    """Closest pair of character centres, in units of the typical distance of a line to its own centre."""
    k = labels.max() + 1
    C = np.array([Z[labels == c].mean(0) for c in range(k)])
    radius = np.median(np.sqrt(((Z - C[labels]) ** 2).sum(1)))
    return float(pdist(C).min() / max(radius, 1e-9))


def cluster(Z, durations, k=None, max_speakers=30, separation_min=1.85, min_lines=2, min_seconds=2.0):
    """Group lines by voice. Auto mode keeps the MOST characters whose voices are all still clearly
    apart — merging two in the review page is one click, splitting one apart is line-by-line work.
    A group needs a few lines of its own to count: tiny groups are usually one voice split by chance
    (a one-line extra lands in the nearest voice, flagged as unsure)."""
    n = len(Z)
    if n < 3:
        return np.zeros(n, int), None
    tree = linkage(Z, method="ward")
    if k:
        return refine(Z, fcluster(tree, min(k, n), "maxclust") - 1), None
    for kk in range(min(max_speakers, n // 2), 1, -1):
        labels = refine(Z, fcluster(tree, kk, "maxclust") - 1)
        if labels.max() + 1 == kk and np.bincount(labels).min() >= min_lines \
                and np.bincount(labels, weights=durations).min() >= min_seconds:
            sep = separation(Z, labels)
            if sep >= separation_min:
                return labels, sep
    return np.zeros(n, int), None


def centres(Z, labels):
    return np.array([Z[labels == k].mean(0) for k in range(labels.max() + 1)])


# ───────────────────────────── profiles (memory across episodes) ─────────────────────────────

def load_profiles(path):
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if data.get("engine") != ENGINE:
            log(f"! {path} was made by another engine version — starting a new profile file")
            return None
        return data
    return None


def profile_centre(p):
    eps = p["episodes"].values()
    n = sum(e["n"] for e in eps)
    return np.sum([np.asarray(e["sum"]) for e in eps], axis=0) / max(n, 1)


def match_profiles(profiles, scale, X, labels, episode):
    """Map this episode's clusters to remembered characters; unknown voices get new ids."""
    k = labels.max() + 1
    Z = scale(X)
    C = centres(Z, labels)
    # Typical distance of a line to its own character centre in this episode
    radius = float(np.median(np.sqrt(((Z - C[labels]) ** 2).sum(-1))))
    known = profiles["speakers"] if profiles else []

    pairs = []
    for i in range(k):
        for p in known:
            d = float(np.sqrt(((C[i] - scale(profile_centre(p))[0]) ** 2).sum()))
            pairs.append((d, i, p["id"]))
    pairs.sort()
    mapping, used = {}, set()
    # Re-running an episode matches its own earlier result, so ids stay the same
    for d, i, pid in pairs:
        if i in mapping or pid in used or d > 0.75 * radius:
            continue
        mapping[i] = pid
        used.add(pid)
    return mapping


def pull_known_voices(profiles, scale, Z, labels, mapping, durations):
    """A remembered character can hide inside another group (similar voice, few lines this episode).
    Lines clearly nearer to such a character than to their own group move out to it."""
    C = centres(Z, labels)
    spare = [(p["id"], scale(profile_centre(p))[0]) for p in profiles["speakers"] if p["id"] not in mapping.values()]
    if not spare:
        return labels, mapping
    P = np.array([c for _, c in spare])
    own = np.sqrt(((Z - C[labels]) ** 2).sum(1))
    dp = np.sqrt(((Z[:, None, :] - P[None]) ** 2).sum(-1))
    best = dp.argmin(1)
    moving = dp[np.arange(len(Z)), best] < 0.8 * own
    labels, mapping = labels.copy(), dict(mapping)
    for j, (pid, _) in enumerate(spare):
        rows = np.flatnonzero(moving & (best == j))
        if len(rows) >= 2 and durations[rows].sum() >= 2.0:
            new = labels.max() + 1
            labels[rows] = new
            mapping[new] = pid
            log(f"  {pid} (known voice) found inside another group: {len(rows)} lines moved back to it")
    # Groups emptied by the moves disappear; keep the mapping in step with the new numbering
    keep, labels = np.unique(labels, return_inverse=True)
    mapping = {int(np.flatnonzero(keep == old)[0]): pid for old, pid in mapping.items() if old in keep}
    return labels, mapping


def next_id(taken):
    n = 1
    while f"S{n:02d}" in taken:
        n += 1
    return f"S{n:02d}"


def update_profiles(path, profiles, scale, X, seg_speakers, speakers, episode):
    """Store this episode's (corrected) voices; re-running an episode replaces its earlier data."""
    if not path:
        return
    if profiles is None:
        profiles = {"engine": ENGINE, "scale": {"center": scale.center.tolist(), "spread": scale.spread.tolist()}, "speakers": []}
    by_id = {p["id"]: p for p in profiles["speakers"]}
    for p in profiles["speakers"]:
        p["episodes"].pop(episode, None)
    for sp in speakers:
        rows = [i for i, s in enumerate(seg_speakers) if s == sp["id"]]
        if not rows:
            continue
        p = by_id.get(sp["id"])
        if not p:
            p = {"id": sp["id"], "name": "", "episodes": {}}
            profiles["speakers"].append(p)
            by_id[sp["id"]] = p
        if sp.get("name"):
            p["name"] = sp["name"]
        Xs = X[rows]
        Xs = np.where(np.isnan(Xs), np.nanmedian(X, axis=0), Xs)
        p["episodes"][episode] = {"sum": Xs.sum(0).tolist(), "n": len(rows), "seconds": round(sp["seconds"], 1)}
    profiles["speakers"] = [p for p in profiles["speakers"] if p["episodes"]]
    profiles["speakers"].sort(key=lambda p: p["id"])
    with open(path, "w", encoding="utf-8") as f:
        json.dump(profiles, f, ensure_ascii=False, indent=1)
    log(f"Profiles saved: {path} ({len(profiles['speakers'])} characters)")


# ───────────────────────────── export ─────────────────────────────

def safe_name(s):
    return re.sub(r'[\\/:*?"<>|\s]+', "_", s).strip("_")[:40]


def clip(audio, sr, s, e, pad=0.05, fade=0.01):
    a = audio[max(0, int((s - pad) * sr)):int((e + pad) * sr)].copy()
    f = min(int(fade * sr), len(a) // 2)
    if f > 0:
        ramp = np.linspace(0, 1, f, dtype=np.float32)
        a[:f] *= ramp
        a[-f:] *= ramp[::-1]
    return a


def export(project, outdir, export_audio):
    """Write each character's joined lines, a short best-lines reference, and timelines."""
    for old in os.listdir(outdir):
        if re.match(r"^S\d+.*(\.wav|_timeline\.json)$", old) or re.match(r"^speaker_\d+(\.wav|_timeline\.json)$", old):
            os.remove(os.path.join(outdir, old))
    gap = np.zeros(int(0.15 * EXPORT_SR), np.float32)
    for sp in project["speakers"]:
        rows = sorted((s for s in project["segments"] if s["speaker"] == sp["id"]), key=lambda s: s["start"])
        clean = [s for s in rows if "mixed" not in s["flags"]]
        if not clean:
            continue
        base = sp["id"] + (f"_{safe_name(sp['name'])}" if sp.get("name") else "")
        chunks, timeline, cursor = [], [], 0.0
        for s in clean:
            a = clip(export_audio, EXPORT_SR, s["start"], s["end"])
            chunks += [a, gap]
            timeline.append({"id": s["id"], "orig_start": s["start"], "orig_end": s["end"], "new_start": round(cursor, 3)})
            cursor += (len(a) + len(gap)) / EXPORT_SR
        write_wav(os.path.join(outdir, f"{base}.wav"), np.concatenate(chunks), EXPORT_SR)
        with open(os.path.join(outdir, f"{base}_timeline.json"), "w", encoding="utf-8") as f:
            json.dump(timeline, f, indent=1)

        # Clone reference: confident lines of 1.5-10 s, about 15 s in total
        good = sorted((s for s in clean if 1.5 <= s["end"] - s["start"] <= 10 and "unsure" not in s["flags"]),
                      key=lambda s: -s["confidence"]) or clean
        picked, total = [], 0.0
        for s in good:
            if total >= 15:
                break
            picked.append(s)
            total += s["end"] - s["start"]
        best = [x for s in sorted(picked, key=lambda s: s["start"]) for x in (clip(export_audio, EXPORT_SR, s["start"], s["end"]), gap)]
        write_wav(os.path.join(outdir, f"{base}_best.wav"), np.concatenate(best), EXPORT_SR)
        sp["file"], sp["best_file"] = f"{base}.wav", f"{base}_best.wav"

    with open(os.path.join(outdir, "segments.json"), "w", encoding="utf-8") as f:
        json.dump([{k: s[k] for k in ("id", "start", "end", "speaker", "confidence", "flags")} for s in project["segments"]],
                  f, ensure_ascii=False, indent=1)


def speaker_summary(project, X=None):
    seconds, f0s = {}, {}
    for i, s in enumerate(project["segments"]):
        seconds[s["speaker"]] = seconds.get(s["speaker"], 0) + s["end"] - s["start"]
        if X is not None and i < len(X) and not np.isnan(X[i, IDX_F0]):
            f0s.setdefault(s["speaker"], []).append(2 ** X[i, IDX_F0])
    for sp in project["speakers"]:
        sp["seconds"] = round(seconds.get(sp["id"], 0.0), 1)
        sp["lines"] = sum(1 for s in project["segments"] if s["speaker"] == sp["id"])
        if sp["id"] in f0s:
            hz = float(np.median(f0s[sp["id"]]))
            sp["pitch_hz"] = round(hz)
            sp["gender_guess"] = "male" if hz < MALE_F0_MAX else "female"
    project["speakers"] = [sp for sp in project["speakers"] if sp["lines"] > 0]


def save_project(project, outdir):
    with open(os.path.join(outdir, "project.json"), "w", encoding="utf-8") as f:
        json.dump(project, f, ensure_ascii=False, indent=1)
    page = REVIEW_HTML.replace("__PROJECT_JSON__", json.dumps(project, ensure_ascii=False).replace("</", "<\\/"))
    with open(os.path.join(outdir, "review.html"), "w", encoding="utf-8") as f:
        f.write(page)


def print_summary(project):
    flagged = sum(1 for s in project["segments"] if s["flags"])
    log(f"  {len(project['speakers'])} characters, {len(project['segments'])} lines, "
        f"{flagged} lines to review, {len(project['missed'])} possible missed lines")
    for sp in project["speakers"]:
        tag = " (NEW)" if sp.get("new") else ""
        g = {"male": "ប្រុស", "female": "ស្រី"}.get(sp.get("gender_guess"), "?")
        log(f"  {sp['id']}{tag} {sp.get('name') or ''}: {sp['lines']} lines, {sp['seconds']}s, ~{sp.get('pitch_hz', '?')} Hz ({g})")


# ───────────────────────────── commands ─────────────────────────────

def cmd_split(args):
    os.makedirs(args.outdir, exist_ok=True)
    episode = os.path.basename(args.input)
    log("Decoding audio…")
    review_audio = make_review_audio(args.input, args.outdir)
    vocals = args.vocals or separate_vocals(args.input, args.outdir, args.separate)
    if vocals:
        log(f"  using vocals: {vocals}")
    export_audio = decode(vocals or args.input, EXPORT_SR)
    audio = resample_poly(export_audio, 2, 3).astype(np.float32)   # 24 kHz → 16 kHz

    log("Finding speech…")
    segments, missed = detect_speech(audio, margin_db=args.margin_db, min_dur=args.min_dur)
    log(f"  {len(segments)} lines, {sum(e - s for s, e in segments):.1f}s of speech")
    if not segments:
        raise SystemExit("No speech found — try a lower --margin-db")

    log("Fingerprinting voices…")
    X, halves = fingerprint(audio, segments)

    profiles = load_profiles(args.profiles)
    scale = Scale(profiles["scale"]["center"], profiles["scale"]["spread"]) if profiles else Scale.fit(X)
    Z = scale(X)

    log("Grouping lines by voice…")
    durations = np.array([e - s for s, e in segments])
    labels, sep = cluster(Z, durations, k=args.k, max_speakers=args.max_speakers, separation_min=args.separation)
    if sep is not None:
        log(f"  closest two characters are {sep:.2f}x apart (--separation {args.separation})")
    C = centres(Z, labels)

    # Ids: remembered characters keep theirs; the rest are new, biggest first
    mapping = match_profiles(profiles, scale, X, labels, episode) if profiles else {}
    if profiles:
        labels, mapping = pull_known_voices(profiles, scale, Z, labels, mapping, durations)
        C = centres(Z, labels)
    taken = {p["id"] for p in (profiles or {}).get("speakers", [])} | set(mapping.values())
    seconds = np.bincount(labels, weights=[e - s for s, e in segments])
    names = {p["id"]: p.get("name", "") for p in (profiles or {}).get("speakers", [])}
    ids = {}
    for c in np.argsort(-seconds):
        if c in mapping:
            ids[c] = mapping[c]
        else:
            ids[c] = next_id(taken)
            taken.add(ids[c])
    speakers = [{"id": ids[c], "name": names.get(ids[c], ""), "new": c not in mapping and bool(profiles)} for c in np.argsort(-seconds)]

    # Two halves of one line that sound as far apart as two different characters → two voices
    Cp = C[:, PART_DIMS]
    pair_d = np.sqrt(((Cp[None] - Cp[:, None]) ** 2).sum(-1))
    part_gap = float(np.median(pair_d[np.triu_indices(len(Cp), 1)])) if len(Cp) > 1 else np.inf
    rows = []
    for i, (s, e) in enumerate(segments):
        # Margin between the line's own character and the closest other one (0 = could be either)
        d = np.sqrt(((C - Z[i]) ** 2).sum(-1))
        other = int(np.argmin(np.where(np.arange(len(C)) == labels[i], np.inf, d))) if len(C) > 1 else None
        conf = float(max(0.0, (d[other] - d[labels[i]]) / max(d[other], 1e-9))) if other is not None else 1.0
        flags = []
        # Short lines carry little voice, so they need a clearer margin
        if conf < args.unsure or (e - s < 1.0 and conf < args.unsure * 1.4):
            flags.append("unsure")
        if halves[i] is not None and len(C) > 1:
            a, b = (scale(h[PART_DIMS], PART_DIMS)[0] for h in halves[i])
            ka, kb = (int(np.argmin(((Cp - h) ** 2).sum(-1))) for h in (a, b))
            if ka != kb and np.sqrt(((a - b) ** 2).sum()) > args.mixed * part_gap:
                flags.append("mixed")
        rows.append({"id": i + 1, "start": s, "end": e, "speaker": ids[labels[i]], "confidence": round(conf, 3),
                     "flags": flags, "alt": ids[other] if other is not None else None})

    project = {
        "version": 2, "engine": ENGINE, "episode": episode, "input": os.path.abspath(args.input),
        "vocals": os.path.abspath(vocals) if vocals else None,
        "audio": review_audio, "created": time.strftime("%Y-%m-%d %H:%M:%S"), "speakers": speakers,
        "segments": rows, "missed": [{"start": s, "end": e} for s, e in missed],
    }
    speaker_summary(project, X)
    log("Exporting character files…")
    export(project, args.outdir, export_audio)
    save_project(project, args.outdir)
    # Remember only voices the tool is sure about; `apply` adds the lines a human checked
    update_profiles(args.profiles, profiles, scale, X, [r["speaker"] if not r["flags"] else None for r in rows],
                    project["speakers"], episode)
    print_summary(project)
    log(f"Done → {args.outdir}/  · open review.html to fix the flagged lines")


def find_output_dir(edits, search):
    """The split folder an edits.json belongs to (same episode; newest when split more than once)."""
    found = []
    for root, _dirs, files in os.walk(search):
        if "project.json" in files:
            try:
                with open(os.path.join(root, "project.json"), encoding="utf-8") as f:
                    p = json.load(f)
            except (OSError, ValueError):
                continue
            if p.get("episode") == edits.get("episode"):
                found.append((p.get("created") == edits.get("created"), os.path.getmtime(os.path.join(root, "project.json")), root))
    if not found:
        raise SystemExit(f"No split folder for {edits.get('episode')} under {os.path.abspath(search)} — pass the folder: apply OUTDIR --edits FILE")
    return max(found)[2]


def cmd_apply(args):
    # `apply edits.json` (e.g. straight from Downloads) finds its own output folder
    if args.outdir.lower().endswith(".json") and os.path.isfile(args.outdir):
        args.edits = args.outdir
        with open(args.edits, encoding="utf-8") as f:
            args.outdir = find_output_dir(json.load(f), args.search)
        log(f"Output folder: {args.outdir}")
    outdir = args.outdir
    with open(os.path.join(outdir, "project.json"), encoding="utf-8") as f:
        project = json.load(f)
    edits_path = args.edits or os.path.join(outdir, "edits.json")
    with open(edits_path, encoding="utf-8") as f:
        edits = json.load(f)
    if edits.get("episode") not in (None, project["episode"]):
        raise SystemExit(f"edits.json is for {edits['episode']}, not {project['episode']}")

    # Characters made in the review page get real ids
    profiles = load_profiles(args.profiles)
    taken = {sp["id"] for sp in project["speakers"]} | {p["id"] for p in (profiles or {}).get("speakers", [])}
    remap = {}
    for sp in edits["speakers"]:
        if not re.match(r"^S\d+$", sp["id"]):
            remap[sp["id"]] = next_id(taken)
            taken.add(remap[sp["id"]])
            sp["id"], sp["new"] = remap[sp["id"]], True
    segs = []
    for s in edits["segments"]:
        if s.get("speaker") in (None, "", "drop"):
            continue
        start, end = float(s["start"]), float(s["end"])
        if end - start < 0.1:
            continue
        s = {**s, "start": round(start, 3), "end": round(end, 3), "speaker": remap.get(s["speaker"], s["speaker"])}
        s.setdefault("confidence", 1.0)
        s["flags"] = [] if s.get("reviewed") else [f for f in s.get("flags", []) if f in ("mixed", "unsure")]
        segs.append(s)
    segs.sort(key=lambda s: s["start"])
    for i, s in enumerate(segs, 1):
        s["id"] = i
    project["created"] = time.strftime("%Y-%m-%d %H:%M:%S")   # the review page starts fresh from this result
    project.update(speakers=[{k: v for k, v in sp.items() if k in ("id", "name", "new")} for sp in edits["speakers"]],
                   segments=segs, missed=edits.get("missed", []))

    src = next((p for p in (project.get("vocals"), project["input"]) if p and os.path.exists(p)),
               os.path.join(outdir, project["audio"]))
    log(f"Decoding {src}…")
    export_audio = decode(src, EXPORT_SR)
    audio = resample_poly(export_audio, 2, 3).astype(np.float32)
    X, _ = fingerprint(audio, [(s["start"], s["end"]) for s in segs])
    speaker_summary(project, X)
    export(project, outdir, export_audio)
    save_project(project, outdir)
    if args.profiles:
        scale = Scale(profiles["scale"]["center"], profiles["scale"]["spread"]) if profiles else Scale.fit(X)
        # Learn only from lines a human checked or the tool was sure about
        trusted = [s["speaker"] if (s.get("reviewed") or not s["flags"]) else None for s in segs]
        update_profiles(args.profiles, profiles, scale, X, trusted, project["speakers"], project["episode"])
    print_summary(project)
    log(f"Done → {outdir}/")


def cmd_clips(args):
    """Cut ONE already-single-speaker audio file (e.g. an S01.wav this tool exported, or any
    clip joined by another tool) back into individual utterance clips, by the gaps between them."""
    os.makedirs(args.outdir, exist_ok=True)
    log("Decoding audio…")
    export_audio = decode(args.input, EXPORT_SR)
    audio = resample_poly(export_audio, 2, 3).astype(np.float32)

    log("Finding individual clips…")
    segments, _ = detect_speech(
        audio, margin_db=args.margin_db, min_dur=args.min_dur,
        merge_gap=args.merge_gap, max_dur=args.max_dur,
    )
    if not segments:
        raise SystemExit("No clips found — try a lower --margin-db or --min-dur")
    log(f"  {len(segments)} clips, {sum(e - s for s, e in segments):.1f}s total")

    base = os.path.splitext(os.path.basename(args.input))[0]
    pad = len(str(len(segments)))
    index = []
    for i, (s, e) in enumerate(segments, 1):
        name = f"{base}_{str(i).zfill(pad)}.wav"
        write_wav(os.path.join(args.outdir, name), clip(export_audio, EXPORT_SR, s, e), EXPORT_SR)
        index.append({"file": name, "start": round(s, 2), "end": round(e, 2), "duration": round(e - s, 2)})
    with open(os.path.join(args.outdir, f"{base}_clips.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    log(f"Done → {args.outdir}/  ({len(segments)} clips)")


def main():
    argv = sys.argv[1:]
    if argv and argv[0] not in ("split", "apply", "clips", "-h", "--help"):
        argv = ["split"] + argv                      # old form: voice_split_offline.py input.mp4 …
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("split", help="find the characters in an audio/video file")
    sp.add_argument("input", help="audio or video file (anything ffmpeg reads)")
    sp.add_argument("--outdir", default="voice_split_out")
    sp.add_argument("--profiles", help="voices.json shared by all episodes of a series (created if missing)")
    sp.add_argument("--k", type=int, help="force the number of characters")
    sp.add_argument("--max-speakers", type=int, default=30, help="upper limit for the automatic count (default 30)")
    sp.add_argument("--separation", type=float, default=1.85,
                    help="how different two voices must be to count as two characters (smaller = more characters)")
    sp.add_argument("--unsure", type=float, default=0.25, help="flag lines whose voice is this close to a second character (0-1)")
    sp.add_argument("--mixed", type=float, default=0.8, help="flag a line as two voices when its halves differ this much (x typical gap between characters)")
    sp.add_argument("--separate", choices=("auto", "yes", "no"), default="auto",
                    help="remove music with Demucs first (auto = when installed)")
    sp.add_argument("--vocals", help="an already separated vocals file for this input (skips Demucs)")
    sp.add_argument("--margin-db", type=float, default=6.0, help="how far above the music/noise floor speech must be")
    sp.add_argument("--min-dur", type=float, default=0.35, help="shortest line kept (s)")

    ap_ = sub.add_parser("apply", help="re-export with the fixes saved from review.html")
    ap_.add_argument("outdir", help="the split output folder, or just the edits.json file")
    ap_.add_argument("--search", default=".", help="where to look for the output folder when given only edits.json")
    ap_.add_argument("--edits", help="edits.json from review.html (default: <outdir>/edits.json)")
    ap_.add_argument("--profiles", help="voices.json to teach the corrected voices")

    cp = sub.add_parser("clips", help="cut one already-single-speaker file into individual clips")
    cp.add_argument("input", help="one speaker's joined audio (e.g. an S01.wav this tool made)")
    cp.add_argument("--outdir", default="voice_clips_out")
    # Tighter defaults than `split`: a single speaker's own pauses between short phrases are
    # much shorter than the gap you'd want between two DIFFERENT people's lines in noisy footage.
    cp.add_argument("--margin-db", type=float, default=4.0, help="how far above the quiet-gap floor a clip must be")
    cp.add_argument("--min-dur", type=float, default=0.35, help="shortest clip kept (s)")
    cp.add_argument("--merge-gap", type=float, default=0.12, help="gaps shorter than this (s) are joined into one clip")
    cp.add_argument("--max-dur", type=float, default=15.0, help="a clip longer than this (s) is cut at its quietest point")

    args = ap.parse_args(argv)
    {"split": cmd_split, "apply": cmd_apply, "clips": cmd_clips}[args.cmd](args)


# ───────────────────────────── review page ─────────────────────────────

REVIEW_HTML = r"""<!doctype html>
<html lang="km">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Voice Split Review</title>
<style>
:root{--bg:#0b1020;--card:#121a2e;--sunk:#0d1426;--line:#22304f;--text:#e6ecff;--muted:#8b98bd;--accent:#38bdf8;--warn:#f59e0b;--bad:#f43f5e;--ok:#22c55e}
@media (prefers-color-scheme:light){:root{--bg:#f4f6fb;--card:#fff;--sunk:#eef2f9;--line:#d6deee;--text:#141b2d;--muted:#5d6987;--accent:#0284c7}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 "Kantumruy Pro","Noto Sans Khmer","Khmer OS",system-ui,sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
h1{font-size:16px;margin:0}small,.muted{color:var(--muted)}
main{display:grid;grid-template-columns:300px 1fr;gap:14px;padding:14px 16px}@media(max-width:860px){main{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px}
button,select,input{font:inherit;color:inherit}
button{background:var(--sunk);border:1px solid var(--line);border-radius:8px;padding:5px 10px;cursor:pointer}button:hover{border-color:var(--accent)}
button.primary{background:var(--accent);border-color:var(--accent);color:#04121f;font-weight:700}
select,input{background:var(--sunk);border:1px solid var(--line);border-radius:8px;padding:4px 6px}
.sp{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border-bottom:1px solid var(--line)}.sp .dot{margin-top:6px}
.dot{width:12px;height:12px;border-radius:50%;flex:none}
.sp input{width:100%}.sp select{max-width:130px}
.tabs{display:flex;gap:6px;flex-wrap:wrap;padding:10px;border-bottom:1px solid var(--line)}
.tabs button[aria-pressed=true]{background:var(--accent);color:#04121f;border-color:var(--accent);font-weight:700}
#map{position:relative;height:34px;margin:10px;background:var(--sunk);border-radius:8px;cursor:pointer;overflow:hidden}
#map i{position:absolute;top:5px;bottom:5px;border-radius:2px}#map i.f{top:0;bottom:0;outline:2px solid var(--warn)}
#head{position:absolute;top:0;bottom:0;width:2px;background:var(--text)}
table{width:100%;border-collapse:collapse}td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:middle}
tr.sel{background:var(--sunk);outline:2px solid var(--accent);outline-offset:-2px}
tr.missed td{opacity:.85;font-style:italic}
.flag{display:inline-block;border-radius:99px;padding:0 7px;font-size:11px;font-weight:700;margin-right:4px}
.flag.mixed{background:#f43f5e33;color:var(--bad)}.flag.unsure{background:#f59e0b33;color:var(--warn)}.flag.missed{background:#38bdf833;color:var(--accent)}.flag.ok{background:#22c55e33;color:var(--ok)}
.t{font-family:ui-monospace,monospace;font-size:12px;white-space:nowrap}
.num{width:76px}
.help{padding:10px;font-size:12px;color:var(--muted)}kbd{border:1px solid var(--line);border-radius:4px;padding:0 4px;font-size:11px}
</style>
</head>
<body>
<header>
  <h1>🎙️ ពិនិត្យសំឡេងតួ · <span id="ep"></span></h1>
  <small id="stats"></small>
  <span style="flex:1"></span>
  <audio id="au" controls preload="auto"></audio>
  <button class="primary" id="save">💾 រក្សាទុក edits.json</button>
</header>
<main>
  <section class="card">
    <div class="tabs"><b style="padding:4px">តួអង្គ</b><span style="flex:1"></span><button id="addsp">＋ តួថ្មី</button></div>
    <div id="sps"></div>
    <div class="help">
      ▶ ស្ដាប់គំរូ · ដាក់ឈ្មោះតួ · <b>បញ្ចូល</b> = តួពីរដែលជាមនុស្សតែម្នាក់<br><br>
      <b>ក្ដារចុច</b>: <kbd>Space</kbd> ស្ដាប់ឃ្លា · <kbd>↑</kbd><kbd>↓</kbd> ឃ្លាមុន/បន្ទាប់ ·
      <kbd>1</kbd>–<kbd>9</kbd> ដាក់ឲ្យតួទី១–៩ · <kbd>Enter</kbd> ត្រឹមត្រូវ ✓ · <kbd>S</kbd> កាត់ពីរ ·
      <kbd>Del</kbd> លុបចោល
    </div>
  </section>
  <section class="card">
    <div class="tabs" id="filters"></div>
    <div id="map"><span id="head"></span></div>
    <table><tbody id="rows"></tbody></table>
  </section>
</main>
<script type="application/json" id="data">__PROJECT_JSON__</script>
<script>
const P = JSON.parse(document.getElementById('data').textContent);
const KEY = 'voice-split:' + P.episode + ':' + P.created;
const COLORS = ['#38bdf8','#f472b6','#a3e635','#fbbf24','#a78bfa','#34d399','#fb7185','#60a5fa','#f97316','#2dd4bf','#e879f9','#facc15'];
let S;
try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
if (!S) S = { speakers: P.speakers.map(s => ({ id: s.id, name: s.name || '', new: !!s.new, gender_guess: s.gender_guess, pitch_hz: s.pitch_hz })),
              segments: P.segments.map(s => ({ ...s })),
              missed: P.missed.map((m, i) => ({ ...m, mid: i })) };
let filter = S.segments.some(s => s.flags.length) || S.missed.length ? 'review' : 'all';
let sel = 0, stopAt = null, nextNew = 1;
const au = document.getElementById('au');
au.src = P.audio;
const $ = id => document.getElementById(id);
const fmt = t => { t = Math.max(0, t); const m = Math.floor(t / 60); return String(m).padStart(2, '0') + ':' + (t - m * 60).toFixed(1).padStart(4, '0'); };
const color = id => COLORS[S.speakers.findIndex(s => s.id === id) % COLORS.length] || '#888';
const label = sp => sp.id + (sp.name ? ' · ' + sp.name : '') + (sp.gender_guess ? (sp.gender_guess === 'male' ? ' ♂' : ' ♀') : '');
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
const total = () => Math.max(au.duration || 0, ...S.segments.map(s => s.end), ...S.missed.map(m => m.end), 1);

function play(a, b) { au.currentTime = a; stopAt = b; au.play(); }
au.addEventListener('timeupdate', () => {
  if (stopAt !== null && au.currentTime >= stopAt) { au.pause(); stopAt = null; }
  $('head').style.left = (au.currentTime / total() * 100) + '%';
});
function playSample(id) {
  const lines = S.segments.filter(s => s.speaker === id && !s.flags.length).sort((a, b) => b.confidence - a.confidence).slice(0, 3)
    .sort((a, b) => a.start - b.start);
  let i = 0; const next = () => { if (i >= lines.length) return; const l = lines[i++]; play(l.start, l.end); const h = () => { if (au.paused) { au.removeEventListener('pause', h); setTimeout(next, 250); } }; au.addEventListener('pause', h); };
  next();
}

function visible() {
  const segs = S.segments.map(s => ({ ...s, kind: 'seg' }));
  const missed = S.missed.map(m => ({ ...m, kind: 'missed' }));
  let list = filter === 'review' ? [...segs.filter(s => s.flags.length && !s.reviewed), ...missed]
           : filter === 'all' ? [...segs, ...missed] : segs.filter(s => s.speaker === filter);
  return list.sort((a, b) => a.start - b.start);
}

function renderSpeakers() {
  $('sps').innerHTML = '';
  S.speakers.forEach((sp, i) => {
    const n = S.segments.filter(s => s.speaker === sp.id);
    const secs = n.reduce((t, s) => t + s.end - s.start, 0);
    const div = document.createElement('div'); div.className = 'sp';
    div.innerHTML = `<span class="dot" style="background:${color(sp.id)}"></span>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">
        <div style="display:flex;gap:6px;align-items:center"><b>${i < 9 ? (i + 1) + '.' : ''} ${sp.id}</b>
          ${sp.new ? '<span class="flag missed">តួថ្មី</span>' : ''}<span style="flex:1"></span>
          <button title="ស្ដាប់គំរូ">▶</button></div>
        <input value="${(sp.name || '').replace(/"/g, '&quot;')}" placeholder="ដាក់ឈ្មោះតួ…">
        <div style="display:flex;gap:6px;align-items:center"><small style="flex:1">${n.length} ឃ្លា · ${secs.toFixed(0)}s${sp.pitch_hz ? ' · ~' + sp.pitch_hz + 'Hz ' + (sp.gender_guess === 'male' ? 'ប្រុស' : 'ស្រី') : ''}</small>
          <select title="បញ្ចូលតួនេះទៅក្នុងតួផ្សេង (ជាមនុស្សតែម្នាក់)"><option value="">បញ្ចូល…</option>
          ${S.speakers.filter(o => o.id !== sp.id).map(o => `<option value="${o.id}">→ ${label(o)}</option>`).join('')}</select></div>
      </div>`;
    div.querySelector('input').onchange = e => { sp.name = e.target.value.trim(); persist(); render(); };
    div.querySelector('button').onclick = () => playSample(sp.id);
    div.querySelector('select').onchange = e => {
      const into = e.target.value; if (!into) return;
      if (!confirm(`បញ្ចូល ${sp.id} (${n.length} ឃ្លា) ទៅក្នុង ${into}?`)) { e.target.value = ''; return; }
      S.segments.forEach(s => { if (s.speaker === sp.id) s.speaker = into; });
      S.speakers = S.speakers.filter(o => o.id !== sp.id); persist(); render();
    };
    $('sps').appendChild(div);
  });
}

function renderFilters() {
  const todo = S.segments.filter(s => s.flags.length && !s.reviewed).length + S.missed.length;
  const opts = [['review', `⚠️ ត្រូវពិនិត្យ (${todo})`], ['all', `ទាំងអស់ (${S.segments.length})`],
                ...S.speakers.map(sp => [sp.id, label(sp)])];
  $('filters').innerHTML = '';
  opts.forEach(([id, text]) => {
    const b = document.createElement('button'); b.textContent = text; b.setAttribute('aria-pressed', filter === id);
    b.onclick = () => { filter = id; sel = 0; render(); }; $('filters').appendChild(b);
  });
  $('stats').textContent = `${S.speakers.length} តួ · ${S.segments.length} ឃ្លា · នៅសល់ពិនិត្យ ${todo}`;
}

function renderMap() {
  const T = total(); $('map').querySelectorAll('i').forEach(x => x.remove());
  S.segments.forEach(s => { const i = document.createElement('i'); i.style.left = (s.start / T * 100) + '%';
    i.style.width = Math.max(.15, (s.end - s.start) / T * 100) + '%'; i.style.background = color(s.speaker);
    if (s.flags.length && !s.reviewed) i.className = 'f'; $('map').appendChild(i); });
}
$('map').onclick = e => { const r = $('map').getBoundingClientRect(); au.currentTime = (e.clientX - r.left) / r.width * total(); };

function speakerSelect(value, extra) {
  return `<select class="who">${extra || ''}${S.speakers.map((sp, i) => `<option value="${sp.id}" ${sp.id === value ? 'selected' : ''}>${i < 9 ? (i + 1) + '. ' : ''}${label(sp)}</option>`).join('')}
    <option value="__new">＋ តួថ្មី</option><option value="drop">🗑 លុបចោល (មិនមែនសំឡេងតួ)</option></select>`;
}

function newSpeaker() {
  const id = 'N' + (nextNew++); while (S.speakers.some(s => s.id === id)) return newSpeaker();
  S.speakers.push({ id, name: '', new: true }); return id;
}

function setSpeaker(row, who) {
  if (who === '__new') who = newSpeaker();
  if (row.kind === 'missed') {
    S.missed = S.missed.filter(m => m.mid !== row.mid);
    if (who !== 'drop') S.segments.push({ id: 'm' + row.mid, start: row.start, end: row.end, speaker: who, confidence: 1, flags: [], reviewed: true });
  } else {
    const s = S.segments.find(x => x.id === row.id);
    if (who === 'drop') S.segments = S.segments.filter(x => x !== s); else { s.speaker = who; s.reviewed = true; }
  }
  persist(); render();
}

function split(row) {
  const s = S.segments.find(x => x.id === row.id); if (!s) return;
  const t = au.currentTime > s.start + .2 && au.currentTime < s.end - .2 ? au.currentTime : (s.start + s.end) / 2;
  const b = { ...s, id: s.id + 'b', start: +t.toFixed(3), reviewed: false };
  s.end = +t.toFixed(3); S.segments.splice(S.segments.indexOf(s) + 1, 0, b); persist(); render();
}

function render() {
  renderSpeakers(); renderFilters(); renderMap();
  const list = visible(); sel = Math.min(sel, Math.max(0, list.length - 1));
  const tb = $('rows'); tb.innerHTML = '';
  if (!list.length) tb.innerHTML = '<tr><td class="muted" style="padding:24px;text-align:center">✓ គ្មានឃ្លាត្រូវពិនិត្យទៀតទេ — ចុច “រក្សាទុក edits.json”</td></tr>';
  list.forEach((r, i) => {
    const tr = document.createElement('tr'); if (i === sel) tr.className = 'sel'; if (r.kind === 'missed') tr.classList.add('missed');
    const flags = r.kind === 'missed' ? '<span class="flag missed">ប្រហែលខ្វះ</span>'
      : r.reviewed ? '<span class="flag ok">✓ ពិនិត្យរួច</span>'
      : r.flags.map(f => `<span class="flag ${f}">${f === 'mixed' ? 'សំឡេង ២ ជាន់គ្នា' : 'មិនច្បាស់' + (r.alt ? ' (ឬ ' + r.alt + ')' : '')}</span>`).join('');
    tr.innerHTML = `<td><button class="pl">▶</button></td>
      <td class="t">${fmt(r.start)}<br><small>${(r.end - r.start).toFixed(1)}s</small></td>
      <td><span class="dot" style="display:inline-block;background:${r.kind === 'missed' ? 'transparent' : color(r.speaker)};border:1px solid var(--line)"></span>
        ${speakerSelect(r.kind === 'missed' ? '' : r.speaker, r.kind === 'missed' ? '<option value="" selected>ជ្រើសតួ ឬលុប…</option>' : '')}</td>
      <td>${flags}</td>
      <td class="t"><input class="num st" type="number" step="0.1" value="${r.start}"> – <input class="num en" type="number" step="0.1" value="${r.end}"></td>
      <td>${r.kind === 'seg' ? '<button class="ok" title="ត្រឹមត្រូវ">✓</button> <button class="sp2" title="កាត់ជាពីរ (នៅទីតាំងកំពុងស្ដាប់)">✂</button>' : ''}</td>`;
    tr.onclick = () => { if (sel !== i) { sel = i; [...tb.children].forEach((x, j) => x.classList.toggle('sel', j === i)); } };
    tr.querySelector('.pl').onclick = () => play(r.start, r.end);
    tr.querySelector('.who').onchange = e => setSpeaker(r, e.target.value);
    const edit = (k, v) => { const o = r.kind === 'missed' ? S.missed.find(m => m.mid === r.mid) : S.segments.find(x => x.id === r.id); o[k] = +(+v).toFixed(3); persist(); renderMap(); };
    tr.querySelector('.st').onchange = e => edit('start', e.target.value);
    tr.querySelector('.en').onchange = e => edit('end', e.target.value);
    if (r.kind === 'seg') {
      tr.querySelector('.ok').onclick = () => { S.segments.find(x => x.id === r.id).reviewed = true; persist(); render(); };
      tr.querySelector('.sp2').onclick = () => split(r);
    }
    tb.appendChild(tr);
  });
  tb.children[sel]?.scrollIntoView({ block: 'nearest' });
}

document.addEventListener('keydown', e => {
  if (['INPUT', 'SELECT'].includes(e.target.tagName)) return;
  const list = visible(), r = list[sel]; if (!r && e.key !== ' ') return;
  if (e.key === ' ') { e.preventDefault(); if (!au.paused) au.pause(); else if (r) play(r.start, r.end); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, list.length - 1); render(); const n = visible()[sel]; if (n) play(n.start, n.end); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); const n = visible()[sel]; if (n) play(n.start, n.end); }
  else if (/^[1-9]$/.test(e.key) && S.speakers[+e.key - 1]) setSpeaker(r, S.speakers[+e.key - 1].id);
  else if (e.key === 'Enter' && r.kind === 'seg') { S.segments.find(x => x.id === r.id).reviewed = true; persist(); render(); }
  else if ((e.key === 's' || e.key === 'S') && r.kind === 'seg') split(r);
  else if (e.key === 'Delete') setSpeaker(r, 'drop');
});

$('addsp').onclick = () => { newSpeaker(); persist(); render(); };
$('save').onclick = () => {
  const out = { episode: P.episode, created: P.created, speakers: S.speakers.filter(sp => S.segments.some(s => s.speaker === sp.id)),
                segments: S.segments, missed: S.missed.map(({ start, end }) => ({ start, end })) };
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
  a.download = 'edits.json'; a.click();
};
$('ep').textContent = P.episode;
render();
</script>
</body>
</html>
"""


if __name__ == "__main__":
    main()
