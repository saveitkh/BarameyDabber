import os
import sys
import shutil
import subprocess
from services import audio_processor

def has_demucs() -> bool:
    """Check if Demucs is installed in Python environment."""
    try:
        import demucs
        return True
    except ImportError:
        return False

def separate_with_demucs(audio_path: str, output_dir: str) -> dict:
    """
    Separate human vocals from background music using Meta Demucs AI (htdemucs).
    Outputs:
      vocals_path: clean isolated dialogue vocals
      bgm_path: clean isolated background music and sound effects
    """
    os.makedirs(output_dir, exist_ok=True)
    base_name = os.path.splitext(os.path.basename(audio_path))[0]

    # Run Demucs CLI in two-stems mode (vocals / no_vocals)
    # Use sys.executable to ensure same Python/virtualenv is used on Windows and macOS
    cmd = f'"{sys.executable}" -m demucs.separate -n htdemucs --two-stems=vocals -o "{output_dir}" "{audio_path}"'
    print(f"Running Meta Demucs AI Vocal Separation on: {audio_path}...")
    audio_processor.run_command(cmd)

    # Demucs saves to: <output_dir>/htdemucs/<base_name>/vocals.wav and no_vocals.wav
    demucs_dir = os.path.join(output_dir, 'htdemucs', base_name)
    vocals_wav = os.path.join(demucs_dir, 'vocals.wav')
    bgm_wav = os.path.join(demucs_dir, 'no_vocals.wav')

    dest_vocals = os.path.join(output_dir, f"{base_name}_ai_vocals.wav")
    dest_bgm = os.path.join(output_dir, f"{base_name}_ai_bgm.wav")

    if os.path.exists(vocals_wav) and os.path.exists(bgm_wav):
        shutil.copyfile(vocals_wav, dest_vocals)
        shutil.copyfile(bgm_wav, dest_bgm)
        return {
            'success': True,
            'engine': 'meta-demucs-ai',
            'vocalsPath': dest_vocals,
            'bgmPath': dest_bgm
        }
    raise RuntimeError("Demucs outputs not found in expected folder")

# Bump when the DSP recipe changes so cached results from the old recipe are not reused
DSP_VERSION = "dsp2"

def separate_with_ffmpeg_fallback(audio_path: str, output_dir: str) -> dict:
    """DSP vocal / background split with FFmpeg filters (used when Demucs is not installed).

    Film dialogue sits in the centre of the stereo mix, but so do many effects and much of the
    music. Instead of deleting the centre, keep it and cut only the speech band there, so
    gunshots, impacts, bass and cymbals survive while the original voices drop ~20 dB.
    """
    os.makedirs(output_dir, exist_ok=True)
    base_name = os.path.splitext(os.path.basename(audio_path))[0]
    dest_vocals = os.path.join(output_dir, f"{base_name}_{DSP_VERSION}_vocals.wav")
    dest_bgm = os.path.join(output_dir, f"{base_name}_{DSP_VERSION}_bgm.wav")

    bgm_filter = (
        "[0:a]asplit=3[a1][a2][a3];"
        "[a1]lowpass=f=240[bass];"
        "[a2]stereotools=mlev=0.015625:slev=1.25,highpass=f=220,equalizer=f=1100:width_type=o:w=2.2:g=-10[sides];"
        "[a3]stereotools=mlev=1:slev=0.015625,highpass=f=220,"
        "equalizer=f=450:width_type=o:w=1.4:g=-16,"
        "equalizer=f=1100:width_type=o:w=1.4:g=-22,"
        "equalizer=f=2600:width_type=o:w=1.4:g=-18,volume=0.8[centre];"
        "[bass][sides][centre]amix=inputs=3:dropout_transition=0:normalize=0,alimiter=limit=0.95"
    )
    audio_processor.run_command(f'ffmpeg -nostdin -y -i "{audio_path}" -filter_complex "{bgm_filter}" -ar 44100 -ac 2 "{dest_bgm}"')

    # Isolated center vocals: Highpass 240Hz, Lowpass 3800Hz, center stereo isolation
    vocal_filter = (
        "stereotools=slev=0.015625:mlev=1.35,highpass=f=240,lowpass=f=3800"
    )
    audio_processor.run_command(f'ffmpeg -nostdin -y -i "{audio_path}" -af "{vocal_filter}" -ar 44100 -ac 2 "{dest_vocals}"')

    return {
        'success': True,
        'engine': 'ffmpeg-dsp',
        'vocalsPath': dest_vocals,
        'bgmPath': dest_bgm
    }

def isolate_voice_sample(src_path: str, output_dir: str) -> str:
    """Strip music/effects from a short voice sample (for voice cloning). Uses Demucs when
    installed; otherwise a gentle speech-band filter. Returns the cleaned file, or src_path."""
    try:
        if has_demucs():
            res = separate_with_demucs(src_path, output_dir)
            if res.get('vocalsPath') and os.path.exists(res['vocalsPath']):
                return res['vocalsPath']
    except Exception as e:
        print(f"Voice sample isolation (Demucs) notice: {e}")
    try:
        base_name = os.path.splitext(os.path.basename(src_path))[0]
        dest = os.path.join(output_dir, f"{base_name}_voice.wav")
        audio_processor.run_command(
            f'ffmpeg -nostdin -y -i "{src_path}" -af "highpass=f=90,lowpass=f=8000,afftdn=nf=-25" -ar 44100 -ac 1 "{dest}"'
        )
        if os.path.exists(dest) and os.path.getsize(dest) > 1000:
            return dest
    except Exception as e:
        print(f"Voice sample filter notice: {e}")
    return src_path

def separate_vocals_and_bgm(audio_path: str, output_dir: str, prefer_ai: bool = True) -> dict:
    """
    Main vocal separation orchestrator:
    Uses Meta Demucs AI if available and prefer_ai is True; otherwise uses clean DSP.
    """
    if prefer_ai and has_demucs():
        try:
            return separate_with_demucs(audio_path, output_dir)
        except Exception as e:
            print(f"Demucs AI notice, using DSP fallback: {e}")
            return separate_with_ffmpeg_fallback(audio_path, output_dir)
    return separate_with_ffmpeg_fallback(audio_path, output_dir)
