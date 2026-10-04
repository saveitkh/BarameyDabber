import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { CastVoice, CharacterVoice, TimelineSegment } from '../../types';
import { applyCastToSegments, buildCast, CastCharacter, speakerKeyOf, toKhmerNumber } from './castUtils';

export type SegmentsSetter = React.Dispatch<React.SetStateAction<TimelineSegment[]>>;
type Toast = (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export interface VoiceCastsState {
  cast: CastCharacter[];
  casts: Record<string, CastVoice>;
  cloudSync: boolean;
  uploadingKey: string | null;
  readyCount: number;
  isCharacterReady: (key: string) => boolean;
  uploadVoice: (character: CastCharacter, file: File, opts?: { cleanVocals?: boolean; quiet?: boolean }) => Promise<boolean>;
  removeVoice: (character: CastCharacter) => Promise<void>;
  pickLibraryVoice: (character: CastCharacter, voice: CharacterVoice | null) => void;
  setCharacterGender: (character: CastCharacter, gender: 'male' | 'female') => void;
  /** Clone the character from the chosen lines of the video itself (music removed on the server) */
  cloneFromLines: (character: CastCharacter, lineIndexes: number[], opts?: { quiet?: boolean }) => Promise<boolean>;
  renameCharacter: (character: CastCharacter, name: string) => void;
  /** Every line of `from` becomes a line of `into` (same voice, same settings) */
  mergeCharacter: (from: CastCharacter, into: CastCharacter) => void;
  /** Give one line to another character, or to a brand-new character when `into` is null */
  moveLine: (lineIndex: number, into: CastCharacter | null) => void;
}

/** Character-level fields a line takes over when it joins another character. */
const joinCharacter = (s: TimelineSegment, template: TimelineSegment | undefined, into: CastCharacter): TimelineSegment => ({
  ...s,
  speaker_id: into.key,
  speaker_name: template?.speaker_name ?? s.speaker_name,
  speaker_label: template?.speaker_label,
  gender: into.gender,
  voiceId: template?.voiceId,
  voiceFilename: template?.voiceFilename,
  voiceLabel: template?.voiceLabel,
  speed: template?.speed,
  pitch: template?.pitch,
  audioUrl: null,
  audioVoiceId: null,
});

/**
 * Keeps 1 character = 1 voice:
 * - a voice uploaded for a character is stored on the server (and Supabase when configured)
 * - every line of that character is pointed at it, including lines found by a later re-scan
 */
export const useVoiceCasts = (
  projectKey: string | null,
  segments: TimelineSegment[],
  setSegments: SegmentsSetter,
  onShowToast: Toast
): VoiceCastsState => {
  const [casts, setCasts] = useState<Record<string, CastVoice>>({});
  const [libraryPicks, setLibraryPicks] = useState<Record<string, string>>({});
  const [cloudSync, setCloudSync] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  const cast = useMemo(() => buildCast(segments), [segments]);

  // Restore voices uploaded earlier for this video (local file or Supabase)
  useEffect(() => {
    setCasts({});
    setLibraryPicks({});
    if (!projectKey) return;
    let cancelled = false;
    api
      .listCastVoices(projectKey)
      .then((res) => {
        if (cancelled) return;
        const map: Record<string, CastVoice> = {};
        (res.casts || []).forEach((c) => {
          if (c.exists !== false) map[c.speakerKey] = c;
        });
        setCasts(map);
        setCloudSync(Boolean(res.cloud));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectKey]);

  // Point all lines of each cast character at its uploaded voice (also after re-scans)
  useEffect(() => {
    if (Object.keys(casts).length === 0) return;
    setSegments((prev) => applyCastToSegments(prev, casts, buildCast(prev)) ?? prev);
  }, [casts, segments, setSegments]);

  const uploadVoice = useCallback(
    async (character: CastCharacter, file: File, opts: { cleanVocals?: boolean; quiet?: boolean } = {}) => {
      if (!projectKey) {
        onShowToast('សូមរង់ចាំវីដេអូ Upload ចូល Server ឱ្យរួចសិន', 'warning');
        return false;
      }
      const looksLikeMedia = file.type.startsWith('audio/') || file.type.startsWith('video/') || /\.(mp3|wav|m4a|aac|ogg|oga|opus|webm|flac|mp4|mov|mkv)$/i.test(file.name);
      if (!looksLikeMedia) {
        onShowToast('សូមជ្រើសឯកសារសំឡេង (.mp3, .wav, .m4a ...)', 'error');
        return false;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        onShowToast('ឯកសារធំពេក (អតិបរមា 50MB) — សំឡេង 10-30 វិនាទីគឺគ្រប់គ្រាន់', 'error');
        return false;
      }

      setUploadingKey(character.key);
      try {
        const res = await api.uploadCastVoice({
          file,
          projectKey,
          speakerKey: character.key,
          marker: character.marker,
          gender: character.gender,
          lineCount: character.lineIndexes.length,
          cleanVocals: opts.cleanVocals,
        });
        setCasts((prev) => ({ ...prev, [character.key]: res.cast }));
        setLibraryPicks((prev) => {
          const { [character.key]: _drop, ...rest } = prev;
          return rest;
        });
        if (!opts.quiet) {
          onShowToast(
            `✓ សំឡេង ${character.marker} រួចរាល់ — ឃ្លាទាំង ${character.lineIndexes.length} នឹងប្រើសំឡេងនេះដូចគ្នា`,
            'success'
          );
        }
        return true;
      } catch (e: any) {
        onShowToast(`Upload សំឡេងមិនបាន: ${e.message}`, 'error');
        return false;
      } finally {
        setUploadingKey(null);
      }
    },
    [projectKey, onShowToast]
  );

  const removeVoice = useCallback(
    async (character: CastCharacter) => {
      if (!projectKey) return;
      try {
        await api.deleteCastVoice(projectKey, character.key);
      } catch (e: any) {
        onShowToast(`លុបមិនបាន: ${e.message}`, 'error');
        return;
      }
      setCasts((prev) => {
        const { [character.key]: _drop, ...rest } = prev;
        return rest;
      });
      setSegments((prev) =>
        prev.map((s) =>
          speakerKeyOf(s) === character.key
            ? { ...s, voiceId: undefined, voiceFilename: undefined, voiceLabel: undefined, audioUrl: null, audioVoiceId: null }
            : s
        )
      );
      onShowToast(`បានលុបសំឡេង ${character.marker}`, 'info');
    },
    [projectKey, setSegments, onShowToast]
  );

  const pickLibraryVoice = useCallback(
    (character: CastCharacter, voice: CharacterVoice | null) => {
      if (!voice) return;
      setLibraryPicks((prev) => ({ ...prev, [character.key]: voice.id }));
      setSegments((prev) =>
        prev.map((s) =>
          speakerKeyOf(s) === character.key
            ? { ...s, voiceId: voice.id, voiceFilename: voice.filename, voiceLabel: voice.label, audioUrl: null, audioVoiceId: null }
            : s
        )
      );
    },
    [setSegments]
  );

  const setCharacterGender = useCallback(
    (character: CastCharacter, gender: 'male' | 'female') => {
      setSegments((prev) =>
        prev.map((s) => (speakerKeyOf(s) === character.key ? { ...s, gender, audioUrl: null, audioVoiceId: null } : s))
      );
    },
    [setSegments]
  );

  const cloneFromLines = useCallback(
    async (character: CastCharacter, lineIndexes: number[], opts: { quiet?: boolean } = {}) => {
      if (!projectKey) {
        onShowToast('សូមរង់ចាំវីដេអូ Upload ចូល Server ឱ្យរួចសិន', 'warning');
        return false;
      }
      const ranges = lineIndexes
        .map((i) => segments[i])
        .filter((s): s is TimelineSegment => Boolean(s) && s.end_time > s.start_time)
        .map((s) => ({ start: s.start_time, end: s.end_time }));
      if (ranges.length === 0) {
        onShowToast(`សូមជ្រើសឃ្លាដែល ${character.marker} និយាយ យ៉ាងហោចណាស់ ១`, 'warning');
        return false;
      }
      setUploadingKey(character.key);
      try {
        const res = await api.castVoiceFromVideo({
          projectKey,
          speakerKey: character.key,
          marker: character.marker,
          gender: character.gender,
          lineCount: character.lineIndexes.length,
          ranges,
          cleanVocals: true,
        });
        setCasts((prev) => ({ ...prev, [character.key]: res.cast }));
        setLibraryPicks((prev) => {
          const { [character.key]: _drop, ...rest } = prev;
          return rest;
        });
        if (!opts.quiet) {
          onShowToast(
            `✓ ក្លូនសំឡេង ${character.marker} ពីរឿង (${toKhmerNumber(ranges.length)} ឃ្លា · ${toKhmerNumber(Math.round(res.seconds))} វិនាទី) — ចុច ▶ ស្ដាប់`,
            'success'
          );
        }
        return true;
      } catch (e: any) {
        onShowToast(`ក្លូនសំឡេង ${character.marker} មិនបាន: ${e.message}`, 'error');
        return false;
      } finally {
        setUploadingKey(null);
      }
    },
    [projectKey, segments, onShowToast]
  );

  const renameCharacter = useCallback(
    (character: CastCharacter, name: string) => {
      const clean = name.trim().slice(0, 40);
      if (clean === character.label) return;
      setSegments((prev) => prev.map((s) => (speakerKeyOf(s) === character.key ? { ...s, speaker_label: clean || undefined } : s)));
    },
    [setSegments]
  );

  const mergeCharacter = useCallback(
    (from: CastCharacter, into: CastCharacter) => {
      if (from.key === into.key) return;
      setSegments((prev) => {
        const template = prev.find((s) => speakerKeyOf(s) === into.key);
        return prev.map((s) => (speakerKeyOf(s) === from.key ? joinCharacter(s, template, into) : s));
      });
      setLibraryPicks((prev) => {
        const { [from.key]: _drop, ...rest } = prev;
        return rest;
      });
      if (casts[from.key]) {
        setCasts((prev) => {
          const { [from.key]: _drop, ...rest } = prev;
          return rest;
        });
        if (projectKey) api.deleteCastVoice(projectKey, from.key).catch(() => {});
      }
      onShowToast(`✓ បានបញ្ចូល ${from.marker} ទៅក្នុង ${into.marker} — ឃ្លាទាំងនោះប្រើសំឡេង ${into.marker}`, 'success');
    },
    [casts, projectKey, setSegments, onShowToast]
  );

  const moveLine = useCallback(
    (lineIndex: number, into: CastCharacter | null) => {
      setSegments((prev) => {
        const line = prev[lineIndex];
        if (!line) return prev;
        const copy = [...prev];
        if (into) {
          if (speakerKeyOf(line) === into.key) return prev;
          copy[lineIndex] = joinCharacter(line, prev.find((s) => speakerKeyOf(s) === into.key), into);
        } else {
          copy[lineIndex] = {
            ...line,
            speaker_id: `custom_${Date.now().toString(36)}`,
            speaker_name: undefined,
            speaker_label: undefined,
            voiceId: undefined,
            voiceFilename: undefined,
            voiceLabel: undefined,
            audioUrl: null,
            audioVoiceId: null,
          };
        }
        return copy;
      });
    },
    [setSegments]
  );

  const isCharacterReady = useCallback(
    (key: string) => Boolean(casts[key] || libraryPicks[key]),
    [casts, libraryPicks]
  );

  const readyCount = cast.filter((c) => isCharacterReady(c.key)).length;

  return {
    cast,
    casts,
    cloudSync,
    uploadingKey,
    readyCount,
    isCharacterReady,
    uploadVoice,
    removeVoice,
    pickLibraryVoice,
    setCharacterGender,
    cloneFromLines,
    renameCharacter,
    mergeCharacter,
    moveLine,
  };
};
