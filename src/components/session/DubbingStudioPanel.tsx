import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Pause,
  Check,
  Loader2,
  Sparkles,
  ListMusic,
  Film,
  AudioLines,
  Music2,
  Clapperboard,
  MessageSquareText,
  X,
} from 'lucide-react';
import { CharacterVoice, TimelineSegment } from '../../types';
import { CastCharacter, characterName, formatTime, pickCloneLines, speakerKeyOf, toKhmerNumber } from './castUtils';
import { CharacterRow } from './CharacterRow';
import { SegmentsSetter, VoiceCastsState } from './useVoiceCasts';

interface DubbingStudioPanelProps {
  state: VoiceCastsState;
  segments: TimelineSegment[];
  setSegments: SegmentsSetter;
  libraryVoices: CharacterVoice[];
  sourceVideoUrl: string;
  outputVideoUrl: string | null;
  /** Live Khmer subtitle on the source preview; null when subtitles are switched off */
  subtitles: { position: 'bottom' | 'top'; size: 'small' | 'medium' | 'large' } | null;
  busy: boolean;
  generatingKey: string | null;
  onGenerateAll: () => void;
  onGenerateCharacter: (key: string) => void;
  onShowToast: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  /** Background mode shown on the B1 track, e.g. "ភ្លេង Auto" */
  bgmLabel?: string;
}

/** Grab one video frame per character (at its first line) to use as its face. */
const useCharacterFaces = (videoUrl: string, cast: CastCharacter[], segments: TimelineSegment[]) => {
  const [faces, setFaces] = useState<Record<string, string>>({});
  const signature = cast.map((c) => `${c.key}@${segments[c.lineIndexes[0]]?.start_time ?? 0}`).join('|');

  useEffect(() => {
    if (!videoUrl || cast.length === 0) return;
    let cancelled = false;
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.src = videoUrl;
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');

    const grab = (t: number) =>
      new Promise<string | null>((resolve) => {
        const done = () => {
          v.removeEventListener('seeked', done);
          try {
            const side = Math.min(v.videoWidth, v.videoHeight);
            // Faces sit in the upper-middle of most shots
            const sx = (v.videoWidth - side) / 2;
            const sy = Math.max(0, (v.videoHeight - side) * 0.25);
            ctx?.drawImage(v, sx, sy, side, side, 0, 0, 96, 96);
            resolve(canvas.toDataURL('image/jpeg', 0.75));
          } catch {
            resolve(null);
          }
        };
        v.addEventListener('seeked', done);
        v.currentTime = Math.max(0, Math.min(t, (v.duration || t) - 0.1));
      });

    v.addEventListener('loadeddata', async () => {
      const out: Record<string, string> = {};
      for (const c of cast) {
        if (cancelled) return;
        const s = segments[c.lineIndexes[0]];
        if (!s) continue;
        const img = await grab((s.start_time + s.end_time) / 2);
        if (img) out[c.key] = img;
      }
      if (!cancelled) setFaces(out);
    });
    return () => {
      cancelled = true;
      v.removeAttribute('src');
      v.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, signature]);

  return faces;
};

export const DubbingStudioPanel: React.FC<DubbingStudioPanelProps> = ({
  state,
  segments,
  setSegments,
  libraryVoices,
  sourceVideoUrl,
  outputVideoUrl,
  subtitles,
  busy,
  generatingKey,
  onGenerateAll,
  onGenerateCharacter,
  onShowToast,
  bgmLabel,
}) => {
  const {
    cast,
    casts,
    uploadingKey,
    isCharacterReady,
    uploadVoice,
    removeVoice,
    pickLibraryVoice,
    setCharacterGender,
    cloneFromLines,
    renameCharacter,
    mergeCharacter,
    moveLine,
  } = state;
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<CastCharacter | null>(null);
  const [view, setView] = useState<'source' | 'output'>('source');
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState<string | null>(null);
  const [tab, setTab] = useState<'timeline' | 'lines'>('timeline');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  /** Lines tab shows only this character's lines */
  const [lineFilter, setLineFilter] = useState<string | null>(null);
  const [previewingLine, setPreviewingLine] = useState<number | null>(null);
  const stopAtRef = useRef<number | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const linesRef = useRef<HTMLElement>(null);

  const faces = useCharacterFaces(sourceVideoUrl, cast, segments);
  const byKey = useMemo(() => new Map(cast.map((c) => [c.key, c])), [cast]);

  useEffect(() => {
    if (outputVideoUrl) setView('output');
  }, [outputVideoUrl]);
  useEffect(() => () => audioRef.current?.pause(), []);

  const videoSrc = view === 'output' && outputVideoUrl ? outputVideoUrl : sourceVideoUrl;
  const total = Math.max(1, duration || 0, ...segments.map((s) => s.end_time || 0));
  const currentLine = segments.find((s) => time >= s.start_time && time < s.end_time);

  // ── audio preview (single shared player, optional queue for "Preview All") ──
  const playUrl = (url: string, queue: string[] = []) => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.onended = () => {
        const next = queueRef.current.shift();
        if (next) playUrl(next, queueRef.current);
        else setPlaying(null);
      };
      audioRef.current.onerror = () => setPlaying(null);
    }
    if (playing === url && queue.length === 0) {
      audioRef.current.pause();
      queueRef.current = [];
      setPlaying(null);
      return;
    }
    queueRef.current = queue;
    audioRef.current.src = url;
    audioRef.current.play().then(() => setPlaying(url)).catch(() => setPlaying(null));
  };

  const previewAll = () => {
    const urls = segments.filter((s) => s.audioUrl).map((s) => s.audioUrl!) as string[];
    if (urls.length === 0) {
      onShowToast('មិនទាន់មានសំឡេងឃ្លាណាទេ — ចុច "បង្កើតសំឡេងទាំងអស់" ជាមុនសិន', 'info');
      return;
    }
    playUrl(urls[0], urls.slice(1));
  };

  const characterSample = (c: CastCharacter): string | null => {
    const generated = c.lineIndexes.map((i) => segments[i]?.audioUrl).find(Boolean);
    if (generated) return generated as string;
    if (casts[c.key]) return casts[c.key].previewUrl;
    const vid = segments[c.lineIndexes[0]]?.voiceId;
    return libraryVoices.find((v) => v.id === vid)?.previewUrl || null;
  };

  const setCharacterField = (c: CastCharacter, patch: Partial<TimelineSegment>) => {
    setSegments((prev) =>
      prev.map((s) => (speakerKeyOf(s) === c.key ? { ...s, ...patch, audioUrl: null, audioVoiceId: null } : s))
    );
  };

  const saveLineText = (idx: number, text: string) => {
    const clean = text.trim();
    setSegments((prev) => {
      if (!prev[idx] || !clean || prev[idx].khmer_translation === clean) return prev;
      const copy = [...prev];
      copy[idx] = { ...copy[idx], khmer_translation: clean, audioUrl: null, audioVoiceId: null };
      return copy;
    });
  };

  const seek = (t: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = t;
      setTime(t);
    }
  };

  // ── Original line preview: plays the line in the video, then stops at its end ──
  const previewLine = (idx: number) => {
    const line = segments[idx];
    const v = videoRef.current;
    if (!line) return;
    audioRef.current?.pause();
    setPlaying(null);
    if (previewingLine === idx) {
      v?.pause();
      stopAtRef.current = null;
      setPreviewingLine(null);
      return;
    }
    stopAtRef.current = line.end_time;
    setPreviewingLine(idx);
    if (view !== 'source' || !v) {
      // The source video re-mounts; seek once its metadata is in
      pendingSeekRef.current = line.start_time;
      setView('source');
      return;
    }
    v.currentTime = line.start_time;
    v.play().catch(() => setPreviewingLine(null));
  };

  const onVideoTime = (v: HTMLVideoElement) => {
    setTime(v.currentTime);
    if (stopAtRef.current !== null && v.currentTime >= stopAtRef.current) {
      v.pause();
      stopAtRef.current = null;
      setPreviewingLine(null);
    }
  };

  // ── Clone characters from their own lines in the movie (music removed on the server) ──
  const [cloningAll, setCloningAll] = useState(false);
  const cloneCandidates = cast.filter((c) => !casts[c.key]);

  const cloneAllFromMovie = async () => {
    if (cloneCandidates.length === 0) return;
    setCloningAll(true);
    onShowToast(`🎬 កំពុងក្លូនសំឡេងតួ ${toKhmerNumber(cloneCandidates.length)} ពីក្នុងរឿង (លុបភ្លេងចេញ)…`, 'info');
    let ok = 0;
    for (const c of cloneCandidates) {
      if (await cloneFromLines(c, pickCloneLines(segments, c.lineIndexes), { quiet: true })) ok += 1;
    }
    setCloningAll(false);
    onShowToast(
      ok > 0
        ? `✓ ក្លូនសំឡេងតួ ${toKhmerNumber(ok)} រួច — ចុច ▶ ស្ដាប់។ បើសំឡេងមិនដូច បើក ˅ ហើយជ្រើសឃ្លាផ្សេង`
        : 'ក្លូនសំឡេងមិនបាន',
      ok > 0 ? 'success' : 'error'
    );
  };

  const showCharacterLines = (c: CastCharacter) => {
    setLineFilter(c.key);
    setTab('lines');
    requestAnimationFrame(() => linesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const openPicker = (c: CastCharacter) => {
    pendingRef.current = c;
    fileRef.current?.click();
  };

  const ticks = useMemo(() => {
    const step = total > 600 ? 60 : total > 180 ? 30 : total > 60 ? 10 : 5;
    const out: number[] = [];
    for (let t = 0; t <= total; t += step) out.push(t);
    return out;
  }, [total]);

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,video/mp4,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && pendingRef.current) uploadVoice(pendingRef.current, f);
        }}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(320px,440px)_minmax(0,1fr)] gap-4 min-w-0">
        {/* ── Video preview with live Khmer subtitle ── */}
        <section className="cs-card overflow-hidden flex flex-col min-w-0" aria-label="វីដេអូ">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--cs-border)]">
            <div className="flex gap-1.5 text-[10px] font-mono text-[var(--cs-muted)]">
              <span className="px-1.5 py-0.5 rounded border border-[var(--cs-border)]">{formatTime(time)}</span>
              <span className="px-1.5 py-0.5 rounded border border-[var(--cs-border)]">/ {formatTime(total)}</span>
            </div>
            {outputVideoUrl && (
              <div role="group" className="flex rounded-lg bg-[var(--cs-sunken)] p-0.5 text-[11px] font-semibold">
                {(['source', 'output'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={`px-2.5 py-1 rounded-md ${view === v ? 'bg-[var(--cs-accent)] text-[var(--cs-on-accent)]' : 'text-[var(--cs-muted)]'}`}
                  >
                    {v === 'source' ? 'វីដេអូដើម' : 'លទ្ធផល (ខ្មែរ)'}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative bg-black aspect-video">
            <video
              ref={videoRef}
              key={videoSrc}
              src={videoSrc}
              controls
              preload="auto"
              className="w-full h-full object-contain"
              onTimeUpdate={(e) => onVideoTime(e.currentTarget)}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                setDuration(v.duration || 0);
                if (pendingSeekRef.current !== null) {
                  v.currentTime = pendingSeekRef.current;
                  pendingSeekRef.current = null;
                  v.play().catch(() => setPreviewingLine(null));
                }
              }}
              onPause={() => {
                if (stopAtRef.current !== null) {
                  stopAtRef.current = null;
                  setPreviewingLine(null);
                }
              }}
            />
            {subtitles && view === 'source' && currentLine?.khmer_translation && (
              <p
                className={`pointer-events-none absolute left-1/2 -translate-x-1/2 max-w-[90%] text-center text-white font-bold [text-shadow:0_0_3px_#000,0_2px_6px_rgba(0,0,0,0.9)] ${
                  subtitles.position === 'top' ? 'top-3' : 'bottom-12'
                } ${subtitles.size === 'small' ? 'text-xs sm:text-sm' : subtitles.size === 'large' ? 'text-base sm:text-xl' : 'text-sm sm:text-base'}`}
              >
                {currentLine.khmer_translation}
              </p>
            )}
          </div>
        </section>

        {/* ── Characters: one card per character ── */}
        <section className="cs-card flex flex-col min-w-0 overflow-hidden" aria-label="AI Dubbing">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--cs-border)] flex-wrap">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-lg bg-[var(--cs-accent-soft)] text-[var(--cs-accent-text)] flex items-center justify-center">
                <Clapperboard className="w-4 h-4" />
              </span>
              <div>
                <h3 className="text-sm font-bold leading-tight">តួអង្គ & សំឡេង</h3>
                <p className="text-[11px] text-[var(--cs-muted)]">
                  ១ តួ = ១ សំឡេង · មានសំឡេង {toKhmerNumber(state.readyCount)}/{toKhmerNumber(cast.length)}
                </p>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {cloneCandidates.length > 0 && (
                <button
                  type="button"
                  disabled={busy || cloningAll || Boolean(uploadingKey)}
                  onClick={cloneAllFromMovie}
                  title="យកសំឡេងពិតរបស់តួនីមួយៗពីក្នុងរឿង (លុបភ្លេងចេញ) ធ្វើជាសំឡេងក្លូន"
                  className="cs-btn-ghost rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-1.5"
                >
                  {cloningAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Film className="w-3.5 h-3.5" />}
                  ក្លូនតួទាំងអស់ពីរឿង ({toKhmerNumber(cloneCandidates.length)})
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={onGenerateAll}
                className="cs-btn-primary rounded-lg px-3.5 py-2 text-xs font-bold flex items-center gap-1.5"
              >
                {busy && !generatingKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                បង្កើតសំឡេងទាំងអស់
              </button>
              <button type="button" onClick={previewAll} className="cs-btn-ghost rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-1.5">
                <ListMusic className="w-3.5 h-3.5" /> ស្ដាប់ទាំងអស់
              </button>
            </div>
          </div>
          <p className="px-4 py-2 text-[10.5px] text-[var(--cs-muted)] border-b border-[var(--cs-border)] leading-relaxed">
            🎬 <b>ពីរឿង</b> = ក្លូនសំឡេងតួពីក្នុងវីដេអូ · 📚 ជ្រើសសំឡេងពីបណ្ណាល័យ · ⬆ Upload សំឡេងផ្ទាល់ខ្លួន · ចុច{' '}
            <b>˅</b> ដើម្បីជ្រើសឃ្លាក្លូន ប្ដូរភេទ ឬបញ្ចូលតួដែល AI ចែកខុស
          </p>

          <ul className="flex flex-col gap-2 p-3 overflow-y-auto max-h-[560px]">
            {cast.map((c, i) => (
              <CharacterRow
                key={c.key}
                index={i}
                c={c}
                cast={cast}
                segments={segments}
                face={faces[c.key]}
                voice={casts[c.key]}
                ready={isCharacterReady(c.key)}
                libraryVoices={libraryVoices}
                sample={characterSample(c)}
                playing={playing}
                previewingLine={c.lineIndexes.includes(previewingLine ?? -1) ? previewingLine : null}
                busy={busy}
                uploading={uploadingKey === c.key}
                generating={generatingKey === c.key}
                anyUploading={Boolean(uploadingKey) || cloningAll}
                expanded={expandedKey === c.key}
                onToggleExpand={() => setExpandedKey((k) => (k === c.key ? null : c.key))}
                onPlay={(url) => playUrl(url)}
                onPreviewLine={previewLine}
                onShowLines={() => showCharacterLines(c)}
                onUpload={() => openPicker(c)}
                onClone={(lines) => cloneFromLines(c, lines)}
                onRemoveVoice={() => removeVoice(c)}
                onPickLibrary={(v) => pickLibraryVoice(c, v)}
                onGenerate={() => onGenerateCharacter(c.key)}
                onGender={(g) => setCharacterGender(c, g)}
                onRename={(name) => renameCharacter(c, name)}
                onMerge={(into) => {
                  mergeCharacter(c, into);
                  setExpandedKey(into.key);
                }}
                onField={(patch) => setCharacterField(c, patch)}
              />
            ))}
          </ul>
        </section>
      </div>

      {/* ── Timeline / lines ── */}
      <section ref={linesRef} className="cs-card overflow-hidden" aria-label="Timeline">
        <div className="flex items-center gap-1 px-3 pt-2 border-b border-[var(--cs-border)]">
          {([
            ['timeline', 'Timeline', Film],
            ['lines', `ឃ្លាសន្ទនា (${toKhmerNumber(segments.length)})`, MessageSquareText],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px ${
                tab === id ? 'border-[var(--cs-accent)] text-[var(--cs-text)]' : 'border-transparent text-[var(--cs-muted)] hover:text-[var(--cs-text)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        {tab === 'timeline' ? (
          <div className="overflow-x-auto">
            <div className="min-w-[760px] grid grid-cols-[120px_1fr] text-[11px]">
              <div />
              <div className="relative h-6 border-b border-[var(--cs-border)] text-[10px] font-mono text-[var(--cs-muted)]">
                {ticks.map((t) => (
                  <span key={t} className="absolute top-1 -translate-x-1/2" style={{ left: `${(t / total) * 100}%` }}>
                    {formatTime(t).slice(0, 5)}
                  </span>
                ))}
              </div>
              {[
                { id: 'v', label: 'V1 វីដេអូ', icon: Film, color: 'bg-slate-500/25' },
                { id: 'a', label: 'A1 សំឡេងខ្មែរ', icon: AudioLines, color: '' },
                { id: 'o', label: 'A2 សំឡេងដើម', icon: AudioLines, color: 'bg-indigo-500/20' },
                { id: 'b', label: `B1 ${bgmLabel || 'ភ្លេង'}`, icon: Music2, color: 'bg-amber-500/20' },
              ].map((track) => (
                <React.Fragment key={track.id}>
                  <div className="flex items-center gap-1.5 px-3 h-10 border-b border-[var(--cs-border)] text-[var(--cs-text-2)] font-semibold">
                    <track.icon className="w-3.5 h-3.5 text-[var(--cs-muted)]" /> {track.label}
                  </div>
                  <div
                    className="relative h-10 border-b border-[var(--cs-border)] cursor-pointer"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      seek(((e.clientX - r.left) / r.width) * total);
                    }}
                  >
                    {track.id === 'a' ? (
                      segments.map((s, idx) => {
                        const ch = byKey.get(speakerKeyOf(s));
                        const female = ch?.gender === 'female';
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              seek(s.start_time);
                            }}
                            title={`${ch?.marker}: ${s.khmer_translation || ''}`}
                            className={`absolute top-1.5 bottom-1.5 rounded-md px-1.5 overflow-hidden text-left text-[10px] font-semibold truncate border ${
                              s.audioUrl ? '' : 'border-dashed opacity-80'
                            } ${female ? 'bg-pink-500/25 border-pink-400/50 text-pink-100' : 'bg-blue-500/25 border-blue-400/50 text-blue-100'}`}
                            style={{ left: `${(s.start_time / total) * 100}%`, width: `${Math.max(0.6, ((s.end_time - s.start_time) / total) * 100)}%` }}
                          >
                            {s.audioUrl && <Check className="inline w-2.5 h-2.5 mr-0.5" />}
                            {s.khmer_translation}
                          </button>
                        );
                      })
                    ) : (
                      <div className={`absolute inset-x-0 top-2 bottom-2 rounded-md ${track.color}`} />
                    )}
                    <span className="pointer-events-none absolute top-0 bottom-0 w-px bg-[var(--cs-accent)]" style={{ left: `${(time / total) * 100}%` }} />
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-1.5 px-4 py-2 border-b border-[var(--cs-border)] overflow-x-auto" role="group" aria-label="បង្ហាញឃ្លារបស់តួ">
              <button
                type="button"
                aria-pressed={!lineFilter}
                onClick={() => setLineFilter(null)}
                className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold whitespace-nowrap ${!lineFilter ? 'bg-[var(--cs-accent)] text-[var(--cs-on-accent)]' : 'cs-btn-ghost'}`}
              >
                ទាំងអស់
              </button>
              {cast.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={lineFilter === c.key}
                  onClick={() => setLineFilter(lineFilter === c.key ? null : c.key)}
                  className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold whitespace-nowrap flex items-center gap-1 ${
                    c.gender === 'female' ? 'cs-marker-female' : 'cs-marker-male'
                  } ${lineFilter === c.key ? 'ring-2 ring-[var(--cs-accent)]' : 'opacity-75 hover:opacity-100'}`}
                >
                  {c.marker}
                  {c.label && <span className="font-normal">· {c.label}</span>}
                  <span className="font-normal opacity-80">({toKhmerNumber(c.lineIndexes.length)})</span>
                  {lineFilter === c.key && <X className="w-3 h-3" />}
                </button>
              ))}
            </div>
          <ol className="max-h-[420px] overflow-y-auto divide-y divide-[var(--cs-border)]">
            {segments.map((s, idx) => {
              const ch = byKey.get(speakerKeyOf(s));
              if (!ch) return null;
              if (lineFilter && ch.key !== lineFilter) return null;
              return (
                <li key={`${idx}-${s.start_time}`} className="flex items-center gap-3 px-4 py-2 hover:bg-[var(--cs-sunken)]">
                  <span className="w-6 text-right font-mono text-[10.5px] text-[var(--cs-muted)]">{idx + 1}</span>
                  <select
                    value={ch.key}
                    disabled={busy}
                    onChange={(e) => {
                      const into = e.target.value === '__new__' ? null : byKey.get(e.target.value);
                      if (into !== undefined) moveLine(idx, into);
                      if (into === null) onShowToast(`ឃ្លាទី ${toKhmerNumber(idx + 1)} ក្លាយជាតួថ្មី — ជ្រើសសំឡេងឲ្យតួនេះខាងលើ`, 'info');
                    }}
                    title="ប្ដូរតួដែលនិយាយឃ្លានេះ"
                    aria-label={`តួដែលនិយាយឃ្លាទី ${idx + 1}`}
                    className={`rounded-full pl-2 pr-1 py-0.5 text-[10.5px] font-bold max-w-[120px] border-0 cursor-pointer ${
                      ch.gender === 'female' ? 'cs-marker-female' : 'cs-marker-male'
                    }`}
                  >
                    {cast.map((o) => (
                      <option key={o.key} value={o.key} className="bg-[var(--cs-surface)] text-[var(--cs-text)]">
                        {o.marker}
                        {o.label || o.detectedName ? ` · ${characterName(o)}` : ''}
                      </option>
                    ))}
                    <option value="__new__" className="bg-[var(--cs-surface)] text-[var(--cs-text)]">
                      ＋ តួថ្មី
                    </option>
                  </select>
                  <button
                    type="button"
                    onClick={() => previewLine(idx)}
                    title="ស្ដាប់ & មើលឃ្លាដើមក្នុងវីដេអូ"
                    className="font-mono text-[10.5px] text-[var(--cs-muted)] hover:text-[var(--cs-text)] flex items-center gap-1"
                  >
                    {previewingLine === idx ? <Pause className="w-2.5 h-2.5" /> : <Film className="w-2.5 h-2.5" />}
                    {formatTime(s.start_time)}
                  </button>
                  <input
                    key={`${idx}-${s.khmer_translation}`}
                    defaultValue={s.khmer_translation || ''}
                    disabled={busy}
                    onBlur={(e) => saveLineText(idx, e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    className="flex-1 min-w-0 bg-transparent border border-transparent hover:border-[var(--cs-border)] focus:border-[var(--cs-accent)] rounded px-2 py-1 text-xs text-[var(--cs-text)]"
                  />
                  {s.audioUrl ? (
                    <button type="button" onClick={() => playUrl(s.audioUrl!)} aria-label={`ស្ដាប់ឃ្លាទី ${idx + 1}`} className="w-7 h-7 rounded-full cs-btn-ghost flex items-center justify-center">
                      {playing === s.audioUrl ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 ml-0.5" />}
                    </button>
                  ) : isCharacterReady(ch.key) ? (
                    <span className="text-[10.5px] text-[var(--cs-muted)] whitespace-nowrap">រង់ចាំបង្កើត</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedKey(ch.key);
                        onShowToast(`ជ្រើសសំឡេងឲ្យ ${ch.marker} នៅក្នុងបញ្ជីតួខាងលើ (🎬 ពីរឿង / 📚 / ⬆)`, 'info');
                      }}
                      className="text-[10.5px] font-bold whitespace-nowrap rounded-full px-2 py-0.5 bg-[var(--cs-accent-soft)] text-[var(--cs-accent-text)]"
                    >
                      ដាក់សំឡេង {ch.marker}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          </div>
        )}
      </section>
    </div>
  );
};
