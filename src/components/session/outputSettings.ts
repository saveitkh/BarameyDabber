/** What the finished video should contain, chosen once and remembered on this computer. */
export interface OutputSettings {
  /** Burn the Khmer lines into the picture */
  subtitles: boolean;
  subtitlePosition: 'bottom' | 'top';
  subtitleSize: 'small' | 'medium' | 'large';
  /** clean = music/effects without the original voices, original = whole soundtrack quietly, none = Khmer voices only */
  bgmMode: 'clean' | 'original' | 'none';
  /** 0-150 % */
  bgmVolume: number;
  /** 50-150 % */
  voiceVolume: number;
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
  bgmMode: 'clean',
  bgmVolume: 100,
  voiceVolume: 100,
  scanScope: 'full',
  autoScan: true,
  autoGenerate: false,
};

const STORAGE_KEY = 'cs_output_settings_v1';

export const loadOutputSettings = (): OutputSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_OUTPUT_SETTINGS, ...JSON.parse(raw) };
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
  removeOriginalVocals: s.bgmMode === 'clean',
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
  clean: 'ភ្លេងប៉ុណ្ណោះ',
  original: 'សំឡេងដើមតិចៗ',
  none: 'គ្មានភ្លេង',
};
