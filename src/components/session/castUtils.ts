import { TimelineSegment, CastVoice } from '../../types';

const KHMER_DIGITS = ['០', '១', '២', '៣', '៤', '៥', '៦', '៧', '៨', '៩'];

export const toKhmerNumber = (n: number): string =>
  String(n).replace(/\d/g, (d) => KHMER_DIGITS[Number(d)]);

/** Same speaker key the backend uses (scan-timeline / assign_unique_voices_to_segments). */
export const speakerKeyOf = (s: TimelineSegment): string =>
  s.speaker_id || s.speaker_name || 'speaker_1';

export interface CastCharacter {
  key: string;
  /** e.g. "ប្រុស ១", "ស្រី ២" — stable label used everywhere in the session */
  marker: string;
  gender: 'male' | 'female';
  /** 1-based position among characters of the same gender */
  number: number;
  /** Name detected by the AI scan (may be empty or generic) */
  detectedName: string;
  /** Indexes into the segments array, in timeline order */
  lineIndexes: number[];
}

/**
 * Group timeline lines by speaker and give each character a marker:
 * males are numbered ប្រុស ១, ប្រុស ២ … and females ស្រី ១, ស្រី ២ … in order of first appearance.
 */
export const buildCast = (segments: TimelineSegment[]): CastCharacter[] => {
  const order: string[] = [];
  const byKey = new Map<string, { lines: number[]; male: number; female: number; name: string }>();

  segments.forEach((s, idx) => {
    const key = speakerKeyOf(s);
    let entry = byKey.get(key);
    if (!entry) {
      entry = { lines: [], male: 0, female: 0, name: s.speaker_name || '' };
      byKey.set(key, entry);
      order.push(key);
    }
    entry.lines.push(idx);
    if (s.gender === 'female') entry.female += 1;
    else entry.male += 1;
    if (!entry.name && s.speaker_name) entry.name = s.speaker_name;
  });

  const counters = { male: 0, female: 0 };
  return order.map((key) => {
    const e = byKey.get(key)!;
    const gender: 'male' | 'female' = e.female > e.male ? 'female' : 'male';
    counters[gender] += 1;
    const number = counters[gender];
    return {
      key,
      marker: `${gender === 'female' ? 'ស្រី' : 'ប្រុស'} ${toKhmerNumber(number)}`,
      gender,
      number,
      detectedName: e.name,
      lineIndexes: e.lines,
    };
  });
};

/** Point every line of each cast character at that character's uploaded voice. Returns null when nothing changes. */
export const applyCastToSegments = (
  segments: TimelineSegment[],
  casts: Record<string, CastVoice>,
  cast: CastCharacter[]
): TimelineSegment[] | null => {
  const markerByKey = new Map(cast.map((c) => [c.key, c.marker]));
  let changed = false;
  const next = segments.map((s) => {
    const c = casts[speakerKeyOf(s)];
    if (!c || s.voiceId === c.voiceId) return s;
    changed = true;
    return {
      ...s,
      voiceId: c.voiceId,
      voiceFilename: c.filename,
      voiceLabel: `🎙️ ${markerByKey.get(speakerKeyOf(s)) || c.marker} (សំឡេង Upload)`,
      audioUrl: null,
      audioVoiceId: null,
    };
  });
  return changed ? next : null;
};

/** A line needs (re)generation when it has no audio or its audio was made with another voice. */
export const lineNeedsAudio = (s: TimelineSegment): boolean =>
  !s.audioUrl || (!!s.audioVoiceId && s.audioVoiceId !== s.voiceId);

export const formatTime = (sec: number): string => {
  const safe = Math.max(0, sec || 0);
  const m = Math.floor(safe / 60);
  const s = safe - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
};

export const isLicensedUser = (user?: { role?: string; has_voxcpm_license?: boolean | number } | null): boolean =>
  Boolean(user && (user.role === 'admin' || user.has_voxcpm_license));
