import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { CastVoice, CharacterVoice, TimelineSegment } from '../../types';
import { applyCastToSegments, buildCast, CastCharacter, speakerKeyOf } from './castUtils';

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
  uploadVoice: (character: CastCharacter, file: File) => Promise<void>;
  removeVoice: (character: CastCharacter) => Promise<void>;
  pickLibraryVoice: (character: CastCharacter, voice: CharacterVoice | null) => void;
  setCharacterGender: (character: CastCharacter, gender: 'male' | 'female') => void;
}

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
    async (character: CastCharacter, file: File) => {
      if (!projectKey) {
        onShowToast('សូមរង់ចាំវីដេអូ Upload ចូល Server ឱ្យរួចសិន', 'warning');
        return;
      }
      const looksLikeMedia = file.type.startsWith('audio/') || file.type.startsWith('video/') || /\.(mp3|wav|m4a|aac|ogg|oga|opus|webm|flac|mp4|mov|mkv)$/i.test(file.name);
      if (!looksLikeMedia) {
        onShowToast('សូមជ្រើសឯកសារសំឡេង (.mp3, .wav, .m4a ...)', 'error');
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        onShowToast('ឯកសារធំពេក (អតិបរមា 50MB) — សំឡេង 10-30 វិនាទីគឺគ្រប់គ្រាន់', 'error');
        return;
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
        });
        setCasts((prev) => ({ ...prev, [character.key]: res.cast }));
        setLibraryPicks((prev) => {
          const { [character.key]: _drop, ...rest } = prev;
          return rest;
        });
        onShowToast(
          `✓ សំឡេង ${character.marker} រួចរាល់ — ឃ្លាទាំង ${character.lineIndexes.length} នឹងប្រើសំឡេងនេះដូចគ្នា`,
          'success'
        );
      } catch (e: any) {
        onShowToast(`Upload សំឡេងមិនបាន: ${e.message}`, 'error');
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
  };
};
