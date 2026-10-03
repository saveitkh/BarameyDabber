#!/usr/bin/env python3
"""
voice_split_offline.py — Lightweight speaker separation for dialogue audio.

No internet / no deep-learning model required (works with just numpy,
scipy, scikit-learn + ffmpeg on PATH). Good enough as a first-pass splitter
for anime/donghua dubbing source audio where one true neural speaker-ID
model (pyannote, etc.) isn't available offline.

Pipeline:
  1. Decode input audio to 16kHz mono WAV via ffmpeg.
  2. Voice-activity detection: frame RMS energy vs a rolling noise-floor
     percentile (handles audio with background music, since dialogue is
     usually mixed louder than the BGM bed).
  3. Per-segment features: mean+std of 13 MFCCs, plus median pitch (F0)
     and voiced-frame ratio from autocorrelation pitch tracking.
  4. Cluster segments with Agglomerative (Ward) clustering; auto-picks k
     (2-6) by best silhouette score, or pass --k to force it.
  5. Stitch each cluster's segments back together (in time order, small
     gap between clips) into one audio file per detected speaker, plus
     a timeline JSON mapping each clip back to its original timestamp.

CAVEAT: this is acoustic-feature clustering, not true speaker
recognition. It works best when speakers differ noticeably in pitch/
timbre and dialogue is louder than background music. Expect some
mixing between speakers, especially with >3-4 voices or heavy BGM.
For a precise cut, give explicit start/end timestamps instead.

Usage:
    python3 scripts/voice_split_offline.py input.mp4 --outdir out/ [--k 3] [--min-dur 0.35]

Outputs (in --outdir):
    speaker_0.wav, speaker_1.wav, ...   (stitched per-speaker audio)
    speaker_N_timeline.json             (original timestamps per clip)
    segments.json                       (all VAD segments + cluster id)
"""
import argparse
import json
import os
import subprocess
import sys
import wave

import numpy as np
from scipy.fftpack import dct
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler


def decode_to_wav(src_path, wav_path, sr=16000):
    subprocess.run(
        ["ffmpeg", "-y", "-i", src_path, "-ac", "1", "-ar", str(sr), wav_path],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def load_wav(path):
    with wave.open(path, "rb") as w:
        sr = w.getframerate()
        n = w.getnframes()
        raw = w.readframes(n)
    data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    return data, sr


def write_wav(path, data, sr):
    data = np.clip(data, -1, 1)
    pcm = (data * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


# ---------------- VAD ----------------

def detect_speech_segments(audio, sr, margin_db=6.0, min_dur=0.35,
                            merge_gap=0.25, max_dur=6.0):
    frame_len = int(0.025 * sr)
    hop_len = int(0.010 * sr)
    n_frames = 1 + (len(audio) - frame_len) // hop_len
    idx = np.arange(frame_len)[None, :] + hop_len * np.arange(n_frames)[:, None]
    frames = audio[idx]

    rms = np.sqrt(np.mean(frames ** 2, axis=1) + 1e-12)
    rms_db = 20 * np.log10(rms + 1e-9)

    win_frames = int(3.0 / 0.010)
    half = win_frames // 2
    pad = np.pad(rms_db, (half, half), mode="edge")
    floor = np.array([np.percentile(pad[i:i + win_frames], 25)
                       for i in range(len(rms_db))])

    mask = rms_db > (floor + margin_db)

    segs, in_seg, start = [], False, 0
    for i, m in enumerate(mask):
        if m and not in_seg:
            in_seg, start = True, i
        elif not m and in_seg:
            in_seg = False
            segs.append([start, i])
    if in_seg:
        segs.append([start, len(mask)])

    gap_frames = int(merge_gap / 0.010)
    merged = []
    for s in segs:
        if merged and s[0] - merged[-1][1] <= gap_frames:
            merged[-1][1] = s[1]
        else:
            merged.append(s)

    min_frames = int(min_dur / 0.010)
    max_frames = int(max_dur / 0.010)
    out = []
    for s, e in merged:
        if e - s < min_frames:
            continue
        while e - s > max_frames:
            out.append((s, s + max_frames))
            s += max_frames
        out.append((s, e))

    return [(s * hop_len / sr, e * hop_len / sr) for s, e in out]


# ---------------- Features ----------------

def _mel_filterbank(sr, n_fft=512, n_mels=26, low=50):
    def hz2mel(f): return 2595 * np.log10(1 + f / 700)
    def mel2hz(m): return 700 * (10 ** (m / 2595) - 1)
    pts = np.linspace(hz2mel(low), hz2mel(sr / 2), n_mels + 2)
    hz = mel2hz(pts)
    bins = np.floor((n_fft + 1) * hz / sr).astype(int)
    fb = np.zeros((n_mels, n_fft // 2 + 1))
    for m in range(1, n_mels + 1):
        a, b, c = bins[m - 1], bins[m], bins[m + 1]
        for k in range(a, b):
            if b > a:
                fb[m - 1, k] = (k - a) / (b - a)
        for k in range(b, c):
            if c > b:
                fb[m - 1, k] = (c - k) / (c - b)
    return fb


def extract_features(audio, sr, segments, n_fft=512, n_mels=26, n_mfcc=13):
    frame_len, hop_len = 400, 160  # 25ms / 10ms @16kHz
    window = np.hamming(frame_len)
    fbank = _mel_filterbank(sr, n_fft, n_mels)

    def mfcc(sig):
        n = len(sig)
        if n < frame_len:
            sig = np.pad(sig, (0, frame_len - n)); n = len(sig)
        n_fr = 1 + (n - frame_len) // hop_len
        if n_fr < 1:
            return np.zeros((1, n_mfcc))
        idx = np.arange(frame_len)[None, :] + hop_len * np.arange(n_fr)[:, None]
        fr = sig[idx] * window
        mag = np.abs(np.fft.rfft(fr, n=n_fft, axis=1))
        power = (mag ** 2) / n_fft
        mel = np.maximum(power @ fbank.T, np.finfo(float).eps)
        return dct(np.log(mel), type=2, axis=1, norm="ortho")[:, :n_mfcc]

    def pitch(sig, fmin=70, fmax=400):
        n_fr = 1 + (len(sig) - frame_len) // hop_len
        if n_fr < 1:
            return 0.0, 0.0
        lag_min, lag_max = int(sr / fmax), int(sr / fmin)
        pitches = []
        for i in range(n_fr):
            fr = sig[i * hop_len:i * hop_len + frame_len] * window
            fr = fr - fr.mean()
            if np.max(np.abs(fr)) < 1e-4:
                continue
            ac = np.correlate(fr, fr, mode="full")[len(fr) - 1:]
            if lag_max >= len(ac) or ac[0] <= 0:
                continue
            seg = ac[lag_min:lag_max]
            if len(seg) == 0:
                continue
            p = np.argmax(seg)
            if seg[p] / ac[0] > 0.3:
                lag = lag_min + p
                if lag > 0:
                    pitches.append(sr / lag)
        if not pitches:
            return 0.0, 0.0
        return float(np.median(pitches)), float(len(pitches) / n_fr)

    feats = []
    for s, e in segments:
        sig = audio[int(s * sr):int(e * sr)]
        m = mfcc(sig)
        p_med, v_ratio = pitch(sig)
        feats.append(np.concatenate([m.mean(0), m.std(0), [p_med, v_ratio]]))
    return np.array(feats)


# ---------------- Clustering ----------------

def cluster_segments(feats, k=None, k_range=(2, 6)):
    X = StandardScaler().fit_transform(feats)
    if k:
        return AgglomerativeClustering(n_clusters=k, linkage="ward").fit_predict(X), k, None
    best = (None, -2, None)
    for kk in range(*k_range, 1) if k_range[1] >= k_range[0] else []:
        pass
    for kk in range(k_range[0], k_range[1] + 1):
        labels = AgglomerativeClustering(n_clusters=kk, linkage="ward").fit_predict(X)
        try:
            score = silhouette_score(X, labels)
        except Exception:
            score = -2
        if score > best[1]:
            best = (labels, score, kk)
    return best[0], best[2], best[1]


# ---------------- Export ----------------

def export_clusters(audio, sr, segments, labels, k, outdir, gap_s=0.15):
    os.makedirs(outdir, exist_ok=True)
    gap = np.zeros(int(gap_s * sr), dtype=np.float32)
    all_segs = []
    for c in range(k):
        idx = sorted([i for i, l in enumerate(labels) if l == c],
                     key=lambda i: segments[i][0])
        chunks, timeline, cursor = [], [], 0.0
        for i in idx:
            s, e = segments[i]
            clip = audio[int(s * sr):int(e * sr)]
            chunks.append(clip); chunks.append(gap)
            timeline.append({"orig_start": s, "orig_end": e, "new_start": cursor})
            cursor += len(clip) / sr + len(gap) / sr
            all_segs.append({"start": s, "end": e, "speaker": c})
        if not chunks:
            continue
        write_wav(os.path.join(outdir, f"speaker_{c}.wav"), np.concatenate(chunks), sr)
        json.dump(timeline, open(os.path.join(outdir, f"speaker_{c}_timeline.json"), "w"))
    json.dump(sorted(all_segs, key=lambda d: d["start"]),
               open(os.path.join(outdir, "segments.json"), "w"), indent=2)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="input audio/video file (any ffmpeg-readable format)")
    ap.add_argument("--outdir", default="voice_split_out")
    ap.add_argument("--k", type=int, default=None, help="force number of speakers (default: auto 2-6)")
    ap.add_argument("--margin-db", type=float, default=6.0, help="speech-above-floor threshold in dB")
    ap.add_argument("--min-dur", type=float, default=0.35, help="minimum segment duration (s)")
    ap.add_argument("--keep-wav", action="store_true", help="keep intermediate 16k wav")
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    wav_path = os.path.join(args.outdir, "_source_16k.wav")
    print("Decoding audio...", file=sys.stderr)
    decode_to_wav(args.input, wav_path)
    audio, sr = load_wav(wav_path)

    print("Detecting speech segments...", file=sys.stderr)
    segments = detect_speech_segments(audio, sr, margin_db=args.margin_db, min_dur=args.min_dur)
    print(f"  {len(segments)} segments, {sum(e-s for s,e in segments):.1f}s total", file=sys.stderr)

    print("Extracting features...", file=sys.stderr)
    feats = extract_features(audio, sr, segments)

    print("Clustering...", file=sys.stderr)
    labels, k, score = cluster_segments(feats, k=args.k)
    print(f"  k={k}" + (f" silhouette={score:.3f}" if score is not None else ""), file=sys.stderr)
    for c in range(k):
        n = int((labels == c).sum())
        print(f"  speaker_{c}: {n} segments", file=sys.stderr)

    print("Exporting per-speaker audio...", file=sys.stderr)
    export_clusters(audio, sr, segments, labels, k, args.outdir)

    if not args.keep_wav:
        os.remove(wav_path)

    print(f"Done. Output in {args.outdir}/", file=sys.stderr)


if __name__ == "__main__":
    main()
