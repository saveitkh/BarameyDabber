"""
Long-video dubbing helpers: cut one long upload into a handful of shorter
chunks, and join the finished dubbed chunks back into one full video.

A full movie is too much for a single CPU dubbing pass — it holds every line's
audio in memory at once and gives the user nothing to look at until the very
end. So a long video is split into ~5-minute chunks; each chunk is scanned,
reviewed, and dubbed on its own in the background, and the dubbed chunks are
concatenated into the full video at the end. The user keeps both: every dubbed
chunk, and the full movie.

Only the ffmpeg mechanics (split + concat) live here. The project state and the
per-chunk pipeline (scan → cast → voice → mix) live in server.py, which already
owns the dubbing engine, the folders and the auth.
"""
import os
import math
import time

from services import audio_processor

# A chunk short enough to dub without exhausting a CPU VPS, long enough that a
# movie is only a handful of them. Clamped to a sane range in server.py.
DEFAULT_CHUNK_SECONDS = 300.0
MIN_CHUNK_SECONDS = 60.0
MAX_CHUNK_SECONDS = 1800.0


def _cut_one(src_path: str, start: float, length: float, out_path: str) -> str:
    """Cut [start, start+length] out of src. Try a fast stream copy first (cuts
    at the nearest keyframe, which is fine — each chunk is dubbed on its own),
    and fall back to a precise re-encode if the copy produces nothing usable."""
    copy_cmd = (
        f'ffmpeg -nostdin -y -ss {start} -i "{src_path}" -t {length} '
        f'-c copy -avoid_negative_ts make_zero -map 0:v:0 -map 0:a:0? '
        f'-movflags +faststart "{out_path}"'
    )
    try:
        audio_processor.run_command(copy_cmd)
        if audio_processor.get_media_duration(out_path) > 0.2:
            return out_path
    except Exception:
        pass
    # Universal re-encode cut (accurate, any source codec)
    reenc_cmd = (
        f'ffmpeg -nostdin -y -ss {start} -i "{src_path}" -t {length} '
        f'-c:v libx264 -preset veryfast -crf 22 -c:a aac -b:a 192k '
        f'-map 0:v:0 -map 0:a:0? -movflags +faststart "{out_path}"'
    )
    audio_processor.run_command(reenc_cmd)
    return out_path


def split_video(src_path: str, out_dir: str, prefix: str, chunk_seconds: float,
                total_duration: float = None) -> list:
    """Cut src into consecutive chunks of ~chunk_seconds. Returns a list of
    {index, file (basename in out_dir), start, length} in play order."""
    dur = total_duration if total_duration and total_duration > 0 else audio_processor.get_media_duration(src_path)
    ext = os.path.splitext(src_path)[1] or '.mp4'
    if ext.lower() not in ('.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi'):
        ext = '.mp4'
    chunk_seconds = max(MIN_CHUNK_SECONDS, min(MAX_CHUNK_SECONDS, float(chunk_seconds or DEFAULT_CHUNK_SECONDS)))

    count = max(1, math.ceil(dur / chunk_seconds)) if dur > 0 else 1
    chunks = []
    for i in range(count):
        start = round(i * chunk_seconds, 3)
        length = round(min(chunk_seconds, dur - start), 3) if dur > 0 else chunk_seconds
        if dur > 0 and length <= 0.2:
            break
        out_name = f"{prefix}_{i:03d}{ext}"
        out_path = os.path.join(out_dir, out_name)
        _cut_one(src_path, start, length, out_path)
        real = audio_processor.get_media_duration(out_path)
        chunks.append({
            'index': i,
            'file': out_name,
            'start': start,
            'length': round(real if real and real > 0 else length, 3),
        })
    return chunks


def concat_videos(file_paths: list, out_path: str, work_dir: str) -> str:
    """Join dubbed chunk videos (in order) into one file. Stream-copy when the
    chunks share a codec (the common case), re-encode only as a fallback."""
    paths = [p for p in file_paths if p and os.path.exists(p)]
    if not paths:
        raise RuntimeError("No chunk videos to join")
    if len(paths) == 1:
        # Nothing to join — hand back the single chunk as the full video
        try:
            import shutil
            shutil.copy2(paths[0], out_path)
            return out_path
        except Exception:
            return paths[0]

    list_file = os.path.join(work_dir, f"concat_{int(time.time() * 1000)}.txt")
    with open(list_file, 'w', encoding='utf-8') as f:
        for p in paths:
            safe = os.path.abspath(p).replace("'", "'\\''")
            f.write(f"file '{safe}'\n")

    movflags = "-movflags +faststart" if out_path.lower().endswith(('.mp4', '.m4v', '.mov')) else ""
    copy_cmd = f'ffmpeg -nostdin -y -f concat -safe 0 -i "{list_file}" -c copy {movflags} "{out_path}"'
    try:
        audio_processor.run_command(copy_cmd)
        if audio_processor.get_media_duration(out_path) > 0.2:
            _safe_remove(list_file)
            return out_path
    except Exception:
        pass
    # Mixed codecs (e.g. some chunks had burned subtitles) — normalise by re-encoding
    reenc_cmd = (
        f'ffmpeg -nostdin -y -f concat -safe 0 -i "{list_file}" '
        f'-c:v libx264 -preset veryfast -crf 22 -c:a aac -b:a 192k {movflags} "{out_path}"'
    )
    audio_processor.run_command(reenc_cmd)
    _safe_remove(list_file)
    return out_path


def _safe_remove(path: str):
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except Exception:
        pass
