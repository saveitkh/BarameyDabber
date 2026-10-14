"""Make character IDs consistent across a whole video.

Gemini hears the video in ~90 s chunks that are transcribed independently, so "speaker_1" of one
chunk is not necessarily "speaker_1" of the next. Here every (chunk, local speaker) pair gets a
voiceprint (MFCC statistics + pitch, numpy only) and pairs that sound alike are merged into one
character. Rules that keep the cast clean:
  * a male and a female are never merged;
  * two different speakers heard in the same chunk are never merged (cannot-link);
  * a character with a single very short line is folded into the closest same-gender character.
"""

from collections import defaultdict

import numpy as np

from services import voice_check

SR = voice_check.SR
N_FFT = 512
HOP = 160
N_MEL = 40
N_MFCC = 20


def _mel_filterbank() -> np.ndarray:
    hz_to_mel = lambda f: 2595 * np.log10(1 + f / 700)
    mel_to_hz = lambda m: 700 * (10 ** (m / 2595) - 1)
    pts = mel_to_hz(np.linspace(hz_to_mel(80), hz_to_mel(SR / 2 - 200), N_MEL + 2))
    bins = np.floor((N_FFT + 1) * pts / SR).astype(int)
    fb = np.zeros((N_MEL, N_FFT // 2 + 1))
    for i in range(1, N_MEL + 1):
        l, c, r = bins[i - 1], bins[i], bins[i + 1]
        for k in range(l, c):
            fb[i - 1, k] = (k - l) / max(1, c - l)
        for k in range(c, r):
            fb[i - 1, k] = (r - k) / max(1, r - c)
    return fb


_FB = _mel_filterbank()
_DCT = np.cos(np.pi / N_MEL * (np.arange(N_MEL)[None, :] + 0.5) * np.arange(N_MFCC)[:, None])
_WIN = np.hanning(N_FFT)


def voiceprint(x: np.ndarray):
    """(mfcc_mean[19], log2_pitch) of the speech frames in x, or None when there is too little speech."""
    if len(x) < SR * 0.5:
        return None
    n = (len(x) - N_FFT) // HOP + 1
    if n < 20:
        return None
    idx = np.arange(N_FFT)[None, :] + HOP * np.arange(n)[:, None]
    frames = x[idx]
    energy = np.sqrt((frames ** 2).mean(axis=1) + 1e-12)
    keep = energy > max(0.01, np.percentile(energy, 40))  # speech frames, not the gaps between lines
    if keep.sum() < 15:
        return None
    spec = np.abs(np.fft.rfft(frames[keep] * _WIN, axis=1)) ** 2
    logmel = np.log(spec @ _FB.T + 1e-9)
    mfcc = logmel @ _DCT.T
    mfcc = mfcc[:, 1:]  # c0 is loudness
    pitch = voice_check._pitch_track(x)
    if len(pitch) < 8:
        return None
    return mfcc.mean(axis=0), float(np.log2(np.median(pitch)))


def _local_key(seg: dict):
    return (seg.get("_chunk", 0), seg.get("speaker_id") or "speaker_1")


def unify_speakers(segments: list, audio_path: str, merge_distance: float = 1.0) -> dict:
    """Rewrite speaker_id of every segment so one id = one voice across the video.
    Returns {new_id: [local keys]} for logging. Never raises: on any trouble the input is left as it was."""
    try:
        return _unify(segments, audio_path, merge_distance)
    except Exception as exc:  # noqa: BLE001 - clustering is an improvement, never a reason to fail a scan
        print(f"Speaker clustering skipped: {exc}")
        return {}


def _unify(segments: list, audio_path: str, merge_distance: float) -> dict:
    if not segments:
        return {}
    x = voice_check.load_audio(audio_path)

    groups = defaultdict(list)
    for s in segments:
        groups[_local_key(s)].append(s)

    keys = list(groups)
    info = {}
    for k in keys:
        segs = sorted(groups[k], key=lambda s: s["end_time"] - s["start_time"], reverse=True)
        genders = [s.get("gender") for s in segs]
        gender = "female" if genders.count("female") > genders.count("male") else "male"
        parts = []
        for s in segs[:8]:
            a, b = int(max(0, s["start_time"]) * SR), int(min(len(x) / SR, s["end_time"]) * SR)
            if b - a >= SR * 0.6:
                parts.append(x[a:b])
        vp = voiceprint(np.concatenate(parts)) if parts else None
        info[k] = {"gender": gender, "vp": vp, "lines": len(groups[k]), "secs": sum(s["end_time"] - s["start_time"] for s in segs), "first": min(s["start_time"] for s in segs)}

    usable = [k for k in keys if info[k]["vp"] is not None]
    if len(usable) >= 2:
        mf = np.array([info[k]["vp"][0] for k in usable])
        f0 = np.array([info[k]["vp"][1] for k in usable])
        mf_n = (mf - mf.mean(0)) / (mf.std(0) + 1e-6)
        scale = 1.0 / np.sqrt(mf.shape[1])
        pitch_scale = 1.0 / 0.18  # 0.18 octave ~ 3 semitones counts as "1 unit" of difference

        def dist(i, j):
            d_mfcc = float(np.linalg.norm(mf_n[i] - mf_n[j]) * scale)
            d_pitch = abs(float(f0[i] - f0[j])) * pitch_scale
            return 0.5 * d_mfcc + 0.5 * d_pitch

        D = np.array([[dist(i, j) for j in range(len(usable))] for i in range(len(usable))])
        clusters = [[i] for i in range(len(usable))]

        def allowed(a, b):
            ga = {info[usable[i]]["gender"] for i in a}
            gb = {info[usable[i]]["gender"] for i in b}
            if ga != gb:
                return False
            chunks_a = {usable[i][0]: set() for i in a}
            for i in a:
                chunks_a[usable[i][0]].add(usable[i][1])
            for j in b:
                c, sid = usable[j]
                if c in chunks_a and sid not in chunks_a[c]:
                    return False  # two voices heard together are two people
            return True

        def link(a, b):
            return float(np.mean([D[i, j] for i in a for j in b]))

        while True:
            best, pair = None, None
            for p in range(len(clusters)):
                for q in range(p + 1, len(clusters)):
                    if allowed(clusters[p], clusters[q]):
                        d = link(clusters[p], clusters[q])
                        if best is None or d < best:
                            best, pair = d, (p, q)
            if pair is None or best > merge_distance:
                break
            p, q = pair
            clusters[p] += clusters[q]
            del clusters[q]

        # A character with one tiny line is almost always a mis-heard piece of someone else
        def weight(c):
            return sum(info[usable[i]]["secs"] for i in c), sum(info[usable[i]]["lines"] for i in c)

        changed = True
        while changed and len(clusters) > 1:
            changed = False
            for c in list(clusters):
                secs, lines = weight(c)
                if lines > 1 or secs > 3.0:
                    continue
                cands = [o for o in clusters if o is not c and allowed(c, o)]
                if cands:
                    tgt = min(cands, key=lambda o: link(c, o))
                    tgt += c
                    clusters.remove(c)
                    changed = True
                    break
        member_of = {}
        for cid, c in enumerate(clusters):
            for i in c:
                member_of[usable[i]] = cid
    else:
        member_of = {k: n for n, k in enumerate(usable)}

    # keys without a usable voiceprint (very short) join the same-gender character they share a chunk's id with, else stay alone
    next_id = max(member_of.values(), default=-1) + 1
    for k in keys:
        if k not in member_of:
            member_of[k] = next_id
            next_id += 1

    first_seen = {}
    for k, cid in member_of.items():
        first_seen[cid] = min(first_seen.get(cid, 1e9), info[k]["first"])
    order = {cid: n + 1 for n, cid in enumerate(sorted(first_seen, key=first_seen.get))}
    result = defaultdict(list)
    for k, cid in member_of.items():
        new_id = f"speaker_{order[cid]}"
        result[new_id].append(k)
        for s in groups[k]:
            s["speaker_id"] = new_id
    # one gender per character, decided by majority of its lines
    by_id = defaultdict(list)
    for s in segments:
        by_id[s["speaker_id"]].append(s)
    for sid, segs in by_id.items():
        g = "female" if sum(1 for s in segs if s.get("gender") == "female") > len(segs) / 2 else "male"
        for s in segs:
            s["gender"] = g
    return dict(result)
