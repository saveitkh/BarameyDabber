import React, { useMemo, useState } from 'react';
import { Pause, Play, Plus } from 'lucide-react';
import { Character, characterColor, displayName, formatTime, km, speakerKeyOf } from '../lib/cast';
import type { Profile } from '../lib/avatars';
import type { Casting } from '../lib/useCasting';
import type { TimelineSegment } from '../lib/types';
import { Avatar } from './Avatar';
import { Sheet, useSharedPlayback } from './ui';

const PAGE = 30;

/** Small round play button for the original voice of one line. */
const LinePlay: React.FC<{ src: string; seg: TimelineSegment; color: string }> = ({ src, seg, color }) => {
  const range: [number, number] = [Math.max(0, seg.start_time), seg.end_time];
  const { playing, loading, toggle } = useSharedPlayback(src, range);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={playing ? 'ឈប់' : 'ស្ដាប់សំឡេងដើម'}
      className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center active:scale-95 transition-transform"
      style={{ background: playing ? color : `${color}33`, color: playing ? '#fff' : '#334155' }}
    >
      {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className={`w-3.5 h-3.5 ml-0.5 ${loading ? 'animate-pulse' : ''}`} />}
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
              className={`shrink-0 h-8 px-3 rounded-full text-xs font-semibold ring-1 ${filter === 'all' ? 'bg-accent/10 text-accent ring-accent/40' : 'bg-surface text-ink-2 ring-line'}`}
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
              className={`shrink-0 h-8 pl-1 pr-2.5 rounded-full flex items-center gap-1.5 text-xs font-semibold ring-1 ${
                filter === c.key ? 'bg-accent/10 text-ink ring-accent/40' : 'bg-surface text-ink-2 ring-line'
              }`}
            >
              <Avatar character={c as Character} profile={profiles[c.key]} size={22} />
              {displayName(c as Character)}
              <span className="text-mute font-normal">{km((c as Character).lineIndexes.length)}</span>
            </button>
          )
        )}
      </div>

      {/* Lines: one compact row each */}
      <ol className="rounded-2xl bg-surface ring-1 ring-line divide-y divide-line overflow-hidden">
        {rows.slice(0, shown).map(({ s, i }) => {
          const c = byKey.get(speakerKeyOf(s));
          if (!c) return null;
          const color = characterColor(c.key);
          const isEditing = editing === i;
          const dur = Math.max(1, Math.round(s.end_time - s.start_time));
          return (
            <li key={i} className="flex items-start gap-2 pl-2 pr-2.5 py-2">
              <button type="button" disabled={disabled} onClick={() => setMoving(i)} className="mt-1 shrink-0" aria-label={`ប្ដូរអ្នកនិយាយ ឃ្លា ${i + 1}`}>
                <Avatar character={c} profile={profiles[c.key]} size={26} />
              </button>
              {audioSrc && <LinePlay src={audioSrc} seg={s} color={color} />}
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <textarea
                    autoFocus
                    value={draft}
                    rows={3}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commit(i)}
                    className="w-full resize-none rounded-lg bg-navy ring-1 ring-line-strong px-2 py-1.5 text-[13px] leading-relaxed text-ink focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                ) : (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setDraft(s.khmer_translation || '');
                      setEditing(i);
                    }}
                    className="block w-full text-left text-[13px] leading-snug text-ink line-clamp-2"
                  >
                    {s.khmer_translation || <span className="text-mute">(គ្មានអត្ថបទ)</span>}
                  </button>
                )}
                <p className="mt-0.5 text-[11px] text-mute truncate">
                  {displayName(c)} · {km(formatTime(s.start_time))} · {km(dur)} វិ{s.chinese_text ? ` · ${s.chinese_text}` : ''}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {rows.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + PAGE)} className="h-9 rounded-xl bg-surface ring-1 ring-line text-xs font-semibold text-accent">
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
                  <Avatar character={o} profile={profiles[o.key]} size={28} />
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
