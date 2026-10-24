"""Make character IDs consistent across a whole video.

Gemini hears the video in ~90 s chunks that are transcribed independently, so "speaker_1" of one
chunk is not necessarily "speaker_1" of the next. Here every (chunk, local speaker) pair gets a
voiceprint (MFCC and spectrum statistics, numpy only) and pairs that sound alike are merged into one
character. Rules that keep the cast clean:
  * a male and a female are merged only when they sound almost identical (a mis-heard label);
  * a whole character whose pitch is far outside the labelled gender is corrected;
  * two different speakers heard in the same chunk are never merged (cannot-link);
  * a character with a single very short line is folded into the closest same-gender character.
"""

import json
import os
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


def _load_norm():
    """Fixed normalisation measured on the voice bank (samples/), so one video with only two
    or three voices does not collapse the statistics the way per-video z-scores did."""
    try:
        with open(os.path.join(os.path.dirname(__file__), "speaker_norm.json"), encoding="utf-8") as f:
            d = json.load(f)
        return np.array(d["mu"]), np.array(d["sd"])
    except Exception:
        return None, None


_MU, _SD = _load_norm()


def voiceprint(x: np.ndarray):
    """(voice vector, log2_pitch) of the speech frames in x, or None when there is too little speech.

    The vector is MFCC mean + MFCC spread + long-term spectrum shape. On the labelled voice bank
    this tells two people apart about twice as reliably as the old MFCC-mean + pitch mix (pitch
    moves too much with emotion inside one actor to identify them)."""
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
    mfcc = (logmel @ _DCT.T)[:, 1:]  # c0 is loudness
    vec = np.concatenate([mfcc.mean(axis=0), mfcc.std(axis=0), (logmel - logmel.mean(axis=1, keepdims=True)).mean(axis=0)])
    if _MU is not None and len(_MU) == len(vec):
        vec = (vec - _MU) / _SD
    pitch = voice_check._pitch_track(x)
    if len(pitch) < 8:
        return None
    return vec, float(np.log2(np.median(pitch)))


def voice_distance(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine distance of two voice vectors (0 = same sound, 1+ = unrelated)."""
    return 1.0 - float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


def _local_key(seg: dict):
    return (seg.get("_chunk", 0), seg.get("speaker_id") or "speaker_1")


# Voices closer than this are one character. Chosen on the voice bank so that two different
# people are rarely merged (a merge the user cannot see is worse than an extra character they
# can merge with one tap).
MERGE_DISTANCE = 0.42
PITCH_FREE_OCTAVES = 0.3


def unify_speakers(segments: list, audio_path: str, merge_distance: float = MERGE_DISTANCE) -> dict:
    """Rewrite speaker_id of every segment so one id = one voice across the video.
    Returns {new_id: [local keys]} for logging. Never raises: on any trouble the input is left as it was."""
    try:
        return _unify(segments, audio_path, merge_distance)
    except Exception as exc:  # noqa: BLE001 - clustering is an improvement, never a reason to fail a scan
        print(f"Speaker clustering skipped: {exc}")
        return {}


# Gemini's label (it hears the voice and the story) decides a character's gender. Pitch only
# corrects the clear cases, on a whole character, never on one short piece: on the labelled
# voice bank no man stays above ~265 Hz and only a few low women go under ~140 Hz.
F0_FEMALE_MIN = 265.0
F0_MALE_MAX = 120.0
# Two pieces whose labels disagree are merged only when they sound almost identical AND the
# odd piece's own pitch points the other way (a "man" at 200+ Hz, a "woman" at 160- Hz).
CROSS_GENDER_DISTANCE = 0.3
MISHEARD_MALE_F0 = 190.0
MISHEARD_FEMALE_F0 = 160.0


def _pitch_gender(f0: float, said: str, role: str) -> str:
    """The gender after the pitch check; children keep their label (a boy can be very high)."""
    if not f0 or role == "child":
        return said
    if said == "male" and f0 >= F0_FEMALE_MIN:
        return "female"
    if said == "female" and f0 <= F0_MALE_MAX:
        return "male"
    return said


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
        said = "female" if genders.count("female") > genders.count("male") else "male"
        roles = [s.get("speaker_role") or "" for s in segs]
        role = max(set(roles), key=roles.count) if roles else ""
        parts = []
        for s in segs[:8]:
            a, b = int(max(0, s["start_time"]) * SR), int(min(len(x) / SR, s["end_time"]) * SR)
            if b - a >= SR * 0.6:
                parts.append(x[a:b])
        vp = voiceprint(np.concatenate(parts)) if parts else None
        f0 = float(2 ** vp[1]) if vp is not None else 0.0
        info[k] = {"gender": said, "role": role, "vp": vp, "f0": f0,
                   "lines": len(groups[k]), "secs": sum(s["end_time"] - s["start_time"] for s in segs),
                   "first": min(s["start_time"] for s in segs)}

    usable = [k for k in keys if info[k]["vp"] is not None]
    if len(usable) >= 2:
        vecs = [info[k]["vp"][0] for k in usable]
        logf0 = [info[k]["vp"][1] for k in usable]

        def dist(i, j):
            # an actor's pitch moves with emotion, so only a gap of more than ~4 semitones counts
            return voice_distance(vecs[i], vecs[j]) + max(0.0, abs(logf0[i] - logf0[j]) - PITCH_FREE_OCTAVES)

        D = np.array([[dist(i, j) for j in range(len(usable))] for i in range(len(usable))])
        clusters = [[i] for i in range(len(usable))]

        def gender_of(c):
            fem = sum(info[usable[i]]["secs"] for i in c if info[usable[i]]["gender"] == "female")
            return "female" if fem * 2 > sum(info[usable[i]]["secs"] for i in c) else "male"

        def heard_together(a, b):
            chunks_a = defaultdict(set)
            for i in a:
                chunks_a[usable[i][0]].add(usable[i][1])
            for j in b:
                c, sid = usable[j]
                if c in chunks_a and sid not in chunks_a[c]:
                    return True  # two voices heard together are two people
            return False

        def link(a, b):
            return float(np.mean([D[i, j] for i in a for j in b]))

        def weight(c):
            return sum(info[usable[i]]["secs"] for i in c), sum(info[usable[i]]["lines"] for i in c)

        def misheard(c, as_gender):
            """Every piece of c sits at a pitch that fits as_gender better than its own label."""
            for i in c:
                f = info[usable[i]]["f0"]
                if not f or (as_gender == "female" and f < MISHEARD_MALE_F0) or (as_gender == "male" and f > MISHEARD_FEMALE_F0):
                    return False
            return True

        def mergeable(a, b, d):
            if heard_together(a, b):
                return False
            ga, gb = gender_of(a), gender_of(b)
            if ga == gb:
                return True
            if d > CROSS_GENDER_DISTANCE:
                return False
            return misheard(a, gb) or misheard(b, ga)

        while True:
            best, pair = None, None
            for p in range(len(clusters)):
                for q in range(p + 1, len(clusters)):
                    d = link(clusters[p], clusters[q])
                    if (best is None or d < best) and mergeable(clusters[p], clusters[q], d):
                        best, pair = d, (p, q)
            if pair is None or best > merge_distance:
                break
            p, q = pair
            gp, gq = gender_of(clusters[p]), gender_of(clusters[q])
            if gp != gq:
                # the mis-heard side (its pitch fits the other gender) takes the other side's gender
                odd, to = (clusters[q], gp) if misheard(clusters[q], gp) else (clusters[p], gq)
                for i in odd:
                    info[usable[i]]["gender"] = to
            clusters[p] += clusters[q]
            del clusters[q]

        # A character with one tiny line is almost always a mis-heard piece of someone else
        changed = True
        while changed and len(clusters) > 1:
            changed = False
            for c in list(clusters):
                secs, lines = weight(c)
                if lines > 1 or secs > 3.0:
                    continue
                cands = [o for o in clusters if o is not c and not heard_together(c, o) and gender_of(c) == gender_of(o)]
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

    # keys without a usable voiceprint (very short) stay their own character
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

    # One gender per character: the (pitch-checked) label weighted by how long each piece speaks,
    # then the pitch check once more on the whole character. Each line also carries the
    # character's typical pitch so the standard AI voice can sit high or low like the actor.
    for new_id, members in result.items():
        secs = sum(info[k]["secs"] for k in members) or 1.0
        fem = sum(info[k]["secs"] for k in members if info[k]["gender"] == "female")
        gender = "female" if fem * 2 > secs else "male"
        voiced = [(info[k]["f0"], info[k]["secs"]) for k in members if info[k]["f0"]]
        f0_char = float(2 ** (sum(np.log2(f) * w for f, w in voiced) / sum(w for _, w in voiced))) if voiced else 0.0
        roles = [info[k]["role"] for k in members]
        gender = _pitch_gender(f0_char, gender, max(set(roles), key=roles.count) if roles else "")
        for k in members:
            for s in groups[k]:
                s["gender"] = gender
                if f0_char:
                    s["voice_f0"] = round(f0_char)
    return dict(result)
