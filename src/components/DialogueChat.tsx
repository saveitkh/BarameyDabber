import React, { useMemo, useState } from 'react';
import { Pause, Play, Plus } from 'lucide-react';
import { Character, characterColor, displayName, formatTime, km, speakerKeyOf } from '../lib/cast';
import type { Profile } from '../lib/avatars';
import type { Casting } from '../lib/useCasting';
import type { TimelineSegment } from '../lib/types';
import { Avatar } from './Avatar';
import { Sheet, useSharedPlayback } from './ui';

const PAGE = 30;

/** Decorative waveform, the same for the same line every time. */
const bars = (seed: number) =>
  Array.from({ length: 26 }, (_, i) => 5 + Math.abs(Math.sin((i + 1) * (seed + 3) * 0.61) * Math.cos(i * 0.37 + seed)) * 17);

const VoiceNote: React.FC<{ src: string; seg: TimelineSegment; index: number; color: string }> = ({ src, seg, index, color }) => {
  const range: [number, number] = [Math.max(0, seg.start_time), seg.end_time];
  const { playing, loading, toggle } = useSharedPlayback(src, range);
  const dur = Math.max(1, Math.round(seg.end_time - seg.start_time));
  return (
    <button type="button" onClick={toggle} className="flex items-center gap-2.5 w-full text-left" aria-label={playing ? 'ឈប់' : 'ស្ដាប់សំឡេងដើម'}>
      <span className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-white" style={{ background: color }}>
        {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className={`w-3.5 h-3.5 ml-0.5 ${loading ? 'animate-pulse' : ''}`} />}
      </span>
      <span className="flex-1 flex items-center gap-[2px] h-6" aria-hidden>
        {bars(index).map((h, i) => (
          <span key={i} className={`w-[3px] rounded-full ${playing ? 'animate-pulse' : ''}`} style={{ height: h, background: color, opacity: playing ? 1 : 0.55 }} />
        ))}
      </span>
      <span className="text-[11px] text-mute tabular-nums">0:{String(dur).padStart(2, '0')}</span>
    </button>
  );
};

interface Props {
  segments: TimelineSegment[];
  cast: Character[];
  profiles: Record<string, Profile>;
  casting: Casting;
  /** Soundtrack of the original video (extracted at scan time) — lets each line play its own original voice */
  audioSrc: string;
  disabled: boolean;
}

export const DialogueChat: React.FC<Props> = ({ segments, cast, profiles, casting, audioSrc, disabled }) => {
  const [filter, setFilter] = useState<string>('all');
  const [shown, setShown] = useState(PAGE);
  const [moving, setMoving] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  const byKey = useMemo(() => new Map(cast.map((c) => [c.key, c])), [cast]);
  const rows = useMemo(
    () => segments.map((s, i) => ({ s, i })).filter(({ s }) => filter === 'all' || speakerKeyOf(s) === filter),
    [segments, filter]
  );

  const commit = (i: number) => {
    if (draft !== (segments[i]?.khmer_translation || '')) casting.editLine(i, draft);
    setEditing(null);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Who is in the story */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">
        {[{ key: 'all' as const }, ...cast].map((c) =>
          c.key === 'all' ? (
            <button
              key="all"
              type="button"
              onClick={() => {
                setFilter('all');
                setShown(PAGE);
              }}
              className={`shrink-0 h-10 px-3.5 rounded-full text-xs font-semibold ring-1 ${filter === 'all' ? 'bg-brand text-white ring-brand' : 'bg-surface text-ink-2 ring-line'}`}
            >
              ទាំងអស់ · {km(segments.length)}
            </button>
          ) : (
            <button
              key={c.key}
              type="button"
              onClick={() => {
                setFilter(c.key);
                setShown(PAGE);
              }}
              className={`shrink-0 h-10 pl-1 pr-3 rounded-full flex items-center gap-1.5 text-xs font-semibold ring-1 ${
                filter === c.key ? 'bg-accent/15 text-ink ring-accent' : 'bg-surface text-ink-2 ring-line'
              }`}
            >
              <Avatar character={c as Character} profile={profiles[c.key]} size={32} />
              {displayName(c as Character)}
              <span className="text-mute font-normal">{km((c as Character).lineIndexes.length)}</span>
            </button>
          )
        )}
      </div>

      {/* Chat */}
      <ol className="flex flex-col gap-3">
        {rows.slice(0, shown).map(({ s, i }) => {
          const c = byKey.get(speakerKeyOf(s));
          if (!c) return null;
          const color = characterColor(c.key);
          const isEditing = editing === i;
          return (
            <li key={i} className="flex items-end gap-2">
              <button type="button" disabled={disabled} onClick={() => setMoving(i)} className="self-start shrink-0" aria-label={`ប្ដូរអ្នកនិយាយ ឃ្លា ${i + 1}`}>
                <Avatar character={c} profile={profiles[c.key]} size={36} />
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-0.5 px-1">
                  <span className="text-xs font-bold truncate" style={{ color }}>
                    {displayName(c)}
                  </span>
                  <span className="text-[10px] text-mute font-mono">{formatTime(s.start_time)}</span>
                </div>
                <div className="rounded-2xl rounded-tl-md bg-surface ring-1 ring-line px-3 py-2.5 flex flex-col gap-2" style={{ boxShadow: `inset 3px 0 0 ${color}` }}>
                  {audioSrc && <VoiceNote src={audioSrc} seg={s} index={i} color={color} />}
                  {isEditing ? (
                    <textarea
                      autoFocus
                      value={draft}
                      rows={3}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commit(i)}
                      className="w-full resize-none rounded-lg bg-navy ring-1 ring-line-strong px-2.5 py-2 text-[13px] leading-relaxed text-ink focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  ) : (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setDraft(s.khmer_translation || '');
                        setEditing(i);
                      }}
                      className="text-left text-[13px] leading-relaxed text-ink"
                    >
                      {s.khmer_translation || <span className="text-mute">(គ្មានអត្ថបទ — ចុចដើម្បីបញ្ចូល)</span>}
                    </button>
                  )}
                  {s.chinese_text && !isEditing && <p className="text-[11px] leading-snug text-mute">{s.chinese_text}</p>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {rows.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + PAGE)} className="h-10 rounded-xl bg-surface ring-1 ring-line text-xs font-semibold text-accent">
          បង្ហាញបន្ថែម ({km(rows.length - shown)})
        </button>
      )}
      {rows.length === 0 && <p className="text-center text-xs text-mute py-4">មិនមានឃ្លាសម្រាប់តួនេះទេ</p>}

      {/* Who says this line? */}
      <Sheet open={moving !== null} onClose={() => setMoving(null)} title="អ្នកនិយាយឃ្លានេះ">
        <div className="flex flex-col gap-2">
          {moving !== null &&
            cast.map((o) => {
              const current = speakerKeyOf(segments[moving]) === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => {
                    if (!current) casting.moveLine(moving, o);
                    setMoving(null);
                  }}
                  className={`flex items-center gap-3 rounded-xl px-3 min-h-[52px] text-left ring-1 ${current ? 'ring-2 ring-accent bg-accent/10' : 'ring-line hover:bg-raised'}`}
                >
                  <Avatar character={o} profile={profiles[o.key]} size={34} />
                  <span className="flex-1 text-sm font-semibold text-ink">{displayName(o)}</span>
                  <span className="text-xs text-mute">{km(o.lineIndexes.length)} ឃ្លា</span>
                </button>
              );
            })}
          <button
            type="button"
            onClick={() => {
              if (moving !== null) casting.moveLine(moving, null);
              setMoving(null);
            }}
            className="flex items-center gap-3 rounded-xl px-3 min-h-[52px] ring-1 ring-line hover:bg-raised text-sm font-semibold text-accent"
          >
            <Plus className="w-5 h-5" /> តួថ្មី
          </button>
        </div>
      </Sheet>
    </div>
  );
};
