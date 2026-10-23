import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { AUTO_VOICE, Character, applyCasts, buildCast, displayName, km, pickCloneLines, speakerKeyOf } from './cast';
import type { CastVoice, ShowToast, TimelineSegment } from './types';

type SetSegments = React.Dispatch<React.SetStateAction<TimelineSegment[]>>;

const MAX_UPLOAD = 50 * 1024 * 1024;

const withVoice = (s: TimelineSegment, voiceId: string): TimelineSegment => ({
  ...s,
  voiceId,
  voiceFilename: undefined,
  voiceLabel: undefined,
  audioUrl: null,
  audioVoiceId: null,
});

/**
 * 1 character = 1 voice. A character's voice is one of:
 *  - bank:auto            the VoxCPM2 bank gives each character its own voice (by gender)
 *  - bank:<name>          one exact bank voice
 *  - voxcpm:cast_…        a voice uploaded for, or cut from the video for, this character
 */
export const useCasting = (projectKey: string | null, segments: TimelineSegment[], setSegments: SetSegments, toast: ShowToast) => {
  const [casts, setCasts] = useState<Record<string, CastVoice>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const cast = useMemo(() => buildCast(segments), [segments]);

  useEffect(() => {
    setCasts({});
    if (!projectKey) return;
    let live = true;
    api
      .listCastVoices(projectKey)
      .then((r) => {
        if (!live) return;
        const map: Record<string, CastVoice> = {};
        (r.casts || []).forEach((c) => {
          if (c.exists !== false) map[c.speakerKey] = c;
        });
        setCasts(map);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [projectKey]);

  useEffect(() => {
    if (Object.keys(casts).length) setSegments((prev) => applyCasts(prev, casts) ?? prev);
  }, [casts, segments, setSegments]);

  const dropCast = useCallback(
    async (c: Character) => {
      if (!casts[c.key] || !projectKey) return;
      setCasts(({ [c.key]: _drop, ...rest }) => rest);
      await api.deleteCastVoice(projectKey, c.key).catch(() => {});
    },
    [casts, projectKey]
  );

  const setVoice = useCallback(
    async (c: Character, voiceId: string) => {
      await dropCast(c);
      setSegments((prev) => prev.map((s) => (speakerKeyOf(s) === c.key ? withVoice(s, voiceId) : s)));
    },
    [dropCast, setSegments]
  );

  const uploadVoice = useCallback(
    async (c: Character, file: File) => {
      if (!projectKey) return;
      if (!/^(audio|video)\//.test(file.type) && !/\.(mp3|wav|m4a|aac|ogg|opus|flac|webm|mp4|mov)$/i.test(file.name)) {
        toast('សូមជ្រើសឯកសារសំឡេង (.mp3, .wav, .m4a …)', 'error');
        return;
      }
      if (file.size > MAX_UPLOAD) {
        toast('ឯកសារធំពេក — សំឡេង ១០–៣០ វិនាទីគឺគ្រប់គ្រាន់', 'error');
        return;
      }
      setBusyKey(c.key);
      try {
        const r = await api.uploadCastVoice({
          file,
          projectKey,
          speakerKey: c.key,
          marker: c.marker,
          gender: c.gender,
          lineCount: c.lineIndexes.length,
        });
        setCasts((p) => ({ ...p, [c.key]: r.cast }));
        toast(`✓ ${displayName(c)} ប្រើសំឡេងដែលបាន Upload គ្រប់ឃ្លា`, 'success');
        // Tell them now if this sample will not clone clearly (best effort: never blocks the upload)
        api
          .checkVoice(file)
          .then(({ report }) => {
            if (report.verdict !== 'good') toast(`${report.label}${report.tips[0] ? ` — ${report.tips[0]}` : ''}`, report.verdict === 'poor' ? 'error' : 'warning');
          })
          .catch(() => {});
      } catch (e: any) {
        toast(`Upload សំឡេងមិនបាន: ${e.message}`, 'error');
      } finally {
        setBusyKey(null);
      }
    },
    [projectKey, toast]
  );

  const cloneFromVideo = useCallback(
    async (c: Character) => {
      if (!projectKey) return;
      const ranges = pickCloneLines(segments, c.lineIndexes)
        .map((i) => segments[i])
        .filter((s) => s && s.end_time > s.start_time)
        .map((s) => ({ start: s.start_time, end: s.end_time }));
      if (!ranges.length) {
        toast('តួនេះមិនមានឃ្លាវែងគ្រប់គ្រាន់សម្រាប់ក្លូនទេ', 'warning');
        return;
      }
      setBusyKey(c.key);
      try {
        const r = await api.castVoiceFromVideo({
          projectKey,
          speakerKey: c.key,
          marker: c.marker,
          gender: c.gender,
          lineCount: c.lineIndexes.length,
          ranges,
        });
        setCasts((p) => ({ ...p, [c.key]: r.cast }));
        toast(`✓ ក្លូនសំឡេង ${displayName(c)} ពីវីដេអូ (${km(Math.round(r.seconds))} វិនាទី)`, 'success');
      } catch (e: any) {
        toast(`ក្លូនមិនបាន: ${e.message}`, 'error');
      } finally {
        setBusyKey(null);
      }
    },
    [projectKey, segments, toast]
  );

  const setGender = useCallback(
    (c: Character, gender: 'male' | 'female') =>
      setSegments((prev) =>
        prev.map((s) =>
          speakerKeyOf(s) === c.key
            ? {
                ...s,
                gender,
                // a scanned label like "តួប្រុសវ័យក្មេង" follows the new gender
                speaker_name: s.character_name
                  ? s.speaker_name
                  : s.speaker_name?.replace(gender === 'female' ? 'ប្រុស' : 'ស្រី', gender === 'female' ? 'ស្រី' : 'ប្រុស'),
                audioUrl: null,
                audioVoiceId: null,
              }
            : s
        )
      ),
    [setSegments]
  );

  const rename = useCallback(
    (c: Character, name: string) => {
      const clean = name.trim().slice(0, 40);
      setSegments((prev) => prev.map((s) => (speakerKeyOf(s) === c.key ? { ...s, speaker_label: clean || undefined } : s)));
    },
    [setSegments]
  );

  /** Every line of `from` becomes a line of `into` (with into's voice). */
  const merge = useCallback(
    async (from: Character, into: Character) => {
      if (from.key === into.key) return;
      await dropCast(from);
      setSegments((prev) => {
        const tpl = prev.find((s) => speakerKeyOf(s) === into.key);
        return prev.map((s) =>
          speakerKeyOf(s) === from.key
            ? { ...withVoice(s, tpl?.voiceId || AUTO_VOICE), speaker_id: into.key, speaker_label: tpl?.speaker_label, gender: into.gender }
            : s
        );
      });
      toast(`✓ បានបញ្ចូល ${displayName(from)} ទៅក្នុង ${displayName(into)}`, 'success');
    },
    [dropCast, setSegments, toast]
  );

  /** Give one line to another character, or to a brand-new one when `into` is null. */
  const moveLine = useCallback(
    (lineIndex: number, into: Character | null) =>
      setSegments((prev) => {
        const line = prev[lineIndex];
        if (!line) return prev;
        const copy = [...prev];
        if (into) {
          const tpl = prev.find((s) => speakerKeyOf(s) === into.key);
          copy[lineIndex] = { ...withVoice(line, tpl?.voiceId || AUTO_VOICE), speaker_id: into.key, speaker_label: tpl?.speaker_label, gender: into.gender };
        } else {
          copy[lineIndex] = { ...withVoice(line, AUTO_VOICE), speaker_id: `custom_${Date.now().toString(36)}`, speaker_name: undefined, speaker_label: undefined };
        }
        return copy;
      }),
    [setSegments]
  );

  const editLine = useCallback(
    (lineIndex: number, text: string) =>
      setSegments((prev) => prev.map((s, i) => (i === lineIndex ? { ...s, khmer_translation: text, audioUrl: null } : s))),
    [setSegments]
  );

  return { cast, casts, busyKey, setVoice, uploadVoice, cloneFromVideo, setGender, rename, merge, moveLine, editLine, dropCast };
};

export type Casting = ReturnType<typeof useCasting>;
