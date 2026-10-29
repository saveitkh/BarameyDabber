"""Find and remove a channel logo / watermark burned into a video (e.g. "至尊 bilibili").

A logo stays in the same place while the scenes behind it change. We sample frames across
the whole video, keep the edges that are there in almost every frame, and turn those spots
into boxes. FFmpeg's delogo filter then fills each box from the pixels around it.

Safety: a video whose picture hardly changes (one static shot) has persistent edges
everywhere — then nothing is removed rather than smearing part of the picture. Black
letterbox bars, very thin lines and anything in the middle of the picture are ignored.
"""

import os
import subprocess
from typing import List, Optional, Tuple

import numpy as np

from services import audio_processor

SAMPLE_FRAMES = int(os.getenv("LOGO_SAMPLE_FRAMES", "16"))
WORK_WIDTH = 480
Box = Tuple[int, int, int, int]  # x, y, w, h in source pixels


def _video_size(path: str) -> Optional[Tuple[int, int]]:
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height", "-of", "csv=p=0:s=x", path], capture_output=True, text=True)
    try:
        w, h = (int(v) for v in r.stdout.strip().split("\n")[0].split("x")[:2])
        return w, h
    except Exception:
        return None


def _frames(path: str, duration: float, width: int, height: int) -> List[np.ndarray]:
    """Gray frames (WORK_WIDTH wide) at evenly spread times between 5% and 95% of the video."""
    out = []
    for k in range(SAMPLE_FRAMES):
        t = duration * (0.05 + 0.9 * k / max(1, SAMPLE_FRAMES - 1))
        r = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{t:.2f}", "-i", path, "-frames:v", "1",
                            "-vf", f"scale={width}:{height},format=gray", "-f", "rawvideo", "-"], capture_output=True)
        if len(r.stdout) == width * height:
            out.append(np.frombuffer(r.stdout, dtype=np.uint8).reshape(height, width).astype(np.float32))
    return out


def _edges(g: np.ndarray) -> np.ndarray:
    mag = np.zeros_like(g)
    mag[:, 1:] += np.abs(np.diff(g, axis=1))
    mag[1:, :] += np.abs(np.diff(g, axis=0))
    return mag > max(30.0, float(np.percentile(mag, 92)))


def detect_logo_boxes(path: str) -> List[Box]:
    """Boxes (source pixels) around a logo/watermark that stays put through the video, or []."""
    from scipy import ndimage

    size = _video_size(path)
    duration = audio_processor.get_media_duration(path)
    if not size or duration < 4:
        return []
    W, H = size
    w = WORK_WIDTH if W > WORK_WIDTH else W
    h = max(2, int(round(H * w / W / 2)) * 2)
    frames = _frames(path, duration, w, h)
    if len(frames) < 6:
        return []

    # Scenes must really change behind the logo, or a logo cannot be told apart from the scene:
    # skip a video whose sampled frames look alike, or where most edges never move.
    change = float(np.median([np.abs(frames[k] - frames[k - 1]).mean() for k in range(1, len(frames))]))
    edges = np.stack([_edges(f) for f in frames])
    persistent = edges.mean(axis=0) >= 0.8
    share = float(persistent.sum()) / max(1.0, float(edges.sum(axis=(1, 2)).mean()))
    if change < 6 or share > 0.3 or persistent.mean() > 0.04:
        print(f"Logo check skipped: the picture hardly changes (change {change:.1f}, static edges {share:.0%})")
        return []

    # The edge between the picture and black letterbox/pillarbox bars is a long straight line that
    # never moves: drop rows/columns that are mostly persistent edge, so only compact marks remain.
    for axis in (1, 0):
        lines = persistent.mean(axis=axis) > 0.2
        lines = ndimage.binary_dilation(lines, iterations=2)
        if axis == 1:
            persistent[lines, :] = False
        else:
            persistent[:, lines] = False

    grown = ndimage.binary_dilation(persistent, iterations=3)
    labels, n = ndimage.label(grown)
    boxes: List[Box] = []
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        if sl is None:
            continue
        ys, xs = sl
        bx, by, bw, bh = xs.start, ys.start, xs.stop - xs.start, ys.stop - ys.start
        if int(persistent[sl][labels[sl] == i].sum()) < 25:   # a few stray pixels
            continue
        if bh < 6 or bw < 10 or bw > 0.45 * w or bh > 0.25 * h:  # lines, bars, or too big to be a logo
            continue
        cx, cy = bx + bw / 2, by + bh / 2
        if 0.3 * w < cx < 0.7 * w and 0.3 * h < cy < 0.7 * h:    # never touch the middle of the picture
            continue
        boxes.append((bx, by, bw, bh))

    # Logo pieces close together (icon + text) become one box
    merged: List[List[int]] = []
    for bx, by, bw, bh in sorted(boxes):
        for m in merged:
            if bx <= m[0] + m[2] + 12 and m[0] <= bx + bw + 12 and by <= m[1] + m[3] + 12 and m[1] <= by + bh + 12:
                x2, y2 = max(m[0] + m[2], bx + bw), max(m[1] + m[3], by + bh)
                m[0], m[1] = min(m[0], bx), min(m[1], by)
                m[2], m[3] = x2 - m[0], y2 - m[1]
                break
        else:
            merged.append([bx, by, bw, bh])

    sx, sy = W / w, H / h
    out: List[Box] = []
    for bx, by, bw, bh in merged:
        pad = 6
        x0 = max(1, int((bx - pad) * sx))
        y0 = max(1, int((by - pad) * sy))
        x1 = min(W - 2, int((bx + bw + pad) * sx))
        y1 = min(H - 2, int((by + bh + pad) * sy))
        if x1 - x0 >= 8 and y1 - y0 >= 6 and (x1 - x0) * (y1 - y0) <= 0.08 * W * H:
            out.append((x0, y0, x1 - x0, y1 - y0))
    if out:
        print(f"Logo found: {out}")
    return out


def delogo_filter(boxes: List[Box]) -> str:
    """FFmpeg filter text that fills every box from its surroundings ('' when there is none)."""
    return ",".join(f"delogo=x={x}:y={y}:w={w}:h={h}" for x, y, w, h in boxes)
