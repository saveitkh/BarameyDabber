"""Is this recording good enough to clone a voice from?

Measures what actually decides clone quality and answers in Khmer with concrete fixes:
length of real speech, background noise / music, clipping, level, bandwidth (low-bitrate
sources) and whether more than one voice seems to be present. numpy only.
"""

import subprocess

import numpy as np

SR = 16000
FRAME = int(0.04 * SR)
HOP = int(0.02 * SR)


def load_audio(path: str, sr: int = SR) -> np.ndarray:
    out = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
        capture_output=True, timeout=120,
    )
    if out.returncode != 0 or not out.stdout:
        raise ValueError("មិនអាចអានឯកសារសំឡេងនេះបានទេ")
    return np.frombuffer(out.stdout, dtype=np.float32).copy()


def _frames_db(x: np.ndarray) -> np.ndarray:
    n = max(1, (len(x) - FRAME) // HOP + 1)
    idx = np.arange(FRAME)[None, :] + HOP * np.arange(n)[:, None]
    rms = np.sqrt((x[idx] ** 2).mean(axis=1) + 1e-12)
    return 20 * np.log10(rms)


def _hf_db(path: str) -> float:
    """Energy at 8-12 kHz relative to the speech band (0.3-3.4 kHz), in dB.
    Clean studio speech is about -35 to -45; voices taken from compressed movie audio sit near -55;
    phone / 8 kHz material is below -90."""
    x = load_audio(path, 48000)
    n = 2048
    frames = (len(x) - n) // n
    if frames < 1:
        return 0.0
    win = np.hanning(n)
    spec = np.zeros(n // 2 + 1)
    for i in range(min(frames, 500)):
        spec += np.abs(np.fft.rfft(x[i * n:(i + 1) * n] * win)) ** 2
    f = np.fft.rfftfreq(n, 1 / 48000)
    band = lambda lo, hi: 10 * np.log10(spec[(f >= lo) & (f < hi)].sum() + 1e-12)
    return float(band(8000, 12000) - band(300, 3400))


def _pitch_track(x: np.ndarray) -> np.ndarray:
    lo, hi = int(SR / 400), int(SR / 60)
    out = []
    win = np.hanning(FRAME)
    for i in range(0, len(x) - FRAME, HOP):
        f = x[i:i + FRAME] * win
        if np.sqrt((f ** 2).mean()) < 0.01:
            continue
        ac = np.correlate(f, f, mode="full")[FRAME - 1:]
        ac = ac / (ac[0] + 1e-9)
        k = int(np.argmax(ac[lo:hi])) + lo
        if ac[k] < 0.5:
            continue
        for m in (4, 3, 2):  # prefer the true period over a harmonic (octave-up error)
            kk = k * m
            if kk < hi and kk + 4 < len(ac):
                seg = ac[kk - 3:kk + 4]
                if seg.max() >= 0.9 * ac[k]:
                    k = kk - 3 + int(np.argmax(seg))
                    break
        out.append(SR / k)
    return np.array(out)


def analyze(path: str) -> dict:
    x = load_audio(path)
    total = len(x) / SR
    if total < 0.5:
        raise ValueError("សំឡេងខ្លីពេក")
    db = _frames_db(x)
    p10, p90 = np.percentile(db, 10), np.percentile(db, 90)
    speech = db > max(p90 - 25, -55)
    speech_s = float(speech.sum() * HOP / SR)
    snr = float(p90 - p10)
    peak = float(np.abs(x).max())
    clipped = float((np.abs(x) >= 0.99).mean())
    speech_rms_db = float(np.mean(db[speech])) if speech.any() else -99.0
    f0 = _pitch_track(x)
    voiced = len(f0) * HOP / SR
    med = float(np.median(f0)) if len(f0) else 0.0
    # share of voiced frames far from the main pitch: another speaker, or wild intonation
    off = float(np.mean((f0 < 0.6 * med) | (f0 > 1.7 * med))) if len(f0) > 30 else 0.0
    return dict(total=total, speech=speech_s, snr=snr, peak=peak, clipped=clipped, level=speech_rms_db,
                f0_median=med, off_pitch=off, voiced=voiced, hf_db=_hf_db(path))


def check(path: str, has_transcript: bool = False) -> dict:
    m = analyze(path)
    score, tips, notes, cap = 100, [], [], 100

    def bad(points, tip, severe=False):
        """A severe defect alone makes the recording unfit, however good the rest is."""
        nonlocal score, cap
        score -= points
        tips.append(tip)
        if severe:
            cap = 50

    s = m["speech"]
    if s < 3:
        bad(45, f"សំឡេងនិយាយមានតែ {s:.0f} វិនាទី — ខ្លីពេក។ ត្រូវការ ៦–១៥ វិនាទី", severe=True)
    elif s < 6:
        bad(18, f"សំឡេងនិយាយ {s:.0f} វិនាទី — ខ្លីបន្តិច។ ល្អបំផុត ៨–១៥ វិនាទី")
    elif s > 40:
        notes.append("វែងជាង ១៥ វិនាទី — ប្រព័ន្ធកាត់យកតែ ១៥ វិនាទីដំបូង (លើកលែងតែមានអត្ថបទ)។")
    if m["snr"] < 14:
        bad(35, "មានសំឡេងរំខាន/ភ្លេងផ្ទៃខាងក្រោយខ្លាំង — ក្លូននឹងចម្លងវាដែរ។ ប្រើជម្រើស «ពីវីដេអូ» (ដកភ្លេង) ឬថតនៅកន្លែងស្ងាត់", severe=True)
    elif m["snr"] < 22:
        bad(14, "មានសំឡេងរំខានបន្តិច — ថតនៅកន្លែងស្ងាត់ជាងនេះ ឬដកភ្លេងមុន")
    if m["clipped"] > 0.003:
        bad(25, "សំឡេងខ្លាំងពេកហើយបែក (clipping) — ថតម្ដងទៀតដោយបន្ថយកម្រិតសំឡេង", severe=True)
    if m["level"] < -38:
        bad(12, "សំឡេងស្ងាត់ពេក — ថតជិតមាត់ជាងនេះ (ប្រព័ន្ធនឹងធ្វើឲ្យស្មើគ្នាបន្តិច ប៉ុន្តែគុណភាពនឹងធ្លាក់)")
    if m["hf_db"] < -90:
        bad(25, "ឯកសារដូចសំឡេងទូរស័ព្ទ/MP3 ទាបខ្លាំង (គ្មានសំឡេងកម្រិតខ្ពស់) — ប្រើឯកសារដើម WAV ឬ M4A គុណភាពខ្ពស់", severe=True)
    elif m["hf_db"] < -65:
        bad(12, "សំឡេងបាត់កម្រិតខ្ពស់ (ប្រហែលចេញពីវីដេអូ/MP3 បង្ហាប់) — ក្លូនបាន តែសំឡេងនឹងស្រពោនបន្តិច។ ឯកសារថតដើមនឹងច្បាស់ជាង")
    if m["off_pitch"] > 0.35:
        bad(30, "ស្តាប់ទៅដូចមានមនុស្សលើសពីម្នាក់ ឬសំឡេងប្រែប្រួលខ្លាំងពេក — ក្លូនត្រូវការមនុស្សតែម្នាក់ និយាយធម្មតា។ សូមស្ដាប់ពិនិត្យ")
    elif m["off_pitch"] > 0.18:
        bad(10, "ឃ្លាខ្លះមានកម្រិតសំឡេងខុសពីធម្មតា (អាចមានសំឡេងម្នាក់ទៀតលាយ ឬនិយាយខ្លាំង) — សូមស្ដាប់ពិនិត្យ ហើយកាត់ចេញបើមិនមែនតួនេះ")
    if m["voiced"] < 2.5 and s >= 3:
        bad(15, "រកឮសំឡេងនិយាយមិនសូវបាន (ភ្លេង/ខ្សឹប?) — ត្រូវការសំឡេងមនុស្សនិយាយច្បាស់")
    if not has_transcript:
        notes.append("ចង់ឲ្យដូចជាងនេះ៖ បញ្ចូលអត្ថបទដែលនិយាយក្នុងសំឡេង (ពាក្យត្រូវគ្នា ១០០%) — ប្រព័ន្ធប្រើរបៀប «Ultimate Cloning»។")
    score = max(0, min(cap, score))
    verdict = "good" if score >= 80 else "ok" if score >= 55 else "poor"
    return dict(
        score=score, verdict=verdict,
        label={"good": "ល្អ — ក្លូនបានច្បាស់", "ok": "ប្រើបាន — តែអាចកែឲ្យល្អជាង", "poor": "មិនល្អ — ក្លូននឹងមិនច្បាស់"}[verdict],
        tips=tips, notes=notes,
        metrics={k: (round(v, 2) if isinstance(v, float) else v) for k, v in m.items()},
    )
