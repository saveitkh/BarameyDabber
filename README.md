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

| Plan | Price | VoxCPM2 | Pro voices | Own VoxCPM2 link |
|---|---|---|---|---|
| Free | $0 | 5 trial videos, then the standard AI voice | none | no |
| Pro | $3 / month | 20 videos / term | 3 per video | no |
| Pro Plus | $5 / month | 60 videos / term | all | yes |
| Unlimited | $30 / year | unlimited | all | yes |

* One "VoxCPM2 video" = one finished video where VoxCPM2 on the shared server voiced at least one line.
  When the quota is used up the video is still made, with the standard AI voice.
* **Pro voices** are bank voices the admin stars (Voices tab). `bank:auto` assigns Pro voices first, within the plan's limit.
* **Own VoxCPM2 link** (Account tab) sends that member's lines to their own server (Colab GPU) and never uses the quota.
* **KHQR** works like NINTPLEX: paste a KHQR your bank app made (up to two banks); per order only the amount (and optionally the
  display name) is swapped. Orders are confirmed by Bakong (`BAKONG_API_TOKEN`) or by the admin from the receipt screenshot
  (admins get a Telegram message).
