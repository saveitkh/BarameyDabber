import type { CastVoice, TimelineSegment } from './types';

const KHMER_DIGITS = ['០', '១', '២', '៣', '៤', '៥', '៦', '៧', '៨', '៩'];
export const km = (n: number | string): string => String(n).replace(/\d/g, (d) => KHMER_DIGITS[Number(d)]);

export const AUTO_VOICE = 'bank:auto';
export const isBankVoice = (id?: string) => Boolean(id && id.startsWith('bank:'));
export const bankName = (id?: string) => (id && id.startsWith('bank:') ? id.slice(5) : '');

/** Same speaker key the backend uses */
export const speakerKeyOf = (s: TimelineSegment): string => s.speaker_id || s.speaker_name || 'speaker_1';

/** One fixed color per character so they are told apart at a glance everywhere. */
const PALETTE = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#f87171', '#22d3ee', '#fb923c', '#4ade80', '#c084fc', '#38bdf8', '#facc15'];
export const characterColor = (key: string): string => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

export interface Character {
  key: string;
  /** ប្រុស ១, ស្រី ២ … in order of first appearance */
  marker: string;
  gender: 'male' | 'female';
  number: number;
  /** Name typed by the user, else the AI's, else '' */
  name: string;
  lineIndexes: number[];
  /** Voice used by most of the character's lines */
  voiceId: string;
  seconds: number;
}

export const buildCast = (segments: TimelineSegment[]): Character[] => {
  const order: string[] = [];
  const byKey = new Map<string, { lines: number[]; male: number; female: number; name: string; found: string; voices: Map<string, number>; secs: number }>();
  segments.forEach((s, i) => {
    const key = speakerKeyOf(s);
    let e = byKey.get(key);
    if (!e) {
      e = { lines: [], male: 0, female: 0, name: '', found: '', voices: new Map(), secs: 0 };
      byKey.set(key, e);
      order.push(key);
    }
    e.lines.push(i);
    if (s.gender === 'female') e.female += 1;
    else e.male += 1;
    if (!e.name) e.name = s.speaker_label || '';
    if (!e.found) e.found = (s.speaker_name || '').trim();
    const v = s.voiceId || AUTO_VOICE;
    e.voices.set(v, (e.voices.get(v) || 0) + 1);
    e.secs += Math.max(0, (s.end_time || 0) - (s.start_time || 0));
  });
  const counters = { male: 0, female: 0 };
  // The scan's name (a real name, or "តួប្រុសវ័យក្មេង ១") is used until the user renames;
  // a name shared by two characters (older scans) falls back to the ប្រុស ១ / ស្រី ២ marker.
  const foundCount = new Map<string, number>();
  byKey.forEach((e) => e.found && foundCount.set(e.found, (foundCount.get(e.found) || 0) + 1));
  return order.map((key) => {
    const e = byKey.get(key)!;
    const gender: 'male' | 'female' = e.female > e.male ? 'female' : 'male';
    counters[gender] += 1;
    const voiceId = [...e.voices.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || AUTO_VOICE;
    return {
      key,
      marker: `${gender === 'female' ? 'ស្រី' : 'ប្រុស'} ${km(counters[gender])}`,
      gender,
      number: counters[gender],
      name: e.name || (e.found && foundCount.get(e.found) === 1 ? e.found : ''),
      lineIndexes: e.lines,
      voiceId,
      seconds: e.secs,
    };
  });
};

export const displayName = (c: Character) => c.name || c.marker;

/**
 * Lines that make the best clone reference: ~8-15 s of one voice, preferring
 * 1.5-10 s lines (long enough to hear, short enough to hold one speaker).
 */
export const pickCloneLines = (segments: TimelineSegment[], lineIndexes: number[]): number[] => {
  const len = (i: number) => Math.max(0, (segments[i]?.end_time || 0) - (segments[i]?.start_time || 0));
  const ranked = lineIndexes
    .filter((i) => len(i) >= 0.8)
    .sort((a, b) => {
      const ga = len(a) >= 1.5 && len(a) <= 10 ? 0 : 1;
      const gb = len(b) >= 1.5 && len(b) <= 10 ? 0 : 1;
      return ga - gb || len(b) - len(a);
    });
  const picks: number[] = [];
  let total = 0;
  for (const i of ranked) {
    if (total >= 12 || picks.length >= 4) break;
    picks.push(i);
    total += Math.min(10, len(i)) + 0.3;
  }
  if (!picks.length && lineIndexes.length) picks.push(lineIndexes[0]);
  return picks.sort((a, b) => a - b);
};

/** Fresh scan results: sorted, no overlaps, every character on the automatic bank voice. */
export const prepareScannedSegments = (segs: TimelineSegment[]): TimelineSegment[] => {
  const sorted = [...segs].sort((a, b) => (a.start_time || 0) - (b.start_time || 0));
  const out: TimelineSegment[] = [];
  sorted.forEach((s, i) => {
    const item: TimelineSegment = { ...s, line_index: i, voiceId: AUTO_VOICE, voiceFilename: undefined, voiceLabel: undefined, audioUrl: null, audioVoiceId: null };
    const start = Math.max(0, item.start_time || 0);
    const dur = Math.max(0.6, (item.end_time || start + 2) - start);
    const prev = out[out.length - 1];
    const s0 = prev && start < prev.end_time + 0.2 ? prev.end_time + 0.25 : start;
    item.start_time = Number(s0.toFixed(2));
    item.end_time = Number((s0 + dur).toFixed(2));
    out.push(item);
  });
  return out;
};

/** Point every line of a character that has an uploaded/cloned voice at it. Null when nothing changes. */
export const applyCasts = (segments: TimelineSegment[], casts: Record<string, CastVoice>): TimelineSegment[] | null => {
  let changed = false;
  const next = segments.map((s) => {
    const c = casts[speakerKeyOf(s)];
    if (!c || s.voiceId === c.voiceId) return s;
    changed = true;
    return { ...s, voiceId: c.voiceId, voiceFilename: c.filename, audioUrl: null, audioVoiceId: null };
  });
  return changed ? next : null;
};

export const formatTime = (sec: number): string => {
  const t = Math.max(0, sec || 0);
  const m = Math.floor(t / 60);
  const s = Math.floor(t - m * 60);
  return `${km(m)}:${km(String(s).padStart(2, '0'))}`;
};

export const isLicensed = (u?: { role?: string; has_voxcpm_license?: boolean | number } | null) =>
  Boolean(u && (u.role === 'admin' || u.has_voxcpm_license));

export const formatBytes = (b: number) => (b > 0 ? `${(b / (1024 * 1024)).toFixed(1)} MB` : '');
