export interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
  tier: 'premium' | 'free';
  premium_expires_at?: string | null;
  has_voxcpm_license?: boolean | number;
  voxcpm_license_expires_at?: string | null;
  voxcpm_license_key?: string | null;
  current_device_id?: string | null;
  created_at?: string;
}

export interface LicenseKey {
  id: number;
  key_code: string;
  feature: string;
  days_valid: number;
  is_used: number | boolean;
  used_by_user_id?: number | null;
  used_by_username?: string | null;
  used_at?: string | null;
  created_at?: string;
}

export interface CharacterVoice {
  id: string;
  filename: string;
  label: string;
  role_key?: string;
  gender: 'male' | 'female';
  words?: string;
  is_curated?: boolean;
  exists?: boolean;
  previewUrl?: string | null;
  sizeBytes?: number;
}

export interface TimelineSegment {
  line_index: number;
  start_time: number;
  end_time: number;
  speaker_id?: string;
  speaker_name?: string;
  speaker_role?: string;
  /** Name the user gave this character (shown instead of the AI-detected name) */
  speaker_label?: string;
  gender?: 'male' | 'female';
  voiceId?: string;
  voiceFilename?: string;
  voiceLabel?: string;
  chinese_text?: string;
  khmer_translation?: string;
  audioUrl?: string | null;
  // voiceId that produced audioUrl — when the character's voice changes the audio is stale
  audioVoiceId?: string | null;
  movieVoiceSample?: string | null;
  status?: string;
  // Emotional voice parameters
  emotion?: string;
  emotionIntensity?: number;
  emotionParams?: any;
  intensity?: number;
  volume?: number;
  speed?: number;
  pitch?: number;
  breathiness?: number;
  raspiness?: number;
  vibrato?: number;
}

// Voice uploaded for one character of one video (server: /api/cast/voices)
export interface CastVoice {
  speakerKey: string;
  marker: string;
  gender: 'male' | 'female';
  voiceId: string;
  filename: string;
  previewUrl: string;
  originalName?: string;
  lineCount?: number;
  storagePath?: string | null;
  cloud?: boolean;
  exists?: boolean;
  updatedAt?: string;
}

export interface SupabaseStatus {
  configured: boolean;
  connected: boolean;
  host: string;
  keyType: 'secret' | 'service_role' | null;
  tables: Record<string, boolean>;
  voiceBucket: string;
  voiceBucketReady: boolean;
  message: string;
}

export interface ProjectFile {
  id?: string;
  filename: string;
  originalName?: string;
  size: number;
  type?: 'video' | 'audio' | string;
  created?: number;
  url: string;
  duration?: number;
  uploadedAt?: string;
}

export interface StudioConfig {
  hasElevenlabs: boolean;
  hasGemini: boolean;
  geminiModel: string;
  hasVoxcpmUrl: boolean;
  voxcpmUrl: string;
  cloudUrl: string;
  mode: string;
  port: number;
}

export interface VoxcpmStatus {
  online: boolean;
  configured: boolean;
  mode?: string;
  isLocal?: boolean;
  url?: string;
  device?: string;
  gpuName?: string;
  message?: string;
}

export interface WatermarkConfig {
  enabled: boolean;
  text: string;
  type?: 'text' | 'logo';
  position: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'center' | 'free';
  posX?: number; // 0 to 100 percentage (free drag & drop)
  posY?: number; // 0 to 100 percentage (free drag & drop)
  opacity: number; // 10 to 100
  fontSize: number; // 10 to 72
  fontFamily: string; // 'Outfit' | 'Kantumruy Pro' | 'Koulen' | 'Moul'
  textColor: string;
  showBadge: boolean;
  logoUrl?: string;
  scale?: number;
  rotationAngle?: number;
}

export interface VideoStyleTextConfig {
  enabled: boolean;
  title: string;
  subtitle: string;
  badge: string;
  stylePreset: string; // supports 35+ 3D title presets
  position: 'top' | 'center' | 'bottom-left' | 'bottom-right' | 'bottom-center' | 'free';
  posX?: number; // 0 to 100 percentage (free positioning like Thumbnail)
  posY?: number; // 0 to 100 percentage (free positioning like Thumbnail)
  textAlign?: 'left' | 'center' | 'right';
  rotationAngle?: number; // -30 to 30 deg
  fontSize: number;
  subtitleFontSize?: number;
  fontFamily: string;
  showBanner: boolean;
  depth3D?: number; // 0 to 16px 3D extrusion
  glowIntensity?: number; // 0 to 30px glow/bloom
  strokeWidth?: number; // 0 to 14px outer stroke
}

export interface Effect3DPreset {
  id: string;
  label: string;
  category: '3D Spatial & Transforms' | '3D Particles & Atmosphere' | '3D Titles & Typography' | '3D Dynamic Motion & Camera';
  description: string;
  icon?: string;
  transform3d?: string;
  filter3d?: string;
  perspective?: number; // default e.g. 900
  overlayType?: 'none' | 'cyber_grid' | 'starfield' | 'embers' | 'god_rays' | 'matrix_cube' | 'anaglyph' | 'lens_flare' | 'sakura_depth' | 'snow_depth' | 'portal_ring' | 'hologram_rings';
  motionClass?: string;
  titleStylePreset?: string;
}

export interface VideoEffects {
  brightness: number; // 50 to 150 (default 100)
  contrast: number;   // 50 to 150 (default 100)
  saturation: number; // 0 to 200 (default 100)
  sepia: number;      // 0 to 100 (default 0)
  blur: number;       // 0 to 10 (default 0)
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3';
  lutPreset: string;
  // Cinematic Overlays & Effects
  letterbox?: boolean; // Cinema Scope black bars 2.35:1
  vignette?: boolean;  // Darkened edges
  filmGrain?: boolean; // Authentic 35mm grain
  vhsGlitch?: boolean; // CRT scanlines
  glowBloom?: boolean; // Anime dream bloom
  colorTint?: 'none' | 'cyberpunk' | 'golden' | 'horror' | 'emerald';
  // Watermark & Copyright
  watermark?: WatermarkConfig;
  // Styled Video Title / Lower-Third
  styleText?: VideoStyleTextConfig;
  // 3D Effects Engine (100+ Presets)
  effect3dEnabled?: boolean;
  effect3dPreset?: string;
  effect3dIntensity?: number; // 0 to 100
  effect3dDepth?: number;     // 0 to 100
}

export interface SubtitleStyle {
  fontSize: number; // 14 to 48
  fontFamily: string; // 'Kantumruy Pro' | 'Battambang' | 'Moul' | 'Siemreap' | 'Outfit'
  textColor: string; // '#ffffff' | '#fef08a' etc.
  strokeColor: string; // '#000000'
  strokeWidth: number; // 0 to 6
  backgroundColor: string; // 'rgba(0,0,0,0.75)'
  boxEnabled?: boolean;
  position: 'bottom' | 'center' | 'top';
  animation: 'none' | 'pop' | 'karaoke';
  preset?: 'classic' | 'boxed' | 'glow' | 'karaoke' | 'custom';
}

export interface ProjectGroup {
  id: string;
  name: string;
  color: string; // 'cyan' | 'purple' | 'emerald' | 'amber' | 'rose' | 'sky'
  description?: string;
  createdAt: string;
  videoCount?: number;
  maleLeadVoice?: string;
  femaleLeadVoice?: string;
  narratorVoice?: string;
  supportingVoice?: string;
}

export interface VideoShelfItem {
  id: string;
  filename: string;
  originalName: string;
  title?: string;
  size: number;
  duration?: number;
  thumbnail?: string;
  url: string;
  groupId: string;
  groupName: string;
  addedAt: string;
}

export interface HardwareProfile {
  cpuCores: number;
  cpuThreads: number;
  videoEncoder: string;
  encoderLabel: string;
  isGpuAccelerated: boolean;
  turboConcurrency: number;
  hardwareTier: string;
  performanceMode: 'turbo_max' | 'balanced' | 'quality';
}

export interface ThumbnailConfig {
  title: string;
  subtitle: string;
  badge: string;
  watermark: string;
  gradientStyle: string; // 'gold' | 'crimson' | 'cyberpunk' | 'emerald' | 'sapphire' | 'fire' | 'purple' | 'white3d' | 'rainbow'
  vignette: boolean;
  fontSize: number;
  subtitleFontSize?: number;
  aspectRatio: '16:9' | '9:16';

  // Free positioning & alignment
  posX: number; // 0 to 100 percentage
  posY: number; // 0 to 100 percentage
  textAlign: 'left' | 'center' | 'right';
  badgePosX?: number; // 0 to 100 percentage
  badgePosY?: number; // 0 to 100 percentage

  // Visual Effects
  fontFamily: string; // 'Kantumruy Pro' | 'Koulen' | 'Moul' | 'Bayon' | 'Outfit'
  effectStyle: 'gold3d' | 'neon' | 'fire' | 'sapphire' | 'horror' | 'emerald' | 'royal' | 'white3d' | 'rainbow' | 'glass';
  depth3D: number; // 0 to 20
  glowIntensity: number; // 0 to 30
  glowColor?: string;
  strokeWidth: number; // 0 to 20
  strokeColor: string;
  rotationAngle: number; // -45 to +45 deg
  bgBanner: 'none' | 'glass' | 'ribbon' | 'gradient' | 'box';
}

export interface UserThumbnailTemplate {
  id: string;
  name: string;
  createdAt: number;
  config: ThumbnailConfig;
  previewGradient?: string;
  isBuiltin?: boolean;
}

export interface VideoDownloadResult {
  success: boolean;
  filename: string;
  originalName: string;
  size: number;
  type: string;
  url: string;
  duration?: number;
  thumbnail?: string;
  message?: string;
}

export type TabId =
  | 'tab-session'
  | 'tab-dashboard'
  | 'tab-shelf'
  | 'tab-groups'
  | 'tab-workflow'
  | 'tab-dubbing'
  | 'tab-offline'
  | 'tab-manual'
  | 'tab-character'
  | 'tab-translator'
  | 'tab-mixer'
  | 'tab-subtitles'
  | 'tab-tuner'
  | 'tab-thumbnail'
  | 'tab-projects';

// ── 3 Studio Engine Options ──
export type StudioEngineOption =
  | 'voxcpm_computer' // Option 1: VOXCPM2 COMPUTER (Local RTX / PyTorch Hardware)
  | 'voxcpm_claude'   // Option 2: VOXCPM2 CLAUDE (Cloud Server / Claude AI)
  | 'khmer_offline';  // Option 3: KHMER OFFLINE (Ultra-fast Edge / Offline TTS 1-20 episodes)

// ── Offline Episode Video Item for Batch 1-20 ──
export interface OfflineEpisodeItem {
  id: string;
  episodeIndex: number; // 1 to 20
  title: string;
  filename: string;
  url?: string;
  duration?: string;
  sizeMb?: number;
  isSelected: boolean; // Ability to select or deselect
  status: 'ready' | 'processing' | 'done' | 'empty';
}

// ── Khmer Offline Batch Configuration ──
export interface KhmerOfflineConfig {
  batchEpisodes: number; // 1 to 20 episodes
  mode: 'episodes' | 'full_movie'; // Individual episodes vs Single merged full movie
  turboThreads: number; // 2, 4, 8, 16 threads
  voiceId: string;
  episodes?: OfflineEpisodeItem[]; // Batch list of 1 to 20 videos with selection
}

// ── Commercial Video / Ads Overlay Configuration ──
export interface CommercialOverlayConfig {
  enabled: boolean;
  videoUrl: string;
  originalFilename?: string;
  position: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'center';
  size: 'small' | 'medium' | 'large' | 'half';
  opacity: number; // 30 to 100
  startTime: number; // In seconds
  duration: number; // In seconds (0 = full length of ad)
  volume: number; // 0 to 100
  loop: boolean;
}

// ── Custom UI Tool Theme, Background Style & Color Glass ──
export type GlassColorPreset = 'obsidian' | 'cyan' | 'purple' | 'emerald' | 'amber' | 'sakura' | 'ice' | 'crimson';
export type BackgroundPreset =
  | 'clean_white'
  | 'pearl_snow'
  | 'ice_crystal'
  | 'warm_ivory'
  | 'slate_light'
  | 'aurora_light'
  | 'mint_light'
  | 'sakura_light'
  | 'cyberpunk'
  | 'anime_sunset'
  | 'midnight_purple'
  | 'emerald_matrix'
  | 'nebula_space'
  | 'default_dark'
  | 'custom';

export interface StudioCustomSticker {
  id: string;
  url: string;
  name: string;
  x: number; // 0 to 100 percentage
  y: number; // 0 to 100 percentage
  scale: number; // 0.5 to 2.5
  rotation: number; // -180 to 180 deg
}

export interface StudioCustomUITheme {
  wallpaperUrl?: string | null;
  wallpaperOpacity: number; // 10 to 100
  wallpaperBlur: number; // 0 to 20px
  backgroundColor?: string; // Solid or gradient color, e.g. '#ffffff' or CSS gradient
  bgMode?: 'color' | 'wallpaper'; // 'color' for clean pure solid/gradient background, 'wallpaper' for wallpaper image
  accentColor: 'cyan' | 'purple' | 'emerald' | 'amber' | 'rose' | 'sapphire' | 'sky';
  stickers: StudioCustomSticker[];
  // ── Style Background & Color Glass ──
  glassColor?: GlassColorPreset;
  glassOpacity?: number; // 20 to 95
  glassBlur?: number; // 0 to 30px
  glassBorderGlow?: 'subtle' | 'vibrant' | 'neon';
  backgroundPreset?: BackgroundPreset;
  themeMode?: 'light' | 'dark';
}



