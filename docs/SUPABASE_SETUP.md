# ☁️ ភ្ជាប់ Supabase (Cloud Database + Storage)

កម្មវិធីដំណើរការបានធម្មតាដោយគ្មាន Supabase (ប្រើ SQLite ក្នុងកុំព្យូទ័រ)។
ពេលភ្ជាប់ Supabase៖

- គណនី / Login / License Key ប្រើរួមគ្នាបានគ្រប់ម៉ាស៊ីន
- ប្រវត្តិ Job និងវីដេអូ (metadata) ត្រូវបាន backup ទៅ Cloud
- **សំឡេងតួដែល Upload ក្នុង Session** រក្សាទុកក្នុង Storage bucket `voice-casts` — បើកលើកុំព្យូទ័រផ្សេង វានឹងទាញមកវិញដោយស្វ័យប្រវត្តិ

---

## ជំហានទី ១ — បង្កើត Tables (Run SQL)

1. ចូល [supabase.com/dashboard](https://supabase.com/dashboard) → ជ្រើស Project
2. Menu ខាងឆ្វេង → **SQL Editor** → **New query**
3. Copy ឯកសារ [`supabase_schema.sql`](../supabase_schema.sql) ទាំងមូល → Paste → ចុច **RUN**

✅ Script នេះ **Run ច្រើនដងបាន** — វាបន្ថែមតែអ្វីដែលខ្វះ ហើយមិនលុបទិន្នន័យចាស់ទេ។
បើធ្លាប់ Run កំណែចាស់ (ដែលមាន Error នៅបន្ទាត់ `file_size BIGINT`) សូម Run កំណែថ្មីនេះម្តងទៀត។

Script បង្កើត៖

| Table / Bucket | ប្រើសម្រាប់ |
|---|---|
| `users`, `sessions`, `license_keys` | គណនី, Login 1 ម៉ាស៊ីន, License |
| `processing_jobs`, `video_library`, `processing_history`, `mode_usage_stats` | ប្រវត្តិ Job / វីដេអូ / ស្ថិតិ |
| `voice_library`, `user_voice_permissions` | បណ្ណាល័យសំឡេង និងសិទ្ធិ |
| `character_voice_casts` | សំឡេងតួ (ប្រុស ១, ស្រី ១ …) ក្នុងវីដេអូនីមួយៗ |
| Storage bucket `voice-casts` (private) | ឯកសារសំឡេងតួដែល Upload |

🔒 គ្រប់ Table បើក **Row Level Security** — មានតែ Server (ប្រើ secret key) ទេដែលអាន/សរសេរបាន។
Anon/public key មិនអាចអាន password hash ឬ session បានឡើយ។

---

## ជំហានទី ២ — យក URL និង Key

Dashboard → **Project Settings** → **API Keys** (ឬ **Data API**)៖

- **Project URL** — ឧ. `https://abcdefghijkl.supabase.co`
- **Secret key** (`sb_secret_...`) **ឬ** legacy **service_role** key (`eyJ...`)

⚠️ **កុំប្រើ** `anon` / `publishable` key — វាគ្មានសិទ្ធិគ្រប់គ្រាន់ (RLS បិទ)។
⚠️ **កុំដាក់ secret key ក្នុង Frontend ឬ Push ទៅ GitHub** — ដាក់តែក្នុង `.env` លើ Server។

---

## ជំហានទី ៣ — ដាក់ក្នុង `.env`

បង្កើត/កែឯកសារ `.env` នៅក្នុង Folder កម្មវិធី (ក្បែរ `server.py`)៖

```env
SUPABASE_URL=https://abcdefghijkl.supabase.co
SUPABASE_SERVICE_KEY=sb_secret_xxxxxxxxxxxxxxxxxxxx
# ជាជម្រើស (លំនាំដើម voice-casts)
SUPABASE_VOICE_BUCKET=voice-casts
```

ឈ្មោះ variable ផ្សេងដែលទទួលស្គាល់ផងដែរ៖ `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`។

Render.com / Docker៖ ដាក់ variable ទាំងនេះក្នុង Environment របស់ service (មិនមែនក្នុង code)។

បន្ទាប់មក **Restart Server**។

---

## ជំហានទី ៤ — ពិនិត្យ

- ក្នុងកម្មវិធី៖ ទំព័រ **Session ថ្មី** → ប៊ូតុងជ្រុងខាងលើស្ដាំត្រូវបង្ហាញ 🟢 **Supabase**
  (ចុចលើវាដើម្បីពិនិត្យម្តងទៀត និងមើលសារលម្អិត)
- ឬបើក Browser៖ `http://localhost:3000/api/supabase/status?refresh=true`

ឧទាហរណ៍លទ្ធផលល្អ៖

```json
{
  "configured": true,
  "connected": true,
  "keyType": "secret",
  "tables": { "users": true, "character_voice_casts": true, "...": true },
  "voiceBucketReady": true,
  "message": "Supabase ភ្ជាប់រួចរាល់ 100%"
}
```

---

## បញ្ហាញឹកញាប់

| សារ | ដំណោះស្រាយ |
|---|---|
| `មិនទាន់កំណត់ SUPABASE_URL / SUPABASE_SERVICE_KEY` | ពិនិត្យ `.env` ហើយ Restart Server |
| `តារាង users មិនទាន់មាន` | Run `supabase_schema.sql` (ជំហានទី ១) |
| `Key មិនត្រឹមត្រូវ` | ប្រើ secret / service_role key មិនមែន anon key |
| `ភ្ជាប់បាន ប៉ុន្តែខ្វះ: character_voice_casts, bucket voice-casts` | Run `supabase_schema.sql` ម្តងទៀត (កំណែថ្មី) |
| `មិនអាចភ្ជាប់ទៅ Supabase` | ពិនិត្យ Internet / URL។ កម្មវិធីនៅតែដំណើរការជាមួយ SQLite ហើយព្យាយាមភ្ជាប់ម្តងទៀតរៀងរាល់ ៣០ វិនាទី |
