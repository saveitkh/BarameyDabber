# Offline Voice Split Tool (fallback)

Lightweight, fully offline speaker-separation tool for dialogue audio
(anime/donghua source files). This is a **fallback** for when the project's
normal voice pipeline (Gemini-assisted extraction in `scripts/extract_movie_voices.py`
/ `scripts/extract_kxev_voices.py`, plus `demucs` for music/vocal separation,
per `requirements.txt`) isn't available — e.g. no internet access to call the
Gemini API or download the `demucs`/`torch` models. It only needs `numpy`,
`scipy`, `scikit-learn`, and `ffmpeg`, so it can run completely offline, with
much lower accuracy than the Gemini-based approach.

Prefer the existing Gemini-based scripts when you have API access — they
identify characters semantically (by listening + labeling), which this
clustering approach cannot do. Use this script only as a quick first pass
when offline, or as a cheap pre-filter before manual review.

## What it does
1. Decodes any ffmpeg-readable input to 16kHz mono.
2. Voice-activity detection via rolling noise-floor + energy margin (works
   even with background music under the dialogue, since dialogue is usually
   mixed louder).
3. Per-segment acoustic fingerprint: MFCC mean/std + median pitch (F0) +
   voiced ratio.
4. Agglomerative (Ward) clustering of segments into speaker groups — auto
   picks the speaker count (2–6) by silhouette score, or force it with `--k`.
5. Stitches each speaker's segments into one audio file, plus a JSON
   timeline mapping each clip back to its original timestamp in the source.

## Usage
```bash
pip install numpy scipy scikit-learn   # usually already present (see requirements.txt)
python3 scripts/voice_split_offline.py input.mp4 --outdir out/ [--k 3]
```
Outputs in `out/`: `speaker_0.wav`, `speaker_1.wav`, … + `segments.json`
(every segment with its timestamp + assigned speaker id) + per-speaker
timeline JSONs.

## Known limitations (read before trusting the output)
- This is **not** true speaker recognition — it's unsupervised clustering on
  pitch/timbre statistics. It confuses speakers with similar voice pitch,
  and can misclassify singing/loud SFX/music swells as "speech."
  Silhouette score printed to stderr is a rough quality signal — above
  ~0.25 the clusters are probably meaningful, below that they're weak.
- Heavy background music close in loudness to dialogue degrades the VAD
  step; tune `--margin-db` (default 6 dB) if too much/little is flagged
  as speech.
- Works best 2–3 speakers at a time; accuracy drops with more voices.
- For a precise cut of one specific line, giving explicit timestamps
  (`ffmpeg -ss .. -to ..`) is always more reliable than this tool.

## Where this fits in the pipeline
This covers the **speaker diarization** step of the dubbing pipeline
(before translation + ElevenLabs voice cloning + optional lip-sync). Natural
next upgrade: swap this heuristic clustering for a real embedding model
(e.g. `pyannote.audio` or `speechbrain` ECAPA-TDNN) once `torch` + model
download is available in the build/dev environment — the VAD + export
plumbing here can stay, only `extract_features`/`cluster_segments` need
replacing with real embeddings + a proper diarization clustering (e.g.
spectral clustering on embedding similarity).
