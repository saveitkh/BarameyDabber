"""Remove Chinese subtitles burned into the picture ("hard subs").

A burned-in subtitle is bright text with a dark outline, in one band of the picture (usually the
bottom), and it changes with every line of dialogue. That is what this module looks for:

1. find_band(): sample frames across the video and find the rows where outlined text keeps
   appearing while its content changes (a static logo is left to logo_remover).
2. find_lines(): read only that band, 4 times a second, and make a pixel mask of the text in each
   sample; samples with the same text become one subtitle line with a start/end time and the
   union of its masks.
3. remove(): rewrite the video; in every frame where a line is on screen, its text pixels are
   filled from the picture around them (normalised convolution: a blur that ignores the text
   itself, so no white glow is left), at growing radii so wide characters are filled too.

Nothing is changed when no subtitle band is found, so videos without hard subs are left alone.
"""

import json
import os
import subprocess
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np

from services import audio_processor

SAMPLE_FPS = float(os.getenv("SUBTITLE_SAMPLE_FPS", "4"))
BRIGHT = 150      # text fill (white / yellow / light colours)
DARK = 80         # its outline or shadow


def _probe(path: str) -> Optional[Tuple[int, int, float]]:
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height,r_frame_rate", "-of", "json", path], capture_output=True, text=True)
    try:
        s = json.loads(r.stdout)["streams"][0]
        num, den = (float(x) for x in s["r_frame_rate"].split("/"))
        return int(s["width"]), int(s["height"]), (num / den if den else 25.0)
    except Exception:
        return None


def _gray_frames(path: str, w: int, h: int, fps: float, crop: Optional[Tuple[int, int]] = None,
                 scale_w: Optional[int] = None):
    """Yield gray frames (optionally only rows crop=(y0, y1), optionally scaled to scale_w wide)."""
    vf = [f"fps={fps}"]
    out_w, out_h = w, h
    if crop:
        vf.append(f"crop={w}:{crop[1] - crop[0]}:0:{crop[0]}")
        out_h = crop[1] - crop[0]
    if scale_w and scale_w < w:
        out_h = max(2, int(round(out_h * scale_w / w / 2)) * 2)
        out_w = scale_w
        vf.append(f"scale={out_w}:{out_h}")
    vf.append("format=gray")
    proc = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-vf", ",".join(vf),
                             "-f", "rawvideo", "-"], stdout=subprocess.PIPE)
    size = out_w * out_h
    try:
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            yield np.frombuffer(buf, dtype=np.uint8).reshape(out_h, out_w)
    finally:
        proc.stdout.close()
        proc.wait()


def text_pixels(gray: np.ndarray, reach: int = 4) -> np.ndarray:
    """Bright pixels inside a thin stroke: a dark outline/shadow on BOTH sides (left and right, or
    above and below) within `reach`. The edge of a bright area has dark on one side only, so it is
    not taken for text."""
    bright = gray >= BRIGHT
    dark = gray <= DARK
    h, w = gray.shape

    def near(axis: int, sign: int) -> np.ndarray:
        out = np.zeros_like(dark)
        for d in range(1, reach + 1):
            if axis == 1:
                if sign > 0:
                    out[:, :w - d] |= dark[:, d:]
                else:
                    out[:, d:] |= dark[:, :w - d]
            else:
                if sign > 0:
                    out[:h - d, :] |= dark[d:, :]
                else:
                    out[d:, :] |= dark[:h - d, :]
        return out

    return bright & ((near(1, 1) & near(1, -1)) | (near(0, 1) & near(0, -1)))


def _clean(mask: np.ndarray, h_full: int, w_full: int, scale: float) -> np.ndarray:
    """Keep only blobs that look like a line of text: characters of about the same height, side by
    side on one baseline (or one long blob when the characters touch). Specks, tall shapes and
    lone blobs are dropped."""
    from scipy import ndimage
    if not mask.any():
        return np.zeros_like(mask)
    # Text lies in one or two dense rows (e.g. Chinese + English): keep only those rows, so a tall
    # thing touching the text (a pole, an edge in the scene) is cut off instead of hiding the line
    rowsum = mask.sum(axis=1)
    rows = ndimage.binary_dilation(rowsum >= 0.25 * rowsum.max(), iterations=max(1, int(round(3 * scale))))
    mask = mask & rows[:, None]
    grown = ndimage.binary_dilation(mask, iterations=max(1, int(round(3 * scale))))
    labels, n = ndimage.label(grown)
    if not n:
        return np.zeros_like(mask)
    boxes, small = [], []
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        if sl is None:
            continue
        hh = (sl[0].stop - sl[0].start) / scale
        ww = (sl[1].stop - sl[1].start) / scale
        if hh > 0.12 * h_full or ww > 0.9 * w_full:
            continue
        box = (i, (sl[0].start + sl[0].stop) / 2, sl[0].stop - sl[0].start, sl[1].start, sl[1].stop, sl[0].start, sl[0].stop)
        if hh < 0.018 * h_full or int(mask[sl][labels[sl] == i].sum()) < max(6, int(20 * scale * scale)):
            small.append(box)    # punctuation, dots: kept only beside a text line (below)
            continue
        boxes.append(box)
    keep = np.zeros(n + 1, dtype=bool)
    for i, cy, bh, x0, x1, _y0, _y1 in boxes:
        if x1 - x0 >= 2.5 * bh:          # touching characters: already a line (a thin diagonal is not)
            sl = (slice(_y0, _y1), slice(x0, x1))
            if (labels[sl] == i).mean() >= 0.3:
                keep[i] = True
            continue
        mates = [b for b in boxes if b[0] != i and abs(b[1] - cy) < 0.35 * bh and 0.5 < b[2] / bh < 2.0
                 and min(abs(b[3] - x1), abs(x0 - b[4])) < 1.5 * bh]
        if len(mates) >= 1:
            keep[i] = True
    kept = [b for b in boxes if keep[b[0]]]
    if kept:
        top, bottom = min(b[5] for b in kept), max(b[6] for b in kept)
        left, right = min(b[3] for b in kept), max(b[4] for b in kept)
        reach = max(b[2] for b in kept) * 1.5
        for i, _cy, _bh, x0, x1, y0, y1 in small + [b for b in boxes if not keep[b[0]]]:
            if y1 > top and y0 < bottom + 0.3 * (bottom - top) and x1 >= left - reach and x0 <= right + reach:
                keep[i] = True     # a comma, full stop or small mark inside the line
    return keep[labels] & grown


def find_band(path: str, size: Tuple[int, int, float], duration: float) -> Optional[Tuple[int, int]]:
    """(y0, y1) rows of the subtitle band in source pixels, or None."""
    w, h, _ = size
    work = min(640, w)
    scale = work / w
    fps = min(2.0, 48.0 / max(1.0, duration))
    frames = list(_gray_frames(path, w, h, fps, scale_w=work))
    if len(frames) < 6:
        return None
    maps = np.stack([text_pixels(f, reach=max(3, int(round(f.shape[0] / 80)))) for f in frames])
    # A logo stays in every frame; subtitle text comes and goes — ignore what never changes
    steady = maps.mean(axis=0) >= 0.8
    rows = []
    for m in maps:
        m = _clean(m & ~steady, h, w, scale)
        rows.append(m.sum(axis=1) >= max(3, int(0.004 * m.shape[1])))
    presence = np.mean(rows, axis=0)
    hit = presence >= 0.12
    if not hit.any():
        return None
    # The strongest run of rows (merging small gaps) is the band
    runs, start = [], None
    for y, v in enumerate(np.append(hit, False)):
        if v and start is None:
            start = y
        elif not v and start is not None:
            runs.append([start, y])
            start = None
    merged = [runs[0]]
    for r in runs[1:]:
        if r[0] - merged[-1][1] <= max(2, int(0.02 * len(hit))):
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    best = max(merged, key=lambda r: presence[r[0]:r[1]].sum())
    hh = len(hit)
    if (best[1] - best[0]) / hh > 0.3 or (best[1] - best[0]) / hh < 0.02:
        return None   # a quarter of the picture is not a subtitle line
    pad = int(0.025 * hh) + 2
    y0 = max(0, int((best[0] - pad) / scale))
    y1 = min(h, int((best[1] + pad) / scale) + 1)
    y0 -= y0 % 2
    y1 += y1 % 2
    return (y0, min(h, y1))


def find_lines(path: str, size: Tuple[int, int, float], band: Tuple[int, int],
               fps: float = SAMPLE_FPS) -> List[Dict]:
    """Subtitle lines in the band: [{start, end, mask (band-sized bool, full resolution)}]."""
    from scipy import ndimage
    w, h, _ = size
    lines: List[Dict] = []
    cur = None
    step = 1.0 / fps
    pad = max(2, int(round(h / 180)))     # cover the outline and anti-aliasing too
    reach = max(4, int(round(h / 80)))
    # Subtitle text holds still while the scene behind it moves: keep only text pixels that are
    # also there in the sample before or after (a 1-sample look-ahead), then judge the shapes.
    raw = (text_pixels(g, reach=reach) for g in _gray_frames(path, w, h, fps, crop=band))
    prev, cur_raw = None, next(raw, None)
    k = 0
    while cur_raw is not None:
        nxt = next(raw, None)
        steady = np.zeros_like(cur_raw)
        for other in (prev, nxt):
            if other is not None:
                steady |= cur_raw & other
        t = k * step
        m = _clean(steady, h, w, 1.0)
        prev, cur_raw = cur_raw, nxt
        k += 1
        if m.sum() < 40:
            if cur:
                lines.append(cur)
                cur = None
            continue
        m = ndimage.binary_dilation(m, iterations=pad)
        if cur is not None:
            inter = np.logical_and(m, cur["last"]).sum()
            union = np.logical_or(m, cur["last"]).sum()
            if union and inter / union >= 0.35:
                cur["mask"] |= m
                cur["last"] = m
                cur["end"] = t
                continue
            lines.append(cur)
        cur = {"start": t, "end": t, "mask": m.copy(), "last": m}
    if cur:
        lines.append(cur)
    out = []
    for ln in lines:
        # A subtitle stays at least ~0.5 s and sits around the middle; a passing bright object does not
        cols = np.where(ln["mask"].any(axis=0))[0]
        centre = (cols[0] + cols[-1]) / 2 / w
        if ln["end"] - ln["start"] < 2 * step - 1e-6 or not 0.2 <= centre <= 0.8:
            continue
        out.append({"start": max(0.0, ln["start"] - step * 0.75), "end": ln["end"] + step * 0.75, "mask": ln["mask"]})
    return out


class _Filler:
    """Fills one mask's pixels from their surroundings (normalised convolution: a blur that leaves
    the text itself out, so no glow remains), at growing radii so wide characters are filled too.
    The work is done at half resolution (the fill is smooth anyway) and the mask-only part is
    computed once per subtitle line, not per frame."""

    SIGMAS = (1.5, 3.5, 8.0, 18.0)   # in half-resolution pixels

    def __init__(self, mask: np.ndarray):
        from scipy import ndimage
        self.mask = mask
        h, w = mask.shape
        self.h2, self.w2 = (h + 1) // 2, (w + 1) // 2
        small = np.zeros((self.h2 * 2, self.w2 * 2), dtype=np.float32)
        small[:h, :w] = mask
        coverage = small.reshape(self.h2, 2, self.w2, 2).mean(axis=(1, 3))
        self.keep = (coverage == 0).astype(np.float32)          # half-res pixels with no text at all
        self.steps = []
        todo = coverage > 0
        for sigma in self.SIGMAS:
            den = ndimage.gaussian_filter(self.keep, sigma)
            ok = todo & (den > 0.02)
            if ok.any():
                self.steps.append((sigma, ok, den[ok]))
                todo &= ~ok
            if not todo.any():
                break

    def __call__(self, patch: np.ndarray) -> np.ndarray:
        from scipy import ndimage
        h, w = self.mask.shape
        img = np.zeros((self.h2 * 2, self.w2 * 2, 3), dtype=np.float32)
        img[:h, :w] = patch
        small = img.reshape(self.h2, 2, self.w2, 2, 3).mean(axis=(1, 3))
        filled = small.copy()
        for sigma, ok, den in self.steps:
            for c in range(3):
                num = ndimage.gaussian_filter(filled[..., c] * self.keep, sigma)
                filled[..., c][ok] = num[ok] / den
            # later radii also see what was filled already
        up = ndimage.zoom(filled, (2, 2, 1), order=1)[:h, :w]
        out = patch.copy()
        out[self.mask] = np.clip(up[self.mask], 0, 255).astype(np.uint8)
        return out


def remove(path: str, on_progress: Optional[Callable[[float], None]] = None) -> int:
    """Remove burned-in subtitles from the video at path, in place. Returns the number of lines removed."""
    size = _probe(path)
    duration = audio_processor.get_media_duration(path)
    if not size or duration < 2:
        return 0
    band = find_band(path, size, duration)
    if not band:
        print("Subtitle check: no burned-in subtitles found")
        return 0
    lines = find_lines(path, size, band)
    if not lines:
        print("Subtitle check: no subtitle lines found")
        return 0
    w, h, fps = size
    y0, y1 = band
    print(f"Subtitle check: {len(lines)} lines in rows {y0}-{y1} — removing")
    tmp = path + ".nosub.mp4"
    dec = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                           stdout=subprocess.PIPE)
    enc = subprocess.Popen(["ffmpeg", "-nostdin", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                            "-s", f"{w}x{h}", "-r", f"{fps:.5f}", "-i", "-", "-i", path,
                            "-map", "0:v", "-map", "1:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                            "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", tmp],
                           stdin=subprocess.PIPE)
    frame_bytes = w * h * 3
    total = max(1, int(duration * fps))
    k, li = 0, 0
    fillers: Dict[tuple, tuple] = {}
    try:
        while True:
            buf = dec.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            t = k / fps
            while li < len(lines) and lines[li]["end"] < t:
                li += 1
            active = [n for n in range(li, min(li + 3, len(lines))) if lines[n]["start"] <= t <= lines[n]["end"]]
            if active:
                key = tuple(active)
                if key not in fillers:
                    fillers.clear()   # earlier lines are done
                    mask = lines[active[0]]["mask"] if len(active) == 1 else np.logical_or.reduce([lines[n]["mask"] for n in active])
                    rows = np.where(mask.any(axis=1))[0]
                    cols = np.where(mask.any(axis=0))[0]
                    m = int(40 * h / 720) + 4
                    box = (max(0, rows[0] - m), min(mask.shape[0], rows[-1] + m + 1), max(0, cols[0] - m), min(w, cols[-1] + m + 1))
                    fillers[key] = (box, _Filler(mask[box[0]:box[1], box[2]:box[3]]))
                (ry0, ry1, rx0, rx1), filler = fillers[key]
                frame = np.frombuffer(buf, dtype=np.uint8).reshape(h, w, 3).copy()
                frame[y0 + ry0:y0 + ry1, rx0:rx1] = filler(frame[y0 + ry0:y0 + ry1, rx0:rx1])
                buf = frame.tobytes()
            enc.stdin.write(buf)
            k += 1
            if on_progress and k % 250 == 0:
                on_progress(min(1.0, k / total))
    finally:
        dec.stdout.close()
        dec.wait()
        enc.stdin.close()
        enc.wait()
    if enc.returncode == 0 and os.path.exists(tmp) and os.path.getsize(tmp) > 1000:
        os.replace(tmp, path)
        return len(lines)
    if os.path.exists(tmp):
        os.remove(tmp)
    print("Subtitle removal failed — the video is left as it was")
    return 0
