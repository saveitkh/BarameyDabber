import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload,
  Play,
  Pause,
  Check,
  Trash2,
  RefreshCw,
  Loader2,
  Sparkles,
  ListMusic,
  Film,
  AudioLines,
  Music2,
  Clapperboard,
  MessageSquareText,
  Cloud,
} from 'lucide-react';
import { CharacterVoice, TimelineSegment } from '../../types';
import { CastCharacter, formatTime, speakerKeyOf, toKhmerNumber } from './castUtils';
import { SegmentsSetter, VoiceCastsState } from './useVoiceCasts';

interface DubbingStudioPanelProps {
  state: VoiceCastsState;
  segments: TimelineSegment[];
  setSegments: SegmentsSetter;
  libraryVoices: CharacterVoice[];
  sourceVideoUrl: string;
  outputVideoUrl: string | null;
  busy: boolean;
  generatingKey: string | null;
  onGenerateAll: () => void;
  onGenerateCharacter: (key: string) => void;
  onShowToast: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

const EMOTIONS: { id: string; label: string; cls: string }[] = [
  { id: 'neutral', label: 'ធម្មតា', cls: 'bg-sky-500/15 text-sky-300 border-sky-400/30' },
  { id: 'happy', label: 'សប្បាយ', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30' },
  { id: 'sad', label: 'សោកសៅ', cls: 'bg-violet-500/15 text-violet-300 border-violet-400/30' },
  { id: 'angry', label: 'ខឹង', cls: 'bg-rose-500/15 text-rose-300 border-rose-400/30' },
  { id: 'excited', label: 'រំភើប', cls: 'bg-amber-500/15 text-amber-300 border-amber-400/30' },
  { id: 'fearful', label: 'ភ័យខ្លាច', cls: 'bg-teal-500/15 text-teal-300 border-teal-400/30' },
];
const emotionOf = (id?: string) => EMOTIONS.find((e) => e.id === id) || EMOTIONS[0];

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
  busy,
  generatingKey,
  onGenerateAll,
  onGenerateCharacter,
  onShowToast,
}) => {
  const { cast, casts, uploadingKey, isCharacterReady, uploadVoice, removeVoice, pickLibraryVoice } = state;
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
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
            />
            {view === 'source' && currentLine?.khmer_translation && (
              <p className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-12 max-w-[90%] text-center text-white text-sm sm:text-base font-bold [text-shadow:0_2px_6px_rgba(0,0,0,0.9)]">
                {currentLine.khmer_translation}
              </p>
            )}
          </div>
        </section>

        {/* ── Character casting table ── */}
        <section className="cs-card flex flex-col min-w-0 overflow-hidden" aria-label="AI Dubbing">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--cs-border)] flex-wrap">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-lg bg-[var(--cs-accent-soft)] text-[var(--cs-accent-text)] flex items-center justify-center">
                <Clapperboard className="w-4 h-4" />
              </span>
              <div>
                <h3 className="text-sm font-bold leading-tight">AI Dubbing</h3>
                <p className="text-[11px] text-[var(--cs-muted)]">
                  ១ តួ = ១ សំឡេង · មានសំឡេង {toKhmerNumber(state.readyCount)}/{toKhmerNumber(cast.length)}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
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

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="text-[10.5px] uppercase tracking-wide text-[var(--cs-muted)]">
                <tr className="border-b border-[var(--cs-border)]">
                  <th className="px-3 py-2 w-8">#</th>
                  <th className="px-2 py-2">តួអង្គ</th>
                  <th className="px-2 py-2">សំឡេង</th>
                  <th className="px-2 py-2">អត្ថបទខ្មែរ</th>
                  <th className="px-2 py-2">អារម្មណ៍</th>
                  <th className="px-1 py-2 w-16">ល្បឿន</th>
                  <th className="px-1 py-2 w-16">កម្ពស់</th>
                  <th className="px-2 py-2 w-10 text-center">ស្ដាប់</th>
                  <th className="px-1 py-2 w-20 text-center">សកម្មភាព</th>
                </tr>
              </thead>
              <tbody>
                {cast.map((c, i) => {
                  const first = segments[c.lineIndexes[0]] || ({} as TimelineSegment);
                  const voice = casts[c.key];
                  const ready = isCharacterReady(c.key);
                  const emo = emotionOf(first.emotion);
                  const speed = first.speed ?? 1;
                  const pitch = first.pitch ?? 0;
                  const sample = characterSample(c);
                  const isGen = generatingKey === c.key;
                  const isUp = uploadingKey === c.key;
                  const genderCls = c.gender === 'female' ? 'cs-marker-female' : 'cs-marker-male';

                  return (
                    <tr key={c.key} className="border-b border-[var(--cs-border)] hover:bg-[var(--cs-sunken)] align-middle">
                      <td className="px-3 py-2.5 font-mono text-[var(--cs-muted)]">{i + 1}</td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-2 min-w-[130px]">
                          {faces[c.key] ? (
                            <img src={faces[c.key]} alt="" className="w-10 h-10 rounded-lg object-cover ring-1 ring-[var(--cs-border-strong)]" />
                          ) : (
                            <span className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold ${genderCls}`}>
                              {c.marker.split(' ')[1]}
                            </span>
                          )}
                          <div className="min-w-0">
                            <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${genderCls}`}>{c.marker}</span>
                            <p className="text-[10.5px] text-[var(--cs-muted)] truncate max-w-[96px] mt-0.5" title={c.detectedName}>
                              {c.detectedName || (c.gender === 'female' ? 'ស្រី' : 'ប្រុស')} · {toKhmerNumber(c.lineIndexes.length)} ឃ្លា
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2.5">
                        {voice ? (
                          <span className="inline-flex items-center gap-1.5 max-w-[130px] rounded-lg border border-[var(--cs-border-strong)] bg-[var(--cs-sunken)] px-2 py-1.5 text-[11px] font-semibold" title={voice.originalName}>
                            <AudioLines className="w-3.5 h-3.5 text-[var(--cs-accent-text)] shrink-0" />
                            <span className="truncate">{voice.originalName || 'សំឡេង Upload'}</span>
                            {voice.cloud && <Cloud className="w-3 h-3 text-[var(--cs-muted)] shrink-0" />}
                          </span>
                        ) : (
                          <select
                            disabled={busy}
                            value={ready ? first.voiceId || '' : ''}
                            onChange={(e) => pickLibraryVoice(c, libraryVoices.find((v) => v.id === e.target.value) || null)}
                            className="w-[130px] rounded-lg border border-[var(--cs-border-strong)] bg-[var(--cs-sunken)] text-[var(--cs-text)] text-[11px] px-2 py-1.5"
                            aria-label={`សំឡេងសម្រាប់ ${c.marker}`}
                          >
                            <option value="">{ready ? 'សំឡេងលំនាំដើម' : 'ជ្រើសសំឡេង…'}</option>
                            {libraryVoices
                              .filter((v) => v.gender === c.gender)
                              .map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.label}
                                </option>
                              ))}
                          </select>
                        )}
                      </td>
                      <td className="px-2 py-2.5">
                        <input
                          key={`${c.key}-${first.khmer_translation}`}
                          defaultValue={first.khmer_translation || ''}
                          disabled={busy}
                          onBlur={(e) => saveLineText(c.lineIndexes[0], e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                          className="w-full min-w-[100px] rounded-lg border border-[var(--cs-border)] bg-[var(--cs-sunken)] text-[var(--cs-text)] text-[11.5px] px-2 py-1.5"
                          aria-label={`អត្ថបទឃ្លាដំបូងរបស់ ${c.marker}`}
                        />
                      </td>
                      <td className="px-2 py-2.5">
                        <select
                          disabled={busy}
                          value={emo.id}
                          onChange={(e) => setCharacterField(c, { emotion: e.target.value })}
                          className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold ${emo.cls}`}
                          aria-label={`អារម្មណ៍ ${c.marker}`}
                        >
                          {EMOTIONS.map((e) => (
                            <option key={e.id} value={e.id} className="bg-[#0c1630] text-white">
                              {e.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2.5">
                        <label className="flex flex-col gap-1">
                          <span className="font-mono text-[11px]">{speed.toFixed(2)}x</span>
                          <input
                            type="range" min={0.7} max={1.4} step={0.05} value={speed} disabled={busy}
                            onChange={(e) => setCharacterField(c, { speed: Number(e.target.value) })}
                            className="w-14 accent-[var(--cs-accent)]"
                            aria-label={`ល្បឿន ${c.marker}`}
                          />
                        </label>
                      </td>
                      <td className="px-2 py-2.5">
                        <label className="flex flex-col gap-1">
                          <span className="font-mono text-[11px]">{pitch > 0 ? `+${pitch}` : pitch}</span>
                          <input
                            type="range" min={-6} max={6} step={1} value={pitch} disabled={busy}
                            onChange={(e) => setCharacterField(c, { pitch: Number(e.target.value) })}
                            className="w-14 accent-[var(--cs-accent)]"
                            aria-label={`កម្ពស់សំឡេង ${c.marker}`}
                          />
                        </label>
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        <button
                          type="button"
                          disabled={!sample}
                          onClick={() => sample && playUrl(sample)}
                          aria-label={`ស្ដាប់ ${c.marker}`}
                          className="w-8 h-8 rounded-full cs-btn-primary inline-flex items-center justify-center disabled:opacity-30"
                        >
                          {playing === sample ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
                        </button>
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            disabled={busy || isUp}
                            onClick={() => openPicker(c)}
                            title={voice ? 'ប្ដូរសំឡេង Upload' : `Upload សំឡេង ${c.marker}`}
                            className={`p-1.5 rounded-md ${voice ? 'cs-btn-ghost' : 'bg-[var(--cs-accent-soft)] text-[var(--cs-accent-text)] ring-1 ring-[var(--cs-accent)]'}`}
                          >
                            {isUp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onGenerateCharacter(c.key)}
                            title={`បង្កើតសំឡេងឃ្លារបស់ ${c.marker}`}
                            className="p-1.5 rounded-md cs-btn-ghost"
                          >
                            {isGen ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                          </button>
                          {voice && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => removeVoice(c)}
                              title="លុបសំឡេង Upload"
                              className="p-1.5 rounded-md cs-btn-ghost"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* ── Timeline / lines ── */}
      <section className="cs-card overflow-hidden" aria-label="Timeline">
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
                { id: 'b', label: 'B1 ភ្លេង (ពេញ)', icon: Music2, color: 'bg-amber-500/20' },
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
          <ol className="max-h-[360px] overflow-y-auto divide-y divide-[var(--cs-border)]">
            {segments.map((s, idx) => {
              const ch = byKey.get(speakerKeyOf(s));
              if (!ch) return null;
              return (
                <li key={`${idx}-${s.start_time}`} className="flex items-center gap-3 px-4 py-2 hover:bg-[var(--cs-sunken)]">
                  <span className="w-6 text-right font-mono text-[10.5px] text-[var(--cs-muted)]">{idx + 1}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold whitespace-nowrap ${ch.gender === 'female' ? 'cs-marker-female' : 'cs-marker-male'}`}>
                    {ch.marker}
                  </span>
                  <button type="button" onClick={() => seek(s.start_time)} className="font-mono text-[10.5px] text-[var(--cs-muted)] hover:text-[var(--cs-text)]">
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
                      onClick={() => openPicker(ch)}
                      className="text-[10.5px] font-bold whitespace-nowrap rounded-full px-2 py-0.5 bg-[var(--cs-accent-soft)] text-[var(--cs-accent-text)]"
                    >
                      ⬆ Upload សំឡេង {ch.marker}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
};
