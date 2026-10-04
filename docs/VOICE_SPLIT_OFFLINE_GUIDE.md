# Voice Split Tool — បំបែកសំឡេងតួ (offline)

`scripts/voice_split_offline.py` បំបែកសំឡេងរឿងមួយភាគ ជាឯកសារសំឡេងមួយសម្រាប់តួនីមួយៗ។
ដំណើរការ offline ទាំងស្រុង (numpy + scipy + ffmpeg)។ មិនចាំបាច់ Gemini ឬ Model AI ទេ។

- **ចំនួនតួរកឃើញដោយស្វ័យប្រវត្ត** (រហូតដល់ ៣០ តួ — លែងមានកំណត់ ២–៦ ទៀតហើយ)
- **ចាំតួពីភាគមុន** (`--profiles voices.json`): តួដែលធ្លាប់ឮ រក្សាលេខដដែល (S01, S02 …)។ សំឡេងដែលមិនធ្លាប់ឮ ក្លាយជា **តួថ្មី** ដោយស្វ័យប្រវត្ត
- **ដាក់សញ្ញាតែឃ្លាដែលត្រូវការមនុស្សពិនិត្យ**:
  - `mixed` — សំឡេង ២ ក្នុងឃ្លាតែមួយ (និយាយជាន់គ្នា ឬប្ដូរអ្នកនិយាយពាក់កណ្ដាលឃ្លា)
  - `unsure` — សំឡេងស្ថិតនៅចន្លោះតួពីរ
  - ប្រហែលខ្វះ — សំឡេងតិចៗដែលអាចជាឃ្លាដែលរកមិនឃើញ
- **review.html** — ទំព័រកែដោយដៃ: ស្ដាប់ ប្ដូរតួ កាត់ជាពីរ បន្ថែមឃ្លាដែលខ្វះ ដាក់ឈ្មោះតួ បញ្ចូលតួ
- **លុបភ្លេងចេញមុន** ដោយ Demucs (បើបានដំឡើង) — រកឃើញឃ្លាដែលលាក់ក្រោមភ្លេង ហើយឯកសារតួនីមួយៗមានតែសំឡេងនិយាយ ល្អសម្រាប់ Voice Clone

## ងាយបំផុត លើ Windows: `VOICE_SPLIT.bat`
1. **ទាញវីដេអូមកទម្លាក់លើ `VOICE_SPLIT.bat`** (ឬចុចពីរដងលើវា ហើយជ្រើសវីដេអូ)។ លើកដំបូង វាដំឡើង Python packages និង FFmpeg ដោយខ្លួនឯង ហើយសួរថាចង់ដំឡើង Demucs ឬទេ។
2. ទំព័រ **review.html** បើកដោយខ្លួនឯង → កែតែឃ្លា ⚠️ → ចុច **💾 រក្សាទុក edits.json**។
3. **ទាញ `edits.json` (ពី Downloads) មកទម្លាក់លើ `VOICE_SPLIT.bat`** → ឯកសារតួត្រូវបានផលិតឡើងវិញ។

លទ្ធផលនៅក្នុង `voice_split\<ឈ្មោះវីដេអូ>\` ហើយ `voice_split\voices.json` ចាំតួសម្រាប់ភាគបន្ទាប់។

## មានឯកសារសំឡេងតួរួចហើយ (ឧ. ពីឧបករណ៍ផ្សេង)? `VOICE_CLIPS.bat`

បើអ្នកមានឯកសារ `.mp3`/`.wav` ដែល **ជារបស់តួតែម្នាក់** រួចហើយ ប៉ុន្តែឃ្លាទាំងអស់ត្រូវបានភ្ជាប់ជាឯកសារវែងមួយ
(ឧ. `speaker_0.mp3` វែង ១០ នាទី) — **មិនមែនកាត់តួ** (ធ្វើរួចហើយ) ប៉ុន្តែ **កាត់ត្រឡប់ជាឃ្លាខ្លីៗដាច់ពីគ្នា**៖

1. ទាញឯកសារនោះ មកទម្លាក់លើ `VOICE_CLIPS.bat`
2. ជ្រើស **[1] Fine** (ឃ្លាខ្លី កាត់ញឹក) **[2] Normal** (ធម្មតា) ឬ **[3] Coarse** (ឃ្លាវែង កាត់តែពេលសម្ងាត់យូរ)
3. លទ្ធផលនៅក្នុង `voice_clips\<ឈ្មោះឯកសារ>\` — ឯកសារតូចៗលេខរៀង `..._01.wav`, `..._02.wav` …

បើលទ្ធផលមិនល្អ (ខ្លីពេក ឬវែងពេក) រត់ម្ដងទៀត ជ្រើសកម្រិតផ្សេង។ ឧបករណ៍នេះគ្រាន់តែរកកន្លែងស្ងាត់រវាងឃ្លា —
វាមិនដឹងថាឃ្លាមួយៗចាប់ផ្ដើម/បញ្ចប់ត្រង់ណាពិតប្រាកដទេ បើឯកសារដើមគ្មានចន្លោះស្ងាត់រវាងឃ្លាផ្ទាល់ខ្លួនរបស់វាសោះ។

## របៀបប្រើ (៣ ជំហាន)

```bash
pip install numpy scipy            # មានរួចហើយក្នុង requirements.txt
pip install demucs                 # ជម្រើស ប៉ុន្តែណែនាំ (លុបភ្លេង)

# ១) បំបែក — ភាគទី១ បង្កើត voices.json, ភាគបន្ទាប់ប្រើឯកសារដដែល
python scripts/voice_split_offline.py split EP01.mp4 --outdir out_ep01 --profiles voices.json

# ២) បើក out_ep01/review.html ក្នុង Chrome → កែតែឃ្លា ⚠️ → ចុច "💾 រក្សាទុក edits.json"

# ៣) ផលិតឡើងវិញតាមការកែ (ហើយបង្រៀន voices.json ឲ្យស្គាល់សំឡេងត្រឹមត្រូវ)
python scripts/voice_split_offline.py apply out_ep01 --edits edits.json --profiles voices.json
```

ប្រើតាមរបៀបចាស់ក៏នៅបាន: `python scripts/voice_split_offline.py input.mp4 --outdir out/ [--k 3]`

### ទំព័រ review.html
| ធ្វើអ្វី | របៀប |
|---|---|
| ស្ដាប់ឃ្លា | ▶ ឬ <kbd>Space</kbd> · <kbd>↑</kbd>/<kbd>↓</kbd> ទៅឃ្លាមុន/បន្ទាប់ ហើយចាក់ដោយខ្លួនឯង |
| ប្ដូរតួ | ជ្រើសក្នុងប្រអប់ ឬចុច <kbd>1</kbd>–<kbd>9</kbd> |
| ឃ្លាត្រឹមត្រូវហើយ | ✓ ឬ <kbd>Enter</kbd> |
| សំឡេង ២ ជាន់គ្នា | ✂ (ឬ <kbd>S</kbd>) កាត់ត្រង់កន្លែងកំពុងស្ដាប់ ហើយដាក់តួម្នាក់ម្ដងៗ — ឬ 🗑 លុបចោល |
| ឃ្លាខ្វះ | ជួរ "ប្រហែលខ្វះ" → ជ្រើសតួ (ឬលុប) · កែម៉ោងចាប់ផ្ដើម/បញ្ចប់បាន |
| តួថ្មី | "＋ តួថ្មី" ក្នុងប្រអប់តួ |
| តួពីរជាមនុស្សតែម្នាក់ | ក្នុងបញ្ជីតួខាងឆ្វេង → "បញ្ចូល…" |

ការកែត្រូវបានរក្សាទុកក្នុង Browser ដោយស្វ័យប្រវត្ត (បិទហើយបើកវិញ មិនបាត់)។

## Outputs (in `--outdir`)
| File | What |
|---|---|
| `S01.wav`, `S01_ឈ្មោះ.wav` … | every line of that character joined (lines flagged `mixed` left out) |
| `S01_best.wav` … | ~15 s of that character's clearest lines — use it as the voice-clone reference in the Studio |
| `S01_timeline.json` … | where each clip came from in the source |
| `segments.json` | every line: start, end, speaker, confidence, flags |
| `project.json`, `review.html`, `source.mp3` | state + review page + the audio it plays |
| `vocals.flac` | the music-free voice track (when Demucs ran) |

## Options (split)
| Option | Default | Meaning |
|---|---|---|
| `--profiles voices.json` | — | remember characters across episodes |
| `--separate auto/yes/no` | auto | remove music with Demucs first (auto = when installed) |
| `--vocals FILE` | — | use an already separated vocals file (e.g. `outputs/audio_<video>_ai_vocals.wav` from the Studio) |
| `--k N` | auto | force the number of characters |
| `--separation` | 1.85 | smaller = more characters (if two voices got merged), larger = fewer |
| `--unsure` | 0.25 | higher = more lines flagged for review |
| `--mixed` | 0.8 | lower = more lines flagged as two voices |
| `--margin-db` | 6 | lower = finds quieter speech (and more noise) |

## Cutting an already-single-speaker file into clips (`clips`)

```bash
python scripts/voice_split_offline.py clips speaker_0.mp3 --outdir out/
```

For a file that already holds one character's voice only — an `S01.wav` this tool made, or a
joined track from another tool — cuts it back into individual clips by the pauses between them,
instead of one long file. Writes `..._01.wav`, `..._02.wav` … plus a `..._clips.json` index
(start/end/duration of each). Tuned tighter than `split` by default (a single speaker's own
pauses between short phrases are much shorter than the gap between two different people's lines):
`--margin-db 4 --merge-gap 0.12 --min-dur 0.35 --max-dur 15`. If a source file has almost no real
silence between its original clips (some joining tools strip it), the result falls back to cuts
at the quietest point roughly every `--max-dur` seconds — lower `--margin-db` (e.g. `3`) and
`--merge-gap` (e.g. `0.08`) first to look harder for real pauses. `VOICE_CLIPS.bat` offers this as
three presets (Fine / Normal / Coarse) instead of raw numbers.

## How it works
1. Decode; optionally strip music with Demucs.
2. Speech detection on the 250–3800 Hz band vs a rolling 6 s noise/music floor; long stretches are cut at their quietest point.
3. Voice fingerprint per line: MFCC mean/spread (timbre) + YIN pitch in musical units (0.2 octave = 1 unit, the same for every episode).
4. Ward clustering; the automatic count is the largest one where every two characters are still clearly apart and each has ≥ 2 lines / 2 s. Errs toward one character too many, since merging is one click.
5. With profiles: groups are matched to remembered characters; remembered voices hidden inside another group are pulled back out; the rest become new ids.
6. Each line's halves are compared to catch two voices in one line; the margin to the second-closest character gives the confidence.

Measured on synthetic dialogue (6 voices + music, 4.6 min): with clean vocals 6/6 characters and 100% of lines correct, 5 lines to review (including the overlap and the turn change); on the music mix 95% correct. Across episodes, known voices kept their ids and new voices got new ids. A 46-minute episode runs in under a minute (without Demucs).

## Limits
- This is acoustic clustering (timbre + pitch), not neural speaker ID. Two characters with very similar voices, or one character who shouts/whispers a lot, can be grouped wrong — that is what the review page is for.
- Without Demucs, lines quieter than the music cannot be found; install Demucs or pass `--vocals`.
- Upgrade path: swap `fingerprint()` for a neural speaker embedding (speechbrain ECAPA / pyannote) when `torch` and a model download are available — detection, review page and export stay as they are.
