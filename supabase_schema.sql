-- =====================================================================
-- ស្ដេចអាទិទេព PRO — Supabase Schema (Run ម្តងទៀតបានដោយសុវត្ថិភាព / idempotent)
-- =====================================================================
-- 1. បើក Supabase Dashboard → SQL Editor → New query
--    (ឧ. https://supabase.com/dashboard/project/<project-ref>/sql/new)
-- 2. Paste script ទាំងមូលនេះ ហើយចុច "RUN" (ឬ Ctrl + Enter)
-- 3. ដាក់ SUPABASE_URL និង SUPABASE_SERVICE_KEY ក្នុង .env រួច Restart Server
--
-- Script នេះអាច Run ច្រើនដងបាន — វានឹងបន្ថែមតែអ្វីដែលខ្វះ (columns/tables/bucket)
-- មិនលុបទិន្នន័យចាស់ទេ។
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    tier TEXT NOT NULL DEFAULT 'free',
    premium_expires_at TIMESTAMPTZ,
    has_voxcpm_license INT DEFAULT 0,
    voxcpm_license_expires_at TIMESTAMPTZ,
    voxcpm_license_key TEXT,
    current_device_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_active INT DEFAULT 1,
    last_login_at TIMESTAMPTZ,
    app_version TEXT DEFAULT 'V2.1PRO'
);

CREATE TABLE IF NOT EXISTS public.sessions (
    token TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    device_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    is_persistent INT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.license_keys (
    id BIGSERIAL PRIMARY KEY,
    key_code TEXT UNIQUE NOT NULL,
    feature TEXT NOT NULL DEFAULT 'voxcpm2',
    days_valid INT NOT NULL DEFAULT 30,
    is_used INT DEFAULT 0,
    used_by_user_id BIGINT REFERENCES public.users(id),
    used_by_username TEXT,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for storing video metadata locally (not video files, just references)
CREATE TABLE IF NOT EXISTS public.video_library (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT,
    filename TEXT NOT NULL,
    original_name TEXT,
    local_path TEXT NOT NULL,
    file_size BIGINT,
    duration FLOAT,
    thumbnail_path TEXT,
    group_id TEXT,
    group_name TEXT,
    processing_status TEXT DEFAULT 'ready',
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for processing jobs with real-time progress
CREATE TABLE IF NOT EXISTS public.processing_jobs (
    id TEXT PRIMARY KEY,
    user_id BIGINT,
    video_id BIGINT REFERENCES public.video_library(id) ON DELETE SET NULL,
    video_filename TEXT,
    job_type TEXT NOT NULL,
    processing_mode TEXT DEFAULT 'pure_khmer',
    status TEXT NOT NULL DEFAULT 'pending',
    progress INT DEFAULT 0,
    message TEXT,
    params JSONB,
    result JSONB,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Table for app versions and updates
CREATE TABLE IF NOT EXISTS public.app_versions (
    id BIGSERIAL PRIMARY KEY,
    version_code TEXT UNIQUE NOT NULL,
    version_name TEXT NOT NULL,
    release_date TIMESTAMPTZ DEFAULT NOW(),
    download_url TEXT,
    changelog JSONB,
    patch_size_mb FLOAT,
    is_mandatory INT DEFAULT 0,
    min_compatible_version TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_device_id ON public.sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_video_library_user_id ON public.video_library(user_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_user_id ON public.processing_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON public.processing_jobs(status);

-- Table for voice library (admin can enable/disable for users)
CREATE TABLE IF NOT EXISTS public.voice_library (
    id BIGSERIAL PRIMARY KEY,
    voice_id TEXT UNIQUE NOT NULL,
    voice_name TEXT NOT NULL,
    voice_label TEXT NOT NULL,
    gender TEXT NOT NULL DEFAULT 'neutral',
    language TEXT DEFAULT 'km',
    sample_path TEXT,
    is_premium INT DEFAULT 0,
    is_admin_only INT DEFAULT 0,
    enabled_for_free INT DEFAULT 1,
    created_by_user_id BIGINT REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for user voice permissions (admin grants access)
CREATE TABLE IF NOT EXISTS public.user_voice_permissions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    voice_id TEXT NOT NULL,
    granted_by_admin_id BIGINT REFERENCES public.users(id),
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    UNIQUE(user_id, voice_id)
);

CREATE INDEX IF NOT EXISTS idx_voice_permissions_user ON public.user_voice_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_voice_library_gender ON public.voice_library(gender);

-- Upgrade older installs (tables created by previous versions of this script)
ALTER TABLE public.video_library ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.video_library DROP CONSTRAINT IF EXISTS video_library_user_id_fkey;
ALTER TABLE public.processing_jobs ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.processing_jobs DROP CONSTRAINT IF EXISTS processing_jobs_user_id_fkey;
ALTER TABLE public.processing_jobs ADD COLUMN IF NOT EXISTS video_filename TEXT;
ALTER TABLE public.processing_jobs ADD COLUMN IF NOT EXISTS processing_mode TEXT DEFAULT 'pure_khmer';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS app_version TEXT DEFAULT 'V2.1PRO';
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS is_persistent INT DEFAULT 1;

-- History + per-mode statistics (mirrors services/unified_db.py)
CREATE TABLE IF NOT EXISTS public.processing_history (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT,
    job_id TEXT,
    processing_mode TEXT NOT NULL,
    video_filename TEXT,
    success INT DEFAULT 0,
    duration_seconds FLOAT,
    output_files JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.mode_usage_stats (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT,
    mode TEXT NOT NULL,
    usage_count INT DEFAULT 0,
    total_duration_seconds FLOAT DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, mode)
);

-- 🎙️ Character Voice Casting (1 តួ = 1 សំឡេង)
-- សំឡេងដែល Upload សម្រាប់តួនីមួយៗ (ប្រុស ១, ស្រី ១ ...) ក្នុងវីដេអូនីមួយៗ
-- ឯកសារសំឡេងពិតប្រាកដរក្សាទុកក្នុង Storage bucket "voice-casts"
CREATE TABLE IF NOT EXISTS public.character_voice_casts (
    id BIGSERIAL PRIMARY KEY,
    owner_key TEXT NOT NULL DEFAULT 'guest',
    user_id BIGINT,
    project_key TEXT NOT NULL,
    speaker_key TEXT NOT NULL,
    marker TEXT,
    gender TEXT DEFAULT 'male',
    voice_id TEXT NOT NULL,
    sample_filename TEXT NOT NULL,
    storage_path TEXT,
    original_name TEXT,
    line_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(owner_key, project_key, speaker_key)
);
CREATE INDEX IF NOT EXISTS idx_voice_casts_project ON public.character_voice_casts(owner_key, project_key);

-- Private storage bucket for uploaded character voice samples (max 20MB, audio only)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('voice-casts', 'voice-casts', false, 20971520, ARRAY['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/ogg', 'audio/webm'])
ON CONFLICT (id) DO NOTHING;

-- 🔒 Security: the app talks to Supabase only from the server with the service/secret
-- key (which bypasses RLS). Enabling RLS without policies blocks the public anon key
-- from reading password hashes, sessions and license keys.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_voice_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mode_usage_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_voice_casts ENABLE ROW LEVEL SECURITY;

-- Seed Master Admin Account (password: @Iam_Cheatm2)
INSERT INTO public.users (username, password_hash, salt, role, tier, created_at, is_active, app_version)
VALUES (
    'cm5722254@gmail.com',
    '3fc5ee60ff03022522866a85289bbdf3088b0e922c96a80d5f3137ea77a54884',
    '3a980f519491f1a11eecb0c2e2d94d40',
    'admin',
    'premium',
    NOW(),
    1,
    'V2.1PRO'
)
ON CONFLICT (username) DO NOTHING;

-- Seed Sample License Keys
INSERT INTO public.license_keys (key_code, feature, days_valid, is_used, created_at)
VALUES 
    ('VOX-D4F4-6A66-A7B3', 'voxcpm2', 365, 0, NOW()),
    ('VOX-VIP-LIFETIME-PRO', 'voxcpm2', 36500, 0, NOW())
ON CONFLICT (key_code) DO NOTHING;

-- Seed Initial App Version
INSERT INTO public.app_versions (version_code, version_name, release_date, changelog, patch_size_mb, is_mandatory, min_compatible_version)
VALUES (
    'V2.2PRO',
    'V2.2PRO',
    NOW(),
    '[
        {"type": "NEW", "text": "Real-time Progress Tracking - ឃើញ % Process ផ្ទាល់ក្នុង Tool ទាំងអស់"},
        {"type": "NEW", "text": "Persistent Login - Login ម្តងមិនចាំបាច់ Login ម្តងទៀតពេលបិទបើកវិញ"},
        {"type": "NEW", "text": "Local Video Storage - វីដេអូរក្សាទុកក្នុង Computer មិនធ្ងន់ Database"},
        {"type": "NEW", "text": "Auto Update System - ចុច Check Version ហើយ Install ស្វ័យប្រវត្តិ"},
        {"type": "IMPROVED", "text": "Glass UI Design - UI ស្អាតប្រើងាយជាមួយ Glass Morphism"},
        {"type": "IMPROVED", "text": "Unified Database - គ្រប់ Options ទាំង 3 ប្រើ Database តែមួយ"}
    ]'::jsonb,
    25.5,
    0,
    'V2.1PRO'
)
ON CONFLICT (version_code) DO NOTHING;

-- Seed Default Voice Library
INSERT INTO public.voice_library (voice_id, voice_name, voice_label, gender, language, is_premium, is_admin_only, enabled_for_free)
VALUES
    ('voxcpm:hang_phleung_char_2_male.mp3', 'Hang Phleung Male Lead', 'ភីកនាយក (ប្រុស)', 'male', 'km', 0, 0, 1),
    ('voxcpm:hang_phleung_char_6_female.mp3', 'Hang Phleung Female Lead', 'ភីកនាង (ស្រី)', 'female', 'km', 0, 0, 1),
    ('voxcpm:kxev_char_01_male.mp3', 'Professional Male 1', 'អ្នកនិយាយប្រុស ១', 'male', 'km', 0, 0, 1),
    ('voxcpm:kxev_char_02_female.mp3', 'Professional Female 1', 'អ្នកនិយាយស្រី ១', 'female', 'km', 0, 0, 1),
    ('voxcpm:main_lead_male.mp3', 'Main Male Voice', 'សំឡេងប្រុសចម្បង', 'male', 'km', 0, 0, 1),
    ('voxcpm:main_lead_female.mp3', 'Main Female Voice', 'សំឡេងស្រីចម្បង', 'female', 'km', 0, 0, 1),
    ('voxcpm:premium_male_hero.mp3', 'Premium Male Hero', 'វីរបុរសប្រុស (VIP)', 'male', 'km', 1, 0, 0),
    ('voxcpm:premium_female_heroine.mp3', 'Premium Female Heroine', 'វីរនារី (VIP)', 'female', 'km', 1, 0, 0),
    ('voxcpm:admin_narrator.mp3', 'Admin Narrator Voice', 'អ្នកនិទានរឿង (Admin)', 'neutral', 'km', 1, 1, 0)
ON CONFLICT (voice_id) DO NOTHING;
