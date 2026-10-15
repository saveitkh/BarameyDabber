# Khmer Dubber

បញ្ចូលសំឡេងខ្មែរលើវីដេអូ (ចិន / Anime) ដោយក្លូនសំឡេងតួនីមួយៗ — កម្មវិធីទូរស័ព្ទ (Telegram Mini App / PWA)។

## របៀបប្រើ (៣ ជំហាន)

1. **វីដេអូ** — ជ្រើសវីដេអូ ឬបិទភ្ជាប់ Link។ AI ស្កេនឃ្លា បកប្រែ និងបែងចែកតួ (ប្រុស ១, ស្រី ១ …) ដោយស្វ័យប្រវត្តិ។
2. **តួអង្គ & សំឡេង** — តួនីមួយៗមានពណ៌ ឈ្មោះ ភេទ និង **សំឡេងតែមួយ** ដូចគ្នាគ្រប់ឃ្លា៖
   - **Auto** (លំនាំដើម) — VoxCPM2 ផ្ដល់សំឡេងមួយពីធនាគារសំឡេងតាមភេទ ហើយតួពីរមិនជាន់សំឡេងគ្នា
   - សំឡេងជាក់លាក់ពីធនាគារ (ស្ដាប់មុនជ្រើសបាន)
   - ក្លូនពីវីដេអូផ្ទាល់ ឬ Upload សំឡេងគំរូ
   - AI ចែកតួខុស? ប្ដូរឃ្លាទៅតួផ្សេង ឬ "បញ្ចូលតួ"
3. **បង្កើតវីដេអូ** — ប៊ូតុងតែមួយ។ ឯកសារចេញមានឈ្មោះតាមវីដេអូដើម (`<ឈ្មោះ>_khmer.mp4`) ភ្លេងផ្ទៃខាងក្រោយច្បាស់ (ដកសំឡេងចិនចេញ) និងអក្សរខ្មែរ (ជម្រើស)។

## Structure

| Path | What |
| --- | --- |
| `src/` | React + Tailwind mobile app (tabs: Create, Videos, Voices, Account) |
| `server.py`, `services/` | FastAPI backend: auth/Telegram login, KHQR plans, scan, casting, `/api/video/generate` job |
| `voxcpm_server/` | VoxCPM2 2.0.3 voice-clone API (CPU or GPU) with the Khmer voice bank in `voice_bank/` |
| `voxcpm_server/VoxCPM2_Colab_Server.ipynb` | The same server on a Colab GPU (Pro: L4/A100) — put its link in `VOXCPM_URL` on the VPS |
| `android/` | Android WebView wrapper that opens `/mobile` |

## Voice bank

Folder per voice, named `<gender>-<age>-<n>` (e.g. `male-adult-1`), one WAV per emotion (`normal.wav`, `angry.wav`, …) and an optional
`.txt` transcript for "ultimate" cloning. Admins add voices from the **Voices** tab; they persist in the `voxcpm_voices` volume.

## Run

```bash
cp .env.example .env          # GEMINI_API_KEY, STUDIO_ADMIN_PASSWORD
docker compose up -d --build  # studio on :3000 + voxcpm (first start downloads ~5 GB)
```

Dev: `npm run dev` (Vite on :5173, proxies `/api` to the Python server on :3000).

Production (VPS + HTTPS + Telegram bot): see `DEPLOY_VPS.md` in the Project1 repo.


## Plans & payments

Plans live in the database (`services/plans.py`) and are edited by the admin inside the app. Defaults:

| Plan | Price | VoxCPM2 | Standard AI voice | Pro voices | Long video | Own VoxCPM2 link |
|---|---|---|---|---|---|---|
| Free | $0 | 10 min (trial, total) | 30 min (total) | none | no (≤ 10 min) | no |
| Pro | $3 / month | 60 min | 300 min | 3 per video | yes | no |
| Pro Plus | $5 / month | 180 min | unlimited | all | yes | yes |
| Unlimited | $30 / year | unlimited | unlimited | all | yes | yes |

* **Everything is counted in minutes** of finished video. A video voiced by VoxCPM2 on the shared server is charged to the
  VoxCPM2 minutes; one voiced by the standard AI voice (also when VoxCPM2 minutes run out) is charged to the AI-voice minutes.
* **One video is at most 10 minutes** so voice cloning stays clear. Longer videos (Pro and up, max `MAX_LONG_MINUTES`, default 120)
  are cut at upload into ≤ 10-minute parts; the member dubs each part, then **merges** them into one video (`POST /api/video/merge`).
* **No Khmer subtitles** are burned into videos.
* **Privacy**: uploads and results belong to their owner (`data/media_owners.json`); `/media/*` returns 403 to anyone else
  (admin excepted) and uploaded files cannot be scanned/dubbed by another member.
* **Pro voices** are bank voices the admin stars (Voices tab). `bank:auto` assigns Pro voices first, within the plan's limit.
* **Own VoxCPM2 link** (Account tab) sends that member's lines to their own server (Colab GPU) and never uses the minutes.
* **KHQR** works like NINTPLEX: paste a KHQR your bank app made (up to two banks); per order only the amount (and optionally the
  display name) is swapped. Orders are confirmed by Bakong (`BAKONG_API_TOKEN`) or by the admin from the receipt screenshot
  (admins get a Telegram message).
