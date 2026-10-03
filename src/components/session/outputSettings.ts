/** What the finished video should contain, chosen once and remembered on this computer. */
export interface OutputSettings {
  /** Burn the Khmer lines into the picture */
  subtitles: boolean;
  subtitlePosition: 'bottom' | 'top';
  subtitleSize: 'small' | 'medium' | 'large';
  /** auto = like clean, with voice/music levels measured and set by the server;
   *  clean = music/effects without the original voices, original = whole soundtrack quietly, none = Khmer voices only */
  bgmMode: 'auto' | 'clean' | 'original' | 'none';
  /** 0-150 % */
  bgmVolume: number;
  /** 50-150 % */
  voiceVolume: number;
  /** Acted delivery with breathing and pauses (Gemini TTS, or the expressive Khmer voice) */
  naturalVoice: boolean;
  /** 'full' = whole video, '180' = first 3 minutes (quick test) */
  scanScope: 'full' | '180';
  /** Scan lines & characters as soon as a new video finishes uploading */
  autoScan: boolean;
  /** Build the video straight after the automatic scan */
  autoGenerate: boolean;
}

export const DEFAULT_OUTPUT_SETTINGS: OutputSettings = {
  subtitles: true,
  subtitlePosition: 'bottom',
  subtitleSize: 'medium',
  bgmMode: 'auto',
  bgmVolume: 100,
  voiceVolume: 100,
  naturalVoice: true,
  scanScope: 'full',
  autoScan: true,
  autoGenerate: false,
};

const STORAGE_KEY = 'cs_output_settings_v2';
const OLD_STORAGE_KEY = 'cs_output_settings_v1';

export const loadOutputSettings = (): OutputSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_OUTPUT_SETTINGS, ...JSON.parse(raw) };
    const old = localStorage.getItem(OLD_STORAGE_KEY);
    if (old) {
      const prev = { ...DEFAULT_OUTPUT_SETTINGS, ...JSON.parse(old) } as OutputSettings;
      // v1 saved its defaults on any change; move untouched background settings to Auto
      if (prev.bgmMode === 'clean' && prev.bgmVolume === 100 && prev.voiceVolume === 100) prev.bgmMode = 'auto';
      return prev;
    }
  } catch {}
  return DEFAULT_OUTPUT_SETTINGS;
};

export const saveOutputSettings = (s: OutputSettings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
};

/** On-screen px of the subtitle in the ~405px tall preview; the server scales it to the video. */
export const SUBTITLE_FONT_PX: Record<OutputSettings['subtitleSize'], number> = {
  small: 18,
  medium: 22,
  large: 28,
};

/** Fields for /api/dubbing/assemble-custom */
export const toAssemblePayload = (s: OutputSettings) => ({
  removeOriginalVocals: s.bgmMode === 'clean' || s.bgmMode === 'auto',
  naturalVoice: s.naturalVoice,
  bgmMode: s.bgmMode,
  bgmGain: s.bgmMode === 'none' ? 0 : Math.max(0, s.bgmVolume) / 100,
  vocalGain: Number(((2.2 * Math.max(50, s.voiceVolume)) / 100).toFixed(2)),
  burnSubtitles: s.subtitles,
  subtitleStyle: {
    fontSize: SUBTITLE_FONT_PX[s.subtitleSize],
    position: s.subtitlePosition,
    textColor: '#FFFFFF',
    strokeColor: '#000000',
    strokeWidth: 2,
    boxEnabled: false,
  },
});

export const BGM_LABELS: Record<OutputSettings['bgmMode'], string> = {
  auto: 'ភ្លេង Auto',
  clean: 'ភ្លេងប៉ុណ្ណោះ',
  original: 'Voice-over',
  none: 'គ្មានភ្លេង',
};
