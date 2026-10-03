import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload,
  Play,
  Pause,
  Check,
  Cloud,
  Trash2,
  RefreshCw,
  Pencil,
  Loader2,
  Users,
  MessageSquareText,
  X,
} from 'lucide-react';
import { CharacterVoice, TimelineSegment } from '../../types';
import { CastCharacter, formatTime, speakerKeyOf, toKhmerNumber } from './castUtils';
import { SegmentsSetter, VoiceCastsState } from './useVoiceCasts';

interface CharacterCastBoardProps {
  state: VoiceCastsState;
  segments: TimelineSegment[];
  setSegments: SegmentsSetter;
  libraryVoices?: CharacterVoice[];
  /** Locks editing while lines are being generated */
  disabled?: boolean;
}

const MarkerChip: React.FC<{ character: CastCharacter; size?: 'sm' | 'md' }> = ({ character, size = 'sm' }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full font-bold whitespace-nowrap ${
      character.gender === 'female' ? 'cs-marker-female' : 'cs-marker-male'
    } ${size === 'md' ? 'px-3 py-1 text-[13px]' : 'px-2 py-0.5 text-[11px]'}`}
  >
    <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
    {character.marker}
  </span>
);

/** One shared <audio> so only one preview plays at a time. */
const useAudioPreview = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);

  useEffect(() => () => audioRef.current?.pause(), []);

  const toggle = (url: string) => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.onended = () => setPlayingUrl(null);
      audioRef.current.onerror = () => setPlayingUrl(null);
    }
    const a = audioRef.current;
    if (playingUrl === url) {
      a.pause();
      setPlayingUrl(null);
      return;
    }
    a.src = url;
    a.play().then(() => setPlayingUrl(url)).catch(() => setPlayingUrl(null));
  };

  return { playingUrl, toggle };
};

export const CharacterCastBoard: React.FC<CharacterCastBoardProps> = ({
  state,
  segments,
  setSegments,
  libraryVoices = [],
  disabled = false,
}) => {
  const { cast, casts, uploadingKey, isCharacterReady, uploadVoice, removeVoice, pickLibraryVoice, setCharacterGender } = state;
  const [filterKey, setFilterKey] = useState<string>('all');
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingCharRef = useRef<CastCharacter | null>(null);
  const { playingUrl, toggle } = useAudioPreview();

  const characterByKey = useMemo(() => new Map(cast.map((c) => [c.key, c])), [cast]);

  useEffect(() => {
    if (filterKey !== 'all' && !characterByKey.has(filterKey)) setFilterKey('all');
  }, [characterByKey, filterKey]);

  const openPicker = (character: CastCharacter) => {
    if (disabled) return;
    pendingCharRef.current = character;
    fileInputRef.current?.click();
  };

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const character = pendingCharRef.current;
    e.target.value = '';
    if (file && character) uploadVoice(character, file);
  };

  const onDrop = (character: CastCharacter, e: React.DragEvent) => {
    e.preventDefault();
    setDragKey(null);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) uploadVoice(character, file);
  };

  const saveEdit = (idx: number) => {
    const text = editText.trim();
    setSegments((prev) => {
      const copy = [...prev];
      if (copy[idx] && text && text !== copy[idx].khmer_translation) {
        copy[idx] = { ...copy[idx], khmer_translation: text, audioUrl: null, audioVoiceId: null };
      }
      return copy;
    });
    setEditingIdx(null);
  };

  const visibleLines = segments
    .map((s, idx) => ({ s, idx }))
    .filter(({ s }) => filterKey === 'all' || speakerKeyOf(s) === filterKey);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,380px)_1fr] gap-5 min-h-0">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,video/mp4,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm"
        className="hidden"
        onChange={onFileChosen}
      />

      {/* ── Characters: one voice each ── */}
      <section aria-label="តួអង្គ និងសំឡេង" className="flex flex-col gap-3 min-w-0">
        <div className="flex items-center justify-between px-1">
          <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--cs-text)]">
            <Users className="w-4 h-4 text-[var(--cs-muted)]" />
            តួអង្គ & សំឡេង
          </h3>
          <span className="text-xs text-[var(--cs-muted)]">
            មានសំឡេង {toKhmerNumber(state.readyCount)}/{toKhmerNumber(cast.length)}
          </span>
        </div>

        {cast.map((c) => {
          const voice = casts[c.key];
          const ready = isCharacterReady(c.key);
          const isUploading = uploadingKey === c.key;
          const isActive = filterKey === c.key;
          const lineCount = toKhmerNumber(c.lineIndexes.length);

          return (
            <article
              key={c.key}
              onDragOver={(e) => {
                e.preventDefault();
                if (!disabled) setDragKey(c.key);
              }}
              onDragLeave={() => setDragKey((k) => (k === c.key ? null : k))}
              onDrop={(e) => onDrop(c, e)}
              className={`cs-card p-4 flex flex-col gap-3 transition-colors ${
                isActive ? 'ring-2 ring-[var(--cs-accent)] ring-offset-0' : ''
              } ${dragKey === c.key ? 'border-[var(--cs-accent)] bg-[var(--cs-accent-soft)]' : ''}`}
            >
              <button
                type="button"
                onClick={() => setFilterKey(isActive ? 'all' : c.key)}
                className="flex items-center gap-2.5 text-left min-w-0 rounded-lg -m-1 p-1 hover:bg-[var(--cs-sunken)]"
                title="បង្ហាញតែឃ្លារបស់តួនេះ"
              >
                <MarkerChip character={c} size="md" />
                <span className="flex-1 min-w-0 truncate text-xs text-[var(--cs-muted)]">{c.detectedName}</span>
                <span className="text-xs font-semibold text-[var(--cs-text-2)] whitespace-nowrap">{lineCount} ឃ្លា</span>
              </button>

              {voice ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2.5 rounded-xl bg-[var(--cs-sunken)] px-2.5 py-2">
                    <button
                      type="button"
                      onClick={() => toggle(voice.previewUrl)}
                      aria-label={playingUrl === voice.previewUrl ? 'ផ្អាក' : 'ស្ដាប់សំឡេង'}
                      className="w-8 h-8 shrink-0 rounded-full cs-btn-primary flex items-center justify-center"
                    >
                      {playingUrl === voice.previewUrl ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold truncate text-[var(--cs-text)]">
                        {voice.originalName || 'សំឡេង Upload'}
                      </p>
                      <p className="text-[11px] text-[var(--cs-muted)] flex items-center gap-1">
                        {voice.cloud ? (
                          <>
                            <Cloud className="w-3 h-3" /> រក្សាទុកក្នុង Supabase
                          </>
                        ) : (
                          'រក្សាទុកក្នុងកុំព្យូទ័រ'
                        )}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-[var(--cs-ok)] flex items-start gap-1.5">
                    <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    ឃ្លាទាំង {lineCount} របស់ {c.marker} ប្រើសំឡេងនេះដូចគ្នា ដោយស្វ័យប្រវត្តិ
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={disabled || isUploading}
                      onClick={() => openPicker(c)}
                      className="cs-btn-ghost flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center justify-center gap-1.5"
                    >
                      {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      ប្ដូរសំឡេង
                    </button>
                    <button
                      type="button"
                      disabled={disabled || isUploading}
                      onClick={() => removeVoice(c)}
                      aria-label={`លុបសំឡេង ${c.marker}`}
                      className="cs-btn-ghost rounded-lg px-2.5 py-1.5 text-xs"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={disabled || isUploading}
                    onClick={() => openPicker(c)}
                    className="w-full rounded-xl border-2 border-dashed border-[var(--cs-border-strong)] hover:border-[var(--cs-accent)] hover:bg-[var(--cs-accent-soft)] px-3 py-4 flex flex-col items-center gap-1 transition-colors disabled:opacity-50"
                  >
                    {isUploading ? (
                      <Loader2 className="w-5 h-5 animate-spin text-[var(--cs-accent)]" />
                    ) : (
                      <Upload className="w-5 h-5 text-[var(--cs-accent)]" />
                    )}
                    <span className="text-[13px] font-bold text-[var(--cs-accent-text)]">
                      {isUploading ? 'កំពុង Upload...' : `Upload សំឡេង ${c.marker}`}
                    </span>
                    <span className="text-[11px] text-[var(--cs-muted)]">ទាញដាក់ ឬចុច · សំឡេងស្អាត ១០–៣០ វិនាទី</span>
                  </button>

                  {libraryVoices.length > 1 && (
                    <select
                      disabled={disabled}
                      value={ready ? segments[c.lineIndexes[0]]?.voiceId || '' : ''}
                      onChange={(e) => pickLibraryVoice(c, libraryVoices.find((v) => v.id === e.target.value) || null)}
                      className="w-full rounded-lg border border-[var(--cs-border)] bg-[var(--cs-surface)] text-[var(--cs-text-2)] text-xs px-2.5 py-1.5"
                      aria-label={`ជ្រើសសំឡេងពីបណ្ណាល័យសម្រាប់ ${c.marker}`}
                    >
                      <option value="">ឬជ្រើសសំឡេងពីបណ្ណាល័យ…</option>
                      {libraryVoices
                        .filter((v) => v.gender === c.gender)
                        .map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between pt-1 border-t border-[var(--cs-border)]">
                <span className="text-[11px] text-[var(--cs-muted)]">ភេទតួ (បើ AI ច្រឡំ អាចប្ដូរ)</span>
                <div role="group" aria-label="ភេទតួ" className="flex rounded-lg bg-[var(--cs-sunken)] p-0.5">
                  {(['male', 'female'] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      disabled={disabled}
                      aria-pressed={c.gender === g}
                      onClick={() => c.gender !== g && setCharacterGender(c, g)}
                      className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${
                        c.gender === g
                          ? 'bg-[var(--cs-surface)] text-[var(--cs-text)] shadow-sm'
                          : 'text-[var(--cs-muted)] hover:text-[var(--cs-text)]'
                      }`}
                    >
                      {g === 'male' ? 'ប្រុស' : 'ស្រី'}
                    </button>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {/* ── Lines: each shows which character speaks and whether its voice is ready ── */}
      <section aria-label="ឃ្លាសន្ទនា" className="cs-card flex flex-col min-h-0 min-w-0 overflow-hidden">
        <div className="px-4 pt-4 pb-3 border-b border-[var(--cs-border)] flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <MessageSquareText className="w-4 h-4 text-[var(--cs-muted)]" />
            ឃ្លាសន្ទនា
            <span className="text-xs font-normal text-[var(--cs-muted)]">({toKhmerNumber(segments.length)})</span>
          </h3>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1" role="tablist" aria-label="ច្រោះតាមតួ">
            <button
              type="button"
              role="tab"
              aria-selected={filterKey === 'all'}
              onClick={() => setFilterKey('all')}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold border transition-colors ${
                filterKey === 'all'
                  ? 'bg-[var(--cs-text)] text-[var(--cs-bg)] border-transparent'
                  : 'border-[var(--cs-border)] text-[var(--cs-text-2)] hover:bg-[var(--cs-sunken)]'
              }`}
            >
              ទាំងអស់
            </button>
            {cast.map((c) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={filterKey === c.key}
                onClick={() => setFilterKey(c.key)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold border transition-colors flex items-center gap-1.5 ${
                  filterKey === c.key
                    ? 'bg-[var(--cs-text)] text-[var(--cs-bg)] border-transparent'
                    : 'border-[var(--cs-border)] text-[var(--cs-text-2)] hover:bg-[var(--cs-sunken)]'
                }`}
              >
                {c.marker}
                <span className="opacity-60">{toKhmerNumber(c.lineIndexes.length)}</span>
                {!isCharacterReady(c.key) && <span aria-label="មិនទាន់មានសំឡេង" className="w-1.5 h-1.5 rounded-full bg-[var(--cs-accent)]" />}
              </button>
            ))}
          </div>
        </div>

        <ol className="flex-1 overflow-y-auto divide-y divide-[var(--cs-border)]">
          {visibleLines.map(({ s, idx }) => {
            const c = characterByKey.get(speakerKeyOf(s));
            if (!c) return null;
            const ready = isCharacterReady(c.key);
            const isEditing = editingIdx === idx;

            return (
              <li key={`${idx}-${s.start_time}`} className="px-4 py-3 flex gap-3 hover:bg-[var(--cs-sunken)]">
                <span className="w-7 shrink-0 pt-0.5 text-[11px] font-mono text-[var(--cs-muted)] text-right">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <MarkerChip character={c} />
                    <span className="text-[11px] font-mono text-[var(--cs-muted)]">
                      {formatTime(s.start_time)} – {formatTime(s.end_time)}
                    </span>
                  </div>

                  {isEditing ? (
                    <div className="flex flex-col gap-1.5">
                      <textarea
                        autoFocus
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            saveEdit(idx);
                          } else if (e.key === 'Escape') {
                            setEditingIdx(null);
                          }
                        }}
                        rows={2}
                        className="w-full rounded-lg border border-[var(--cs-border-strong)] bg-[var(--cs-surface)] text-[var(--cs-text)] text-sm px-2.5 py-1.5 resize-y"
                      />
                      <div className="flex gap-1.5">
                        <button type="button" onClick={() => saveEdit(idx)} className="cs-btn-primary rounded-md px-2.5 py-1 text-xs font-semibold">
                          រក្សាទុក
                        </button>
                        <button type="button" onClick={() => setEditingIdx(null)} className="cs-btn-ghost rounded-md px-2 py-1 text-xs" aria-label="បោះបង់">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm leading-relaxed text-[var(--cs-text)] group">
                      {s.khmer_translation || <span className="text-[var(--cs-muted)] italic">(គ្មានអត្ថបទ)</span>}
                      {!disabled && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingIdx(idx);
                            setEditText(s.khmer_translation || '');
                          }}
                          className="ml-1.5 inline-flex align-middle p-1 rounded text-[var(--cs-muted)] hover:text-[var(--cs-text)] hover:bg-[var(--cs-sunken)]"
                          aria-label={`កែអត្ថបទឃ្លាទី ${idx + 1}`}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                    </p>
                  )}
                  {s.chinese_text && <p className="text-xs text-[var(--cs-muted)] truncate">{s.chinese_text}</p>}
                </div>

                <div className="shrink-0 flex flex-col items-end gap-1.5 pt-0.5">
                  {ready ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--cs-ok-soft)] text-[var(--cs-ok)] px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap">
                      <Check className="w-3 h-3" />
                      សំឡេង {c.marker}
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={disabled || uploadingKey === c.key}
                      onClick={() => openPicker(c)}
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--cs-accent-soft)] text-[var(--cs-accent-text)] hover:brightness-95 px-2 py-0.5 text-[11px] font-bold whitespace-nowrap disabled:opacity-50"
                      title={`Upload ម្តង ប្រើបានគ្រប់ឃ្លារបស់ ${c.marker}`}
                    >
                      <Upload className="w-3 h-3" />
                      Upload សំឡេង {c.marker}
                    </button>
                  )}
                  {s.audioUrl && (
                    <button
                      type="button"
                      onClick={() => toggle(s.audioUrl!)}
                      aria-label={`ស្ដាប់ឃ្លាទី ${idx + 1}`}
                      className="w-7 h-7 rounded-full cs-btn-ghost flex items-center justify-center"
                    >
                      {playingUrl === s.audioUrl ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 ml-0.5" />}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
};
