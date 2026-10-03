import os
import subprocess
import math

import sys

# Ensure UTF-8 stdout/stderr on Windows to avoid charmap encoding errors
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

# Automatically ensure FFmpeg paths are in PATH (cross-platform Windows & macOS)
if getattr(sys, 'frozen', False):
    APP_DIR = os.path.dirname(sys.executable)
    BUNDLE_DIR = getattr(sys, '_MEIPASS', APP_DIR)
else:
    APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    BUNDLE_DIR = APP_DIR

BASE_DIR = APP_DIR

EXTRA_PATHS = [
    os.path.join(BUNDLE_DIR, 'bin'),
    os.path.join(APP_DIR, 'bin'),
    '/opt/homebrew/bin',      # Apple Silicon Mac (M1/M2/M3/M4) Homebrew
    '/usr/local/bin',          # Intel Mac Homebrew & standard UNIX tools
    '/opt/local/bin',          # MacPorts
]
for p in EXTRA_PATHS:
    if os.path.exists(p) and p not in os.environ.get('PATH', ''):
        os.environ['PATH'] = p + os.pathsep + os.environ.get('PATH', '')


def run_command(cmd: str):
    """Run shell command synchronously using subprocess."""
    process = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if process.returncode != 0:
        raise RuntimeError(f"Command failed: {cmd}\nError: {process.stderr}")
    return process.stdout.strip()

def get_media_duration(file_path: str) -> float:
    """Get media file duration in seconds using ffprobe."""
    try:
        cmd = f'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "{file_path}"'
        out = run_command(cmd)
        duration = float(out)
        return 0.0 if math.isnan(duration) else duration
    except Exception:
        return 0.0

def has_audio_stream(file_path: str) -> bool:
    """Check if the media file has at least one audio stream."""
    try:
        cmd = f'ffprobe -v error -select_streams a -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 "{file_path}"'
        out = run_command(cmd)
        return "audio" in out.lower()
    except Exception:
        return False

def extract_audio(video_path: str, output_audio_path: str):
    """Extract audio track from video as high quality MP3."""
    if not has_audio_stream(video_path):
        dur = get_media_duration(video_path)
        if dur <= 0:
            dur = 5.0
        # Generate silent audio matching video duration so downstream pipeline doesn't break
        cmd = f'ffmpeg -nostdin -y -f lavfi -i anullsrc=r=44100:cl=stereo -t {dur} -b:a 192k "{output_audio_path}"'
        run_command(cmd)
        return output_audio_path

    cmd = f'ffmpeg -nostdin -y -i "{video_path}" -vn -ar 44100 -ac 2 -b:a 192k "{output_audio_path}"'
    run_command(cmd)
    return output_audio_path

# Gentle ducking: background dips only ~2-3 dB while Khmer speech plays and recovers
# slowly, so music/ambience never drops out or "pumps" between lines.
GENTLE_DUCK = "sidechaincompress=threshold=0.05:ratio=2.5:attack=40:release=800"


def mix_vocals_with_original(original_audio_path: str, dubbed_audio_path: str, output_path: str,
                             vocal_gain: float = 2.2, bgm_gain: float = 1.0, bgm_is_clean: bool = False):
    """
    Mix the Khmer dialogue track over the background.
    - bgm_is_clean=True: background was already separated (Demucs/DSP), keep it untouched at full level
    - bgm_is_clean=False: original soundtrack, softly reduce the centre (foreign speech) only
    The background always runs for the full video length (apad on vocals, amix duration=longest).
    """
    total_duration = get_media_duration(original_audio_path)
    pad_dur = max(1, math.ceil(total_duration))
    vox = f"[0:a]apad=whole_dur={pad_dur},volume={vocal_gain},alimiter=limit=0.95,asplit=2[khmer_vox][khmer_vox_sc];"
    tail = (
        f"[bgm][khmer_vox_sc]{GENTLE_DUCK}[ducked_bgm];"
        f"[khmer_vox][ducked_bgm]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.97"
    )

    if bgm_is_clean:
        bgm_chain = f"[1:a]aresample=44100,volume={bgm_gain}[bgm];"
    else:
        bgm_chain = (
            f"[1:a]asplit=2[low_b][mid_high];"
            f"[low_b]lowpass=f=220[bass];"
            f"[mid_high]stereotools=mlev=0.25:slev=1.0,highpass=f=220,equalizer=f=1500:width_type=o:w=2:g=-6[bgm_sides];"
            f"[bass][bgm_sides]amix=inputs=2:dropout_transition=0:normalize=0,volume={bgm_gain}[bgm];"
        )

    cmd = f'ffmpeg -nostdin -y -i "{dubbed_audio_path}" -i "{original_audio_path}" -filter_complex "{vox}{bgm_chain}{tail}" -c:a libmp3lame -b:a 192k "{output_path}"'
    try:
        run_command(cmd)
        return output_path
    except Exception:
        # Simplest safe mix: background at its own level, no extra filtering
        simple = f"{vox}[1:a]volume={bgm_gain}[bgm];{tail}"
        simple_cmd = f'ffmpeg -nostdin -y -i "{dubbed_audio_path}" -i "{original_audio_path}" -filter_complex "{simple}" -c:a libmp3lame -b:a 192k "{output_path}"'
        run_command(simple_cmd)
        return output_path

def merge_video_audio(video_path: str, audio_path: str, output_video_path: str):
    """
    Combine original video with the new dubbed audio track.
    Fast stream copy without re-encoding, preserving 100% video length.
    """
    movflags = "-movflags +faststart" if output_video_path.lower().endswith(('.mp4', '.m4v', '.mov')) else ""
    cmd = f'ffmpeg -nostdin -y -i "{video_path}" -i "{audio_path}" -c:v copy -c:a aac -b:a 192k -map 0:v:0 -map 1:a:0 {movflags} "{output_video_path}"'
    try:
        run_command(cmd)
    except Exception:
        # Fallback with re-encoding video to libx264 in case input video codec isn't compatible with container
        fallback_cmd = f'ffmpeg -nostdin -y -i "{video_path}" -i "{audio_path}" -c:v libx264 -preset veryfast -crf 22 -c:a aac -b:a 192k -map 0:v:0 -map 1:a:0 {movflags} "{output_video_path}"'
        run_command(fallback_cmd)
    return output_video_path

def remix_audio_with_effects(original_audio_path: str, dubbed_audio_path: str, output_path: str, options: dict = None):
    """Advanced audio remixer with Normal BGM Preservation & Center Vocal Cancellation."""
    options = options or {}
    vocal_gain = options.get('vocalGain', 2.2)
    bgm_gain = options.get('bgmGain', 0.85)
    vocal_suppression = options.get('vocalSuppression', 'strong')
    reverb_preset = options.get('reverbPreset', 'none')

    total_duration = get_media_duration(original_audio_path)
    pad_dur = max(1, math.ceil(total_duration))

    mlev_val = 0.015625
    slev_val = 0.70
    if vocal_suppression == 'mild':
        mlev_val = 0.05
        slev_val = 0.85
    elif vocal_suppression == 'strong':
        mlev_val = 0.015625
        slev_val = 0.65

    reverb_filter = ''
    if reverb_preset == 'imperial':
        reverb_filter = ',aecho=0.8:0.88:60:0.4'
    elif reverb_preset == 'cave':
        reverb_filter = ',aecho=0.8:0.9:120:0.5'
    elif reverb_preset == 'room':
        reverb_filter = ',aecho=0.8:0.8:25:0.25'

    complex_filter = (
        f"[0:a]apad=whole_dur={pad_dur},volume={vocal_gain}{reverb_filter},alimiter=limit=0.95,asplit=2[vox][vox_sc];"
        f"[1:a]asplit=2[low_b][mid_high];"
        f"[low_b]lowpass=f=220,volume={bgm_gain}[bass];"
        f"[mid_high]stereotools=mlev={mlev_val}:slev={slev_val},highpass=f=220,equalizer=f=1000:width_type=o:w=2.5:g=-24,equalizer=f=2500:width_type=o:w=2.0:g=-20,volume={bgm_gain}[bgm_sides];"
        f"[bass][bgm_sides]amix=inputs=2:dropout_transition=0[clean_bgm];"
        f"[clean_bgm][vox_sc]{GENTLE_DUCK}[ducked_bgm];"
        f"[vox][ducked_bgm]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0"
    )

    cmd = f'ffmpeg -nostdin -y -i "{dubbed_audio_path}" -i "{original_audio_path}" -filter_complex "{complex_filter}" -c:a libmp3lame -b:a 192k "{output_path}"'
    try:
        run_command(cmd)
        return output_path
    except Exception:
        fallback_filter = (
            f"[0:a]apad=whole_dur={pad_dur},volume={vocal_gain}{reverb_filter},alimiter=limit=0.95,asplit=2[vox][vox_sc];"
            f"[1:a]volume={bgm_gain * 0.5}[bgm_clean];"
            f"[bgm_clean][vox_sc]{GENTLE_DUCK}[ducked_bgm];"
            f"[vox][ducked_bgm]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0"
        )
        fallback_cmd = f'ffmpeg -nostdin -y -i "{dubbed_audio_path}" -i "{original_audio_path}" -filter_complex "{fallback_filter}" -c:a libmp3lame -b:a 192k "{output_path}"'
        run_command(fallback_cmd)
        return output_path

def tune_audio_pitch_and_speed(input_audio_path: str, output_path: str, speed: float = 1.0, pitch_semitones: int = 0):
    """Adjust voice pitch & speed for precise lip-sync & character tone tuning."""
    clamped_speed = max(0.5, min(2.0, float(speed) if speed else 1.0))
    semitones = max(-12, min(12, int(pitch_semitones) if pitch_semitones else 0))

    audio_filter = ""
    if semitones != 0:
        pitch_factor = 2 ** (semitones / 12.0)
        new_sample_rate = round(44100 * pitch_factor)
        tempo_comp = clamped_speed / pitch_factor

        tempo_filters = []
        rem = tempo_comp
        while rem > 2.0:
            tempo_filters.append("atempo=2.0")
            rem /= 2.0
        while rem < 0.5:
            tempo_filters.append("atempo=0.5")
            rem /= 0.5
        tempo_filters.append(f"atempo={rem:.3f}")
        audio_filter = f'-af "asetrate={new_sample_rate},{",".join(tempo_filters)},aresample=44100"'
    else:
        tempo_filters = []
        rem = clamped_speed
        while rem > 2.0:
            tempo_filters.append("atempo=2.0")
            rem /= 2.0
        while rem < 0.5:
            tempo_filters.append("atempo=0.5")
            rem /= 0.5
        tempo_filters.append(f"atempo={rem:.3f}")
        audio_filter = f'-af "{",".join(tempo_filters)}"'

    cmd = f'ffmpeg -nostdin -y -i "{input_audio_path}" {audio_filter} -ar 44100 -ac 2 "{output_path}"'
    run_command(cmd)
    return output_path

def format_srt_time(seconds: float) -> str:
    total_ms = max(0, round((float(seconds) if seconds else 0.0) * 1000))
    hrs = total_ms // 3600000
    mins = (total_ms % 3600000) // 60000
    secs = (total_ms % 60000) // 1000
    ms = total_ms % 1000
    return f"{hrs:02d}:{mins:02d}:{secs:02d},{ms:03d}"

def create_srt_content(segments: list, options: dict = None) -> str:
    options = options or {}
    dual = options.get('dual', False)
    srt = ""
    count = 1
    for seg in segments:
        start = seg.get('start_time', 0)
        end = seg.get('end_time', start + 2.5)
        khmer_text = (seg.get('khmer') or seg.get('khmer_text') or seg.get('khmer_translation') or '').strip()
        chinese_text = (seg.get('chinese') or seg.get('chinese_text') or '').strip()
        if not khmer_text and not chinese_text:
            continue
        srt += f"{count}\n"
        srt += f"{format_srt_time(start)} --> {format_srt_time(end)}\n"
        if dual and chinese_text and khmer_text:
            srt += f"{khmer_text}\n{chinese_text}\n\n"
        else:
            srt += f"{khmer_text or chinese_text}\n\n"
        count += 1
    return srt

def burn_subtitles_to_video(video_path: str, srt_path: str, output_video_path: str, options: dict = None):
    options = options or {}
    font_size = options.get('fontSize', 20)
    font_color = options.get('fontColor', 'yellow')
    border_style = options.get('borderStyle', 3)
    outline = options.get('outline', 2)

    primary_color_hex = '&H0000FFFF'
    if font_color == 'white':
        primary_color_hex = '&H00FFFFFF'
    elif font_color == 'cyan':
        primary_color_hex = '&H00FFFF00'

    escaped_srt = srt_path.replace('\\', '/').replace(':', '\\:')
    force_style = f"FontSize={font_size},PrimaryColour={primary_color_hex},OutlineColour=&H00000000,BorderStyle={border_style},Outline={outline},MarginV=25"
    cmd = f'ffmpeg -nostdin -y -i "{video_path}" -vf "subtitles=\'{escaped_srt}\':force_style=\'{force_style}\'" -c:v libx264 -preset fast -crf 22 -c:a copy -movflags +faststart "{output_video_path}"'
    run_command(cmd)
    return output_video_path

def get_video_dimensions(video_path: str):
    """Query video width and height using ffprobe."""
    try:
        cmd = f'ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "{video_path}"'
        out = run_command(cmd).strip()
        parts = out.split('x')
        if len(parts) >= 2:
            return int(parts[0]), int(parts[1])
    except Exception:
        pass
    return 1920, 1080

def hex_to_ass_color(hex_str: str, alpha: float = 1.0) -> str:
    """Convert hex color (#RRGGBB or #RGB) and opacity (0.0 - 1.0) to ASS format (&HAABBGGRR)."""
    if not hex_str:
        return "&H00FFFFFF"
    clean = hex_str.strip().lstrip('#')
    if len(clean) == 3:
        clean = ''.join(c * 2 for c in clean)
    if len(clean) != 6:
        clean = "FFFFFF"
    r = int(clean[0:2], 16)
    g = int(clean[2:4], 16)
    b = int(clean[4:6], 16)
    # ASS alpha is inverted: 00 is fully opaque, FF is fully transparent
    a_val = max(0, min(255, int(round((1.0 - alpha) * 255))))
    return f"&H{a_val:02X}{b:02X}{g:02X}{r:02X}"

_CACHED_ENCODER = None

def _probe_encoder(codec: str, flags: str = "") -> bool:
    """Probe if an encoder is genuinely functional on this hardware (runs 0.04s test frame)."""
    try:
        cmd = f'ffmpeg -nostdin -y -f lavfi -i color=c=black:s=64x64:d=0.04 -c:v {codec} {flags} -f null -'
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=3)
        return res.returncode == 0
    except Exception:
        return False

def detect_best_video_encoder() -> tuple:
    """Detect fastest verified working video encoder (NVIDIA NVENC, AMD AMF, Intel QSV, Apple Metal, or CPU)."""
    global _CACHED_ENCODER
    if _CACHED_ENCODER is not None:
        return _CACHED_ENCODER

    threads = os.cpu_count() or 4
    candidates = [
        ('h264_nvenc', '-preset p4 -cq 21'),
        ('h264_amf', '-usage transcoding -quality speed'),
        ('h264_qsv', '-global_quality 22'),
    ]
    if sys.platform == 'darwin':
        candidates.insert(0, ('h264_videotoolbox', '-q:v 60'))

    for codec, flags in candidates:
        if _probe_encoder(codec, flags):
            print(f"[Hardware Acceleration] Active video encoder: {codec}")
            _CACHED_ENCODER = (codec, flags)
            return _CACHED_ENCODER

    print(f"[CPU Encoding] Multi-core video encoding: libx264 ({threads} threads)")
    _CACHED_ENCODER = ('libx264', f'-preset ultrafast -threads {threads}')
    return _CACHED_ENCODER

def burn_overlay_and_subtitles(video_path: str, output_video_path: str, overlay_image_path: str = None, srt_path: str = None, options: dict = None):
    """
    Permanently burns 3D title/thumbnail overlay, watermark, and/or subtitles into the video stream.
    Supports resolution scaling, multi-bitrate profiles, multi-threading hardware acceleration, and preserves audio streams.
    """
    from PIL import Image, ImageDraw, ImageFont

    options = options or {}
    resolution = options.get('resolution', 'original')
    bitrate = options.get('bitrate', 'high')
    turbo_mode = options.get('turbo', True)

    video_w, video_h = get_video_dimensions(video_path)
    inputs = [f'-i "{video_path}"']
    filter_steps = []
    current_v = '[0:v]'

    # Handle resolution scaling (portrait vs landscape)
    is_portrait = video_h > video_w
    if resolution == '1080p':
        if not is_portrait and video_h != 1080:
            filter_steps.append(f"{current_v}scale=-2:1080[v_scaled]")
            current_v = '[v_scaled]'
            video_w = int(round(video_w * (1080 / max(1, video_h))))
            video_h = 1080
        elif is_portrait and video_w != 1080:
            filter_steps.append(f"{current_v}scale=1080:-2[v_scaled]")
            current_v = '[v_scaled]'
            video_h = int(round(video_h * (1080 / max(1, video_w))))
            video_w = 1080
    elif resolution == '720p':
        if not is_portrait and video_h != 720:
            filter_steps.append(f"{current_v}scale=-2:720[v_scaled]")
            current_v = '[v_scaled]'
            video_w = int(round(video_w * (720 / max(1, video_h))))
            video_h = 720
        elif is_portrait and video_w != 720:
            filter_steps.append(f"{current_v}scale=720:-2[v_scaled]")
            current_v = '[v_scaled]'
            video_h = int(round(video_h * (720 / max(1, video_w))))
            video_w = 720
    elif resolution == '4k':
        if not is_portrait and video_h != 2160:
            filter_steps.append(f"{current_v}scale=-2:2160[v_scaled]")
            current_v = '[v_scaled]'
            video_w = int(round(video_w * (2160 / max(1, video_h))))
            video_h = 2160
        elif is_portrait and video_w != 2160:
            filter_steps.append(f"{current_v}scale=2160:-2[v_scaled]")
            current_v = '[v_scaled]'
            video_h = int(round(video_h * (2160 / max(1, video_w))))
            video_w = 2160

    # 1. Overlay & Watermark Composition
    temp_scaled_overlay = None
    watermark = options.get('watermark')

    # Create composite canvas if either overlay or watermark exists
    if (overlay_image_path and os.path.exists(overlay_image_path)) or (watermark and watermark.get('enabled') and watermark.get('text')):
        try:
            composite_img = Image.new('RGBA', (video_w, video_h), (0, 0, 0, 0))

            # Paste existing overlay if present
            if overlay_image_path and os.path.exists(overlay_image_path):
                with Image.open(overlay_image_path) as im:
                    im_rgba = im.convert('RGBA')
                    if im_rgba.size != (video_w, video_h):
                        im_rgba = im_rgba.resize((video_w, video_h), Image.Resampling.LANCZOS)
                    composite_img.paste(im_rgba, (0, 0), im_rgba)

            # Draw Watermark onto composite image
            if watermark and watermark.get('enabled') and watermark.get('text'):
                wm_text = watermark.get('text', '')
                wm_opacity = float(watermark.get('opacity', 85)) / 100.0
                wm_pos = watermark.get('position', 'top-right')
                wm_size = int(round((watermark.get('fontSize', 14) / 1080.0) * video_h))
                wm_size = max(14, min(48, wm_size))

                draw = ImageDraw.Draw(composite_img)
                # Try to use standard fonts, fallback to default
                font = None
                font_candidates = [
                    'C:/Windows/Fonts/segoeui.ttf',
                    'C:/Windows/Fonts/arial.ttf',
                    '/System/Library/Fonts/Helvetica.ttc',
                    '/Library/Fonts/Arial.ttf'
                ]
                for fc in font_candidates:
                    if os.path.exists(fc):
                        try:
                            font = ImageFont.truetype(fc, wm_size)
                            break
                        except Exception:
                            pass
                if not font:
                    font = ImageFont.load_default()

                bbox = draw.textbbox((0, 0), wm_text, font=font)
                text_w = bbox[2] - bbox[0]
                text_h = bbox[3] - bbox[1]
                margin = int(round(video_h * 0.035))

                if wm_pos == 'top-left':
                    x = margin
                    y = margin
                elif wm_pos == 'bottom-left':
                    x = margin
                    y = video_h - margin - text_h - 16
                elif wm_pos == 'bottom-right':
                    x = video_w - margin - text_w - 24
                    y = video_h - margin - text_h - 16
                elif wm_pos == 'center':
                    x = (video_w - text_w) // 2
                    y = (video_h - text_h) // 2
                else:  # top-right
                    x = video_w - margin - text_w - 24
                    y = margin

                # Draw subtle dark badge pill
                pad_x, pad_y = 12, 6
                badge_bg = (0, 0, 0, int(160 * wm_opacity))
                draw.rounded_rectangle(
                    [x - pad_x, y - pad_y, x + text_w + pad_x, y + text_h + pad_y],
                    radius=8,
                    fill=badge_bg,
                    outline=(255, 255, 255, int(60 * wm_opacity)),
                    width=1
                )
                text_color = (255, 255, 255, int(255 * wm_opacity))
                draw.text((x, y), wm_text, font=font, fill=text_color)

            ts = int(time.time() * 1000)
            temp_scaled_overlay = os.path.join(os.path.dirname(output_video_path), f"temp_comp_ovl_{ts}.png")
            composite_img.save(temp_scaled_overlay, 'PNG')
            inputs.append(f'-i "{temp_scaled_overlay}"')
            ovl_idx = len(inputs) - 1
            filter_steps.append(f"{current_v}[{ovl_idx}:v]overlay=0:0[v_ovl]")
            current_v = '[v_ovl]'
        except Exception as ex:
            print(f"Overlay & Watermark composition error: {ex}")

    # 2. Custom Subtitle Rendering via ASS force_style
    if srt_path and os.path.exists(srt_path):
        escaped_srt = srt_path.replace('\\', '/').replace(':', '\\:')
        sub_style = options.get('subtitleStyle', {})
        font_name = sub_style.get('fontFamily', 'Kantumruy Pro')
        font_size = int(round(sub_style.get('fontSize', 22) * (video_h / 720.0)))
        font_size = max(16, min(56, font_size))
        
        text_color_ass = hex_to_ass_color(sub_style.get('textColor', '#FFFFFF'), 1.0)
        outline_color_ass = hex_to_ass_color(sub_style.get('strokeColor', '#000000'), 1.0)
        box_color_ass = hex_to_ass_color(sub_style.get('backgroundColor', '#000000'), 0.75)
        stroke_width = sub_style.get('strokeWidth', 2)
        pos = sub_style.get('position', 'bottom')
        margin_v = 35 if pos == 'bottom' else (video_h // 2 if pos == 'center' else video_h - 80)
        alignment = 2 if pos == 'bottom' else (5 if pos == 'center' else 8)
        border_style = 3 if sub_style.get('boxEnabled', True) else 1

        force_style = (
            f"FontName={font_name},"
            f"FontSize={font_size},"
            f"PrimaryColour={text_color_ass},"
            f"OutlineColour={outline_color_ass},"
            f"BackColour={box_color_ass},"
            f"BorderStyle={border_style},"
            f"Outline={stroke_width},"
            f"Alignment={alignment},"
            f"MarginV={margin_v}"
        )
        filter_steps.append(f"{current_v}subtitles='{escaped_srt}':force_style='{force_style}'[v_sub]")
        current_v = '[v_sub]'

    # 3. Fast Video Encoding Selection (NVENC GPU or Ultrafast Multi-threaded CPU)
    crf = '19' if bitrate == 'high' else '22' if bitrate == 'standard' else '26'
    input_flags = " ".join(inputs)
    threads = os.cpu_count() or 4
    encoder, enc_flags = detect_best_video_encoder()

    if filter_steps:
        fc = ";".join(filter_steps)
        if encoder == 'libx264':
            cmd = f'ffmpeg -nostdin -y {input_flags} -filter_complex "{fc}" -map "{current_v}" -map 0:a? -c:v libx264 -preset ultrafast -threads {threads} -crf {crf} -c:a aac -b:a 192k -movflags +faststart "{output_video_path}"'
        else:
            cmd = f'ffmpeg -nostdin -y {input_flags} -filter_complex "{fc}" -map "{current_v}" -map 0:a? -c:v {encoder} {enc_flags} -c:a aac -b:a 192k -movflags +faststart "{output_video_path}"'
    else:
        cmd = f'ffmpeg -nostdin -y {input_flags} -c:v copy -c:a copy -movflags +faststart "{output_video_path}"'

    try:
        try:
            run_command(cmd)
        except Exception as hw_err:
            if encoder != 'libx264' and filter_steps:
                print(f"[Warning] Hardware encoder ({encoder}) failed during render: {hw_err}")
                print(f"[Fallback] Automatically retrying with CPU multi-core (libx264 ultrafast)...")
                cpu_cmd = f'ffmpeg -nostdin -y {input_flags} -filter_complex "{fc}" -map "{current_v}" -map 0:a? -c:v libx264 -preset ultrafast -threads {threads} -crf {crf} -c:a aac -b:a 192k -movflags +faststart "{output_video_path}"'
                run_command(cpu_cmd)
            else:
                raise
    finally:
        if temp_scaled_overlay and os.path.exists(temp_scaled_overlay):
            try:
                os.remove(temp_scaled_overlay)
            except Exception:
                pass

    return output_video_path

