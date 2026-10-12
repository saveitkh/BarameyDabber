import type { CSSProperties } from 'react';
import { TimelineSegment, CastVoice } from '../../types';

const KHMER_DIGITS = ['០', '១', '២', '៣', '៤', '៥', '៦', '៧', '៨', '៩'];

export const toKhmerNumber = (n: number): string =>
  String(n).replace(/\d/g, (d) => KHMER_DIGITS[Number(d)]);

/** Same speaker key the backend uses (scan-timeline / assign_unique_voices_to_segments). */
export const speakerKeyOf = (s: TimelineSegment): string =>
  s.speaker_id || s.speaker_name || 'speaker_1';

/**
 * One fixed, saturated color per character key -- used everywhere a
 * character needs to be told apart at a glance: timeline segment blocks,
 * their waveform, the cast filter chips, the casting list. 12 hues spaced
 * far enough apart to stay distinct even for a same-gender cast, picked by
 * a stable hash of the key so a given character keeps its color across
 * reloads and across every place it's drawn.
 */
const CHARACTER_PALETTE = [
  '#60a5fa', // blue
  '#f472b6', // pink
  '#34d399', // emerald
  '#fbbf24', // amber
  '#a78bfa', // violet
  '#f87171', // red
  '#22d3ee', // cyan
  '#fb923c', // orange
  '#4ade80', // green
  '#c084fc', // purple
  '#38bdf8', // sky
  '#fcd34d', // yellow
] as const;

const hashKey = (key: string): number => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
};

/** The hex color assigned to a character key (stable across reloads). */
export const characterColor = (key: string): string =>
  CHARACTER_PALETTE[hashKey(key) % CHARACTER_PALETTE.length];

/** CSS custom properties for a character's color, spread onto any element's `style`. */
export const characterColorVars = (key: string): CSSProperties => {
  const hex = characterColor(key);
  return { ['--char-color' as any]: hex, color: hex };
};

export interface CastCharacter {
  key: string;
  /** e.g. "ប្រុស ១", "ស្រី ២" — stable label used everywhere in the session */
  marker: string;
  gender: 'male' | 'female';
  /** 1-based position among characters of the same gender */
  number: number;
  /** Name detected by the AI scan (may be empty or generic) */
  detectedName: string;
  /** Name the user typed for this character ('' when not renamed) */
  label: string;
  /** Indexes into the segments array, in timeline order */
  lineIndexes: number[];
}

/**
 * Group timeline lines by speaker and give each character a marker:
 * males are numbered ប្រុស ១, ប្រុស ២ … and females ស្រី ១, ស្រី ២ … in order of first appearance.
 */
export const buildCast = (segments: TimelineSegment[]): CastCharacter[] => {
  const order: string[] = [];
  const byKey = new Map<string, { lines: number[]; male: number; female: number; name: string; label: string }>();

  segments.forEach((s, idx) => {
    const key = speakerKeyOf(s);
    let entry = byKey.get(key);
    if (!entry) {
      entry = { lines: [], male: 0, female: 0, name: s.speaker_name || '', label: s.speaker_label || '' };
      byKey.set(key, entry);
      order.push(key);
    }
    entry.lines.push(idx);
    if (s.gender === 'female') entry.female += 1;
    else entry.male += 1;
    if (!entry.name && s.speaker_name) entry.name = s.speaker_name;
    if (!entry.label && s.speaker_label) entry.label = s.speaker_label;
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
      label: e.label,
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

/** What to call a character on screen: the user's name, else the AI's, else ប្រុស/ស្រី. */
export const characterName = (c: CastCharacter): string =>
  c.label || c.detectedName || (c.gender === 'female' ? 'ស្រី' : 'ប្រុស');

const lineSeconds = (s?: TimelineSegment) => Math.max(0, (s?.end_time || 0) - (s?.start_time || 0));

/** Seconds of speech a set of lines gives a clone (each line capped like the server does). */
export const cloneSeconds = (segments: TimelineSegment[], lineIndexes: number[]): number =>
  lineIndexes.reduce((sum, i) => sum + Math.min(12, lineSeconds(segments[i])), 0);

/**
 * The lines that make the best clone reference: ~8-15 s of one voice, preferring
 * lines of 1.5-10 s (long enough to hear the voice, short enough to hold one speaker).
 * Same rule as the server's automatic movie sample.
 */
export const pickCloneLines = (segments: TimelineSegment[], lineIndexes: number[]): number[] => {
  const ranked = [...lineIndexes]
    .filter((i) => lineSeconds(segments[i]) >= 0.8)
    .sort((a, b) => {
      const la = lineSeconds(segments[a]);
      const lb = lineSeconds(segments[b]);
      const ga = la >= 1.5 && la <= 10 ? 0 : 1;
      const gb = lb >= 1.5 && lb <= 10 ? 0 : 1;
      return ga - gb || lb - la;
    });
  const picks: number[] = [];
  let total = 0;
  for (const i of ranked) {
    if (total >= 12 || picks.length >= 4) break;
    picks.push(i);
    total += Math.min(10, lineSeconds(segments[i])) + 0.3;
  }
  if (picks.length === 0 && lineIndexes.length) picks.push(lineIndexes[0]);
  return picks.sort((a, b) => a - b);
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
