export interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
  tier: 'premium' | 'free';
  plan?: 'free' | 'monthly' | 'unlimited';
  premium_expires_at?: string | null;
  has_voxcpm_license?: boolean | number;
  voxcpm_license_expires_at?: string | null;
  created_at?: string;
  is_active?: number | boolean;
}

export interface SubscriptionPlan {
  id: 'monthly' | 'unlimited';
  label_km: string;
  label_en: string;
  price_usd: number;
  days: number;
  includesVoxcpm: boolean;
}

export interface SubscriptionStatus {
  plan: 'free' | 'monthly' | 'unlimited';
  isPaid: boolean;
  trialUsed: number;
  trialLimit: number;
  trialRemaining: number;
  expiresAt?: string | null;
}

export interface SubscriptionOrder {
  ticket: string;
  plan: string;
  amount_usd: number;
  status: 'pending' | 'paid' | 'expired';
  created_at: string;
  paid_at?: string | null;
  qrImage?: string;
}

export interface LicenseKey {
  id: number;
  key_code: string;
  feature: string;
  days_valid: number;
  is_used: number | boolean;
  used_by_username?: string | null;
  created_at?: string;
}

export interface TimelineSegment {
  line_index: number;
  start_time: number;
  end_time: number;
  speaker_id?: string;
  speaker_name?: string;
  speaker_role?: string;
  /** Name the user gave this character */
  speaker_label?: string;
  gender?: 'male' | 'female';
  voiceId?: string;
  voiceFilename?: string;
  voiceLabel?: string;
  chinese_text?: string;
  khmer_translation?: string;
  audioUrl?: string | null;
  audioVoiceId?: string | null;
  emotion?: string;
  emotionIntensity?: number;
  speed?: number;
  pitch?: number;
}

/** Voice uploaded (or cut from the video) for one character of one video */
export interface CastVoice {
  speakerKey: string;
  marker: string;
  gender: 'male' | 'female';
  voiceId: string;
  filename: string;
  previewUrl: string;
  originalName?: string;
  exists?: boolean;
}

export interface BankVoice {
  /** "bank:male-adult-1" */
  id: string;
  name: string;
  gender: 'male' | 'female' | 'unknown';
  emotions: string[];
  previewUrl: string;
}

export interface ProjectFile {
  filename: string;
  originalName?: string;
  size: number;
  type?: string;
  url: string;
}

export interface VoxcpmStatus {
  online: boolean;
  configured: boolean;
  mode?: string;
  message?: string;
}

export interface VideoJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  phase: 'queued' | 'voices' | 'mix' | 'video' | 'subtitles' | 'done';
  done: number;
  total: number;
  error: string | null;
  result: null | {
    id: string;
    name: string;
    outputVideo: string;
    outputAudio: string;
    subtitleError?: string | null;
    bgmEngine?: string | null;
  };
}

export interface VideoResult {
  id: string;
  name: string;
  video: string;
  audio: string;
  lines: number;
  hasSubtitles: boolean;
  createdAt: number;
  exists?: boolean;
}

export type ToastType = 'success' | 'error' | 'info' | 'warning';
export type ShowToast = (msg: string, type?: ToastType) => void;

export interface VoiceReport {
  score: number;
  verdict: 'good' | 'ok' | 'poor';
  label: string;
  tips: string[];
  notes: string[];
  metrics: { total: number; speech: number; snr: number; clipped: number; level: number; hf_db: number; off_pitch: number };
}
