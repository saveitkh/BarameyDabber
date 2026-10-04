import React, { useState } from 'react';
import {
  AudioLines,
  ChevronDown,
  Cloud,
  Film,
  GitMerge,
  ListChecks,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import { CastVoice, CharacterVoice, TimelineSegment } from '../../types';
import { CastCharacter, characterName, cloneSeconds, formatTime, pickCloneLines, toKhmerNumber } from './castUtils';

export const EMOTIONS: { id: string; label: string; cls: string }[] = [
  { id: 'neutral', label: 'ធម្មតា', cls: 'bg-sky-500/15 text-sky-300 border-sky-400/30' },
  { id: 'happy', label: 'សប្បាយ', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30' },
  { id: 'sad', label: 'សោកសៅ', cls: 'bg-violet-500/15 text-violet-300 border-violet-400/30' },
  { id: 'angry', label: 'ខឹង', cls: 'bg-rose-500/15 text-rose-300 border-rose-400/30' },
  { id: 'excited', label: 'រំភើប', cls: 'bg-amber-500/15 text-amber-300 border-amber-400/30' },
  { id: 'fearful', label: 'ភ័យខ្លាច', cls: 'bg-teal-500/15 text-teal-300 border-teal-400/30' },
];
const emotionOf = (id?: string) => EMOTIONS.find((e) => e.id === id) || EMOTIONS[0];

/** Voices cut from the movie (new endpoint, or the older client-side upload) */
const isMovieVoice = (v: CastVoice) => /^ពីរឿង|^movie_voice_/.test(v.originalName || '');

/** How good a clone reference of this length is, for the hint under the line picker. */
const cloneQuality = (sec: number): { label: string; cls: string } =>
  sec < 4
    ? { label: 'ខ្លីពេក — ជ្រើសឃ្លាបន្ថែម (ល្អ ៨–២០ វិ)', cls: 'text-[var(--cs-warn)]' }
    : sec < 8
    ? { label: 'អាចប្រើបាន — ៨–២០ វិនាទី ល្អជាង', cls: 'text-[var(--cs-text-2)]' }
    : sec <= 22
    ? { label: 'ល្អបំផុតសម្រាប់ក្លូន ✓', cls: 'text-[var(--cs-ok)]' }
    : { label: 'វែងពេក — Server យកតែ ៣០ វិនាទីដំបូង', cls: 'text-[var(--cs-warn)]' };

interface CharacterRowProps {
  index: number;
  c: CastCharacter;
  cast: CastCharacter[];
  segments: TimelineSegment[];
  face?: string;
  voice?: CastVoice;
  ready: boolean;
  libraryVoices: CharacterVoice[];
  sample: string | null;
  playing: string | null;
  previewingLine: number | null;
  busy: boolean;
  uploading: boolean;
  generating: boolean;
  anyUploading: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onPlay: (url: string) => void;
  onPreviewLine: (lineIndex: number) => void;
  onShowLines: () => void;
  onUpload: () => void;
  onClone: (lineIndexes: number[]) => void;
  onRemoveVoice: () => void;
  onPickLibrary: (voice: CharacterVoice | null) => void;
  onGenerate: () => void;
  onGender: (gender: 'male' | 'female') => void;
  onRename: (name: string) => void;
  onMerge: (into: CastCharacter) => void;
  onField: (patch: Partial<TimelineSegment>) => void;
}

export const CharacterRow: React.FC<CharacterRowProps> = ({
  index,
  c,
  cast,
  segments,
  face,
  voice,
  ready,
  libraryVoices,
  sample,
  playing,
  previewingLine,
  busy,
  uploading,
  generating,
  anyUploading,
  expanded,
  onToggleExpand,
  onPlay,
  onPreviewLine,
  onShowLines,
  onUpload,
  onClone,
  onRemoveVoice,
  onPickLibrary,
  onGenerate,
  onGender,
  onRename,
  onMerge,
  onField,
}) => {
  const first = segments[c.lineIndexes[0]] || ({} as TimelineSegment);
  const emo = emotionOf(first.emotion);
  const speed = first.speed ?? 1;
  const pitch = first.pitch ?? 0;
  const genderCls = c.gender === 'female' ? 'cs-marker-female' : 'cs-marker-male';
  const locked = busy || uploading || anyUploading;

  // Lines chosen for the clone; starts from the automatic pick and survives merges
  const [chosen, setChosen] = useState<number[] | null>(null);
  const autoPick = pickCloneLines(segments, c.lineIndexes);
  const selection = (chosen ?? autoPick).filter((i) => c.lineIndexes.includes(i));
  const seconds = cloneSeconds(segments, selection);
  const quality = cloneQuality(seconds);
  const toggleLine = (i: number) =>
    setChosen(selection.includes(i) ? selection.filter((x) => x !== i) : [...selection, i].sort((a, b) => a - b));

  const sameGender = libraryVoices.filter((v) => v.gender === c.gender);
  const otherGender = libraryVoices.filter((v) => v.gender !== c.gender);
  const others = cast.filter((o) => o.key !== c.key);

  return (
    <li className={`rounded-xl border ${expanded ? 'border-[var(--cs-accent)] bg-[var(--cs-sunken)]' : 'border-[var(--cs-border)]'} transition-colors`}>
      {/* ── Summary row ── */}
      <div className="flex items-center gap-3 px-3 py-2.5 flex-wrap">
        <span className="w-5 text-right font-mono text-[11px] text-[var(--cs-muted)] shrink-0">{index + 1}</span>

        <button type="button" onClick={onToggleExpand} className="shrink-0" title="បើកការកំណត់តួ" aria-label={`កំណត់ ${c.marker}`}>
          {face ? (
            <img src={face} alt="" className="w-11 h-11 rounded-lg object-cover ring-1 ring-[var(--cs-border-strong)]" />
          ) : (
            <span className={`w-11 h-11 rounded-lg flex items-center justify-center text-sm font-bold ${genderCls}`}>
              {c.marker.split(' ')[1]}
            </span>
          )}
        </button>

        <div className="min-w-[150px] flex-1 basis-[150px]">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleExpand}
              className={`rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${genderCls}`}
              title="បើកការកំណត់តួ (ប្ដូរភេទ, បញ្ចូលតួ...)"
            >
              {c.marker}
            </button>
            <input
              key={`${c.key}-${c.label}`}
              defaultValue={c.label}
              placeholder={c.detectedName || 'ដាក់ឈ្មោះតួ…'}
              disabled={busy}
              onBlur={(e) => onRename(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="min-w-0 flex-1 bg-transparent border border-transparent hover:border-[var(--cs-border)] focus:border-[var(--cs-accent)] rounded px-1.5 py-0.5 text-xs font-semibold text-[var(--cs-text)] placeholder:text-[var(--cs-muted)] placeholder:font-normal"
              aria-label={`ឈ្មោះ ${c.marker}`}
              title="ចុចដើម្បីដាក់ឈ្មោះតួ"
            />
          </div>
          <button
            type="button"
            onClick={onShowLines}
            className="mt-0.5 text-[10.5px] text-[var(--cs-muted)] hover:text-[var(--cs-accent-text)] hover:underline"
            title="មើលតែឃ្លារបស់តួនេះ"
          >
            {toKhmerNumber(c.lineIndexes.length)} ឃ្លា · មើលឃ្លា
          </button>
        </div>

        {/* Voice slot */}
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {voice ? (
            <span
              className="inline-flex items-center gap-1.5 max-w-[210px] rounded-lg border border-[var(--cs-ok)] bg-[var(--cs-sunken)] px-2 py-1.5 text-[11px] font-semibold"
              title={voice.originalName}
            >
              {isMovieVoice(voice) ? (
                <Film className="w-3.5 h-3.5 text-[var(--cs-ok)] shrink-0" />
              ) : (
                <AudioLines className="w-3.5 h-3.5 text-[var(--cs-ok)] shrink-0" />
              )}
              <span className="truncate">{isMovieVoice(voice) ? `ក្លូនពីរឿង` : voice.originalName || 'សំឡេង Upload'}</span>
              {voice.cloud && <Cloud className="w-3 h-3 text-[var(--cs-muted)] shrink-0" />}
              <button
                type="button"
                disabled={busy}
                onClick={onRemoveVoice}
                title="លុបសំឡេងក្លូន"
                aria-label={`លុបសំឡេង ${c.marker}`}
                className="ml-0.5 text-[var(--cs-muted)] hover:text-rose-400"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </span>
          ) : (
            <>
              <button
                type="button"
                disabled={locked}
                onClick={() => onClone(selection)}
                title={`ក្លូនសំឡេង ${c.marker} ពីឃ្លាក្នុងរឿង (លុបភ្លេងចេញ)`}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold flex items-center gap-1 bg-[var(--cs-accent-soft)] text-[var(--cs-accent-text)] ring-1 ring-[var(--cs-accent)] disabled:opacity-50"
              >
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Film className="w-3.5 h-3.5" />} ពីរឿង
              </button>
              <select
                disabled={busy}
                value={ready ? first.voiceId || '' : ''}
                onChange={(e) => onPickLibrary(libraryVoices.find((v) => v.id === e.target.value) || null)}
                className="w-[128px] rounded-lg border border-[var(--cs-border-strong)] bg-[var(--cs-sunken)] text-[var(--cs-text)] text-[11px] px-2 py-1.5"
                aria-label={`សំឡេងបណ្ណាល័យសម្រាប់ ${c.marker}`}
              >
                <option value="">{ready ? 'សំឡេងលំនាំដើម' : '📚 បណ្ណាល័យ…'}</option>
                <optgroup label={c.gender === 'female' ? 'សំឡេងស្រី' : 'សំឡេងប្រុស'}>
                  {sameGender.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </optgroup>
                {otherGender.length > 0 && (
                  <optgroup label="ផ្សេងៗ">
                    {otherGender.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </>
          )}
          <button
            type="button"
            disabled={locked}
            onClick={onUpload}
            title={voice ? 'ប្ដូរដោយ Upload សំឡេងផ្ទាល់ខ្លួន' : `Upload សំឡេង ${c.marker} (១០–៣០ វិនាទី)`}
            aria-label={`Upload សំឡេង ${c.marker}`}
            className="p-1.5 rounded-md cs-btn-ghost"
          >
            {uploading && voice ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          </button>
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <button
            type="button"
            disabled={!sample}
            onClick={() => sample && onPlay(sample)}
            aria-label={`ស្ដាប់ ${c.marker}`}
            title="ស្ដាប់សំឡេងតួនេះ"
            className="w-8 h-8 rounded-full cs-btn-primary inline-flex items-center justify-center disabled:opacity-30"
          >
            {playing === sample ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onGenerate}
            title={`បង្កើតសំឡេងឃ្លារបស់ ${c.marker}`}
            aria-label={`បង្កើតសំឡេង ${c.marker}`}
            className="p-2 rounded-md cs-btn-ghost"
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={onToggleExpand}
            aria-expanded={expanded}
            aria-label={`ការកំណត់ ${c.marker}`}
            title="ជ្រើសឃ្លាក្លូន · ប្ដូរភេទ · បញ្ចូលតួ · អារម្មណ៍"
            className={`p-2 rounded-md ${expanded ? 'bg-[var(--cs-accent-soft)] text-[var(--cs-accent-text)]' : 'cs-btn-ghost'}`}
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── Details ── */}
      {expanded && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3 px-3 pb-3">
          {/* Clone line picker */}
          <div className="rounded-lg border border-[var(--cs-border)] bg-[var(--cs-surface)] flex flex-col min-w-0">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--cs-border)]">
              <p className="text-xs font-bold flex items-center gap-1.5">
                <ListChecks className="w-3.5 h-3.5 text-[var(--cs-accent-text)]" /> ជ្រើសឃ្លាសម្រាប់ក្លូនសំឡេង
              </p>
              <button
                type="button"
                onClick={() => setChosen(null)}
                className="text-[10.5px] font-semibold text-[var(--cs-accent-text)] hover:underline flex items-center gap-1"
                title="ឲ្យ AI ជ្រើសឃ្លាដែលល្អបំផុត"
              >
                <Wand2 className="w-3 h-3" /> ជ្រើស Auto
              </button>
            </div>
            <p className="px-3 pt-2 text-[10.5px] text-[var(--cs-muted)] leading-relaxed">
              ចុច ▶ ស្ដាប់ឃ្លាដើម ហើយធីកតែឃ្លាដែល <b>{c.marker}</b> និយាយម្នាក់ឯង (គ្មានអ្នកផ្សេងនិយាយជាន់)។ ភ្លេងនឹងត្រូវលុបចេញដោយស្វ័យប្រវត្ត។
            </p>
            <ul className="max-h-56 overflow-y-auto px-1.5 py-1.5">
              {c.lineIndexes.map((i) => {
                const s = segments[i];
                if (!s) return null;
                const on = selection.includes(i);
                const len = Math.max(0, s.end_time - s.start_time);
                return (
                  <li key={i} className={`flex items-center gap-2 rounded-md px-1.5 py-1 ${on ? 'bg-[var(--cs-accent-soft)]' : 'hover:bg-[var(--cs-sunken)]'}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleLine(i)}
                      className="accent-[var(--cs-accent)] w-3.5 h-3.5 shrink-0"
                      aria-label={`ប្រើឃ្លាទី ${i + 1} សម្រាប់ក្លូន`}
                    />
                    <button
                      type="button"
                      onClick={() => onPreviewLine(i)}
                      className="w-6 h-6 rounded-full cs-btn-ghost flex items-center justify-center shrink-0"
                      aria-label={`ស្ដាប់ឃ្លាដើមទី ${i + 1}`}
                      title="ស្ដាប់ & មើលឃ្លាដើមក្នុងវីដេអូ"
                    >
                      {previewingLine === i ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 ml-0.5" />}
                    </button>
                    <span className="font-mono text-[10px] text-[var(--cs-muted)] shrink-0">{formatTime(s.start_time)}</span>
                    <span className={`font-mono text-[10px] shrink-0 ${len >= 1.5 && len <= 10 ? 'text-[var(--cs-ok)]' : 'text-[var(--cs-muted)]'}`}>
                      {len.toFixed(1)}s
                    </span>
                    <span className="text-[11px] truncate min-w-0" title={s.chinese_text || ''}>
                      {s.khmer_translation || s.chinese_text}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between gap-2 flex-wrap px-3 py-2 border-t border-[var(--cs-border)]">
              <p className="text-[10.5px]">
                <span className="font-semibold">
                  {toKhmerNumber(selection.length)} ឃ្លា · {toKhmerNumber(Math.round(seconds))} វិនាទី
                </span>{' '}
                <span className={quality.cls}>— {quality.label}</span>
              </p>
              <button
                type="button"
                disabled={locked || selection.length === 0}
                onClick={() => onClone(selection)}
                className="cs-btn-primary rounded-lg px-3 py-1.5 text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50"
              >
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Film className="w-3.5 h-3.5" />}
                {voice ? 'ក្លូនម្តងទៀតពីឃ្លាទាំងនេះ' : 'ក្លូនពីឃ្លាទាំងនេះ'}
              </button>
            </div>
          </div>

          {/* Character settings */}
          <div className="rounded-lg border border-[var(--cs-border)] bg-[var(--cs-surface)] p-3 flex flex-col gap-3 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-[var(--cs-text-2)] font-semibold">ភេទ</span>
              <div role="radiogroup" aria-label={`ភេទ ${c.marker}`} className="flex rounded-lg bg-[var(--cs-sunken)] p-0.5 text-[11px] font-semibold">
                {(['male', 'female'] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    role="radio"
                    aria-checked={c.gender === g}
                    disabled={busy}
                    onClick={() => c.gender !== g && onGender(g)}
                    className={`px-3 py-1 rounded-md ${c.gender === g ? (g === 'female' ? 'cs-marker-female' : 'cs-marker-male') : 'text-[var(--cs-muted)]'}`}
                  >
                    {g === 'female' ? 'ស្រី' : 'ប្រុស'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-[var(--cs-text-2)] font-semibold">អារម្មណ៍</span>
              <select
                disabled={busy}
                value={emo.id}
                onChange={(e) => onField({ emotion: e.target.value })}
                className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${emo.cls}`}
                aria-label={`អារម្មណ៍ ${c.marker}`}
              >
                {EMOTIONS.map((e) => (
                  <option key={e.id} value={e.id} className="bg-[var(--cs-surface)] text-[var(--cs-text)]">
                    {e.label}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 text-[11px]">
              <span className="w-14 shrink-0 text-[var(--cs-text-2)] font-semibold">ល្បឿន</span>
              <input
                type="range" min={0.7} max={1.4} step={0.05} value={speed} disabled={busy}
                onChange={(e) => onField({ speed: Number(e.target.value) })}
                className="flex-1 accent-[var(--cs-accent)]"
                aria-label={`ល្បឿន ${c.marker}`}
              />
              <span className="w-11 text-right font-mono">{speed.toFixed(2)}x</span>
            </label>
            <label className="flex items-center gap-2 text-[11px]">
              <span className="w-14 shrink-0 text-[var(--cs-text-2)] font-semibold">កម្ពស់</span>
              <input
                type="range" min={-6} max={6} step={1} value={pitch} disabled={busy}
                onChange={(e) => onField({ pitch: Number(e.target.value) })}
                className="flex-1 accent-[var(--cs-accent)]"
                aria-label={`កម្ពស់សំឡេង ${c.marker}`}
              />
              <span className="w-11 text-right font-mono">{pitch > 0 ? `+${pitch}` : pitch}</span>
            </label>

            {others.length > 0 && (
              <div className="flex flex-col gap-1.5 pt-2 border-t border-[var(--cs-border)]">
                <span className="text-[11px] text-[var(--cs-text-2)] font-semibold flex items-center gap-1.5">
                  <GitMerge className="w-3.5 h-3.5" /> AI ចែកតួខុស? បញ្ចូលតួនេះទៅក្នុងតួផ្សេង
                </span>
                <select
                  disabled={busy}
                  value=""
                  onChange={(e) => {
                    const into = others.find((o) => o.key === e.target.value);
                    if (
                      into &&
                      window.confirm(
                        `បញ្ចូល ${c.marker} (${toKhmerNumber(c.lineIndexes.length)} ឃ្លា) ទៅក្នុង ${into.marker}?\nឃ្លាទាំងនោះនឹងប្រើសំឡេងរបស់ ${into.marker}។`
                      )
                    )
                      onMerge(into);
                  }}
                  className="rounded-lg border border-[var(--cs-border-strong)] bg-[var(--cs-sunken)] text-[var(--cs-text)] text-[11px] px-2 py-1.5"
                  aria-label={`បញ្ចូល ${c.marker} ទៅក្នុងតួផ្សេង`}
                >
                  <option value="">ជ្រើសតួ…</option>
                  {others.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.marker} · {characterName(o)} ({toKhmerNumber(o.lineIndexes.length)} ឃ្លា)
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-[var(--cs-muted)]">
                  ចង់ប្ដូរតែឃ្លាណាមួយ? ទៅផ្ទាំង “ឃ្លាសន្ទនា” ហើយប្ដូរតួនៅមុខឃ្លានោះ។
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </li>
  );
};
