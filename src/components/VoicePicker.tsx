import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Play, Plus, Square, X } from 'lucide-react';
import { api } from '../lib/api';
import type { RecapNarrator } from '../lib/types';
import { useToast } from './ui';

/** The channel's one voice: the recap narrator and the solo dubbing voice start from the same pick. */
const CHANNEL_VOICE_KEY = 'kd_recap_narrator';
const VOICES_CHANGED = 'kd-voices-changed';

export const useChannelVoice = () => {
  const [voices, setVoices] = useState<RecapNarrator[]>([]);
  const [geminiVoice, setGeminiVoice] = useState(true);
  const [voice, setVoice] = useState<string>(() => {
    try {
      return localStorage.getItem(CHANNEL_VOICE_KEY) || '';
    } catch {
      return '';
    }
  });
  const reload = useCallback(
    () =>
      api
        .recapNarrators()
        .then((r) => {
          setVoices(r.items);
          setGeminiVoice(r.geminiVoice !== false);
          setVoice((v) => (r.items.some((n) => n.id === v) ? v : r.default));
        })
        .catch(() => {}),
    []
  );
  useEffect(() => {
    reload();
    // another picker on the page made or deleted a voice
    window.addEventListener(VOICES_CHANGED, reload);
    return () => window.removeEventListener(VOICES_CHANGED, reload);
  }, [reload]);
  useEffect(() => {
    try {
      if (voice) localStorage.setItem(CHANNEL_VOICE_KEY, voice);
    } catch {}
  }, [voice]);
  return { voices, voice, setVoice, geminiVoice, reload };
};

type Channel = ReturnType<typeof useChannelVoice>;

const VoiceTile: React.FC<{
  n: RecapNarrator;
  selected: boolean;
  disabled?: boolean;
  playing: boolean;
  loading: boolean;
  onPick: () => void;
  onPreview: () => void;
  onDelete?: () => void;
}> = ({ n, selected, disabled, playing, loading, onPick, onPreview, onDelete }) => (
  <div className={`flex items-center gap-1 rounded-xl ring-1 pl-3 pr-1 min-h-[44px] ${selected ? 'ring-2 ring-accent bg-accent/5' : 'ring-line-strong'}`}>
    <button type="button" disabled={disabled} onClick={onPick} className="flex-1 min-w-0 text-left py-1.5" title={n.desc}>
      <span className="block text-[12px] font-semibold text-ink leading-tight">{n.label}</span>
      {n.group === 'mine' && <span className="block text-[10px] text-mute">🎙️ ពីឯកសាររបស់ខ្ញុំ</span>}
    </button>
    <button
      type="button"
      onClick={onPreview}
      aria-label={`ស្ដាប់ ${n.label}`}
      className="w-9 h-9 shrink-0 rounded-full bg-raised flex items-center justify-center text-accent"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : playing ? <Square className="w-3.5 h-3.5" /> : <Play className="w-4 h-4 ml-0.5" />}
    </button>
    {onDelete && (
      <button type="button" disabled={disabled} onClick={onDelete} aria-label={`លុប ${n.label}`} className="w-7 h-9 shrink-0 flex items-center justify-center text-mute hover:text-bad">
        <X className="w-3.5 h-3.5" />
      </button>
    )}
  </div>
);

/**
 * The member's own voices (made from a sample file), the four defaults, and — folded away — the
 * other Gemini voices; each with a ▶ sample. "+" makes a new voice from an audio/video file.
 */
export const VoicePicker: React.FC<{ channel: Channel; disabled?: boolean }> = ({ channel, disabled }) => {
  const { voices, voice, setVoice, geminiVoice, reload } = channel;
  const toast = useToast();
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [making, setMaking] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => audio.current?.pause(), []);

  const preview = (id: string) => {
    audio.current?.pause();
    if (playing === id) {
      setPlaying(null);
      return;
    }
    const a = new Audio(api.recapPreviewUrl(id));
    audio.current = a;
    setLoading(id);
    a.oncanplay = () => setLoading(null);
    a.onended = () => setPlaying(null);
    a.onerror = () => {
      setLoading(null);
      setPlaying(null);
      toast('ស្ដាប់សំឡេងគំរូមិនបាន — សូមពិនិត្យ Gemini key', 'error');
    };
    setPlaying(id);
    a.play().catch(() => {});
  };

  const makeVoice = async (file: File) => {
    const name = window.prompt('ដាក់ឈ្មោះសំឡេងថ្មីនេះ', file.name.replace(/\.[^.]+$/, '').slice(0, 30))?.trim();
    if (name === undefined) return;
    setMaking(true);
    try {
      const r = await api.voiceFromFile(file, name || 'សំឡេងរបស់ខ្ញុំ');
      await reload();
      setVoice(r.item.id);
      window.dispatchEvent(new Event(VOICES_CHANGED));
      toast(`បានបង្កើតសំឡេង «${r.item.label}» ✓ ចុច ▶ ដើម្បីស្ដាប់`, 'success');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setMaking(false);
    }
  };

  const remove = async (n: RecapNarrator) => {
    if (!window.confirm(`លុបសំឡេង «${n.label}»?`)) return;
    try {
      await api.deleteCustomVoice(n.id);
      await reload();
      window.dispatchEvent(new Event(VOICES_CHANGED));
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const mine = voices.filter((n) => n.group === 'mine');
  const featured = voices.filter((n) => n.group === 'featured');
  const more = voices.filter((n) => n.group === 'more');
  const open = showAll || more.some((n) => n.id === voice);
  const tile = (n: RecapNarrator) => (
    <VoiceTile
      key={n.id}
      n={n}
      selected={voice === n.id}
      disabled={disabled}
      playing={playing === n.id}
      loading={loading === n.id}
      onPick={() => setVoice(n.id)}
      onPreview={() => preview(n.id)}
      onDelete={n.group === 'mine' ? () => remove(n) : undefined}
    />
  );

  return (
    <div className="flex flex-col gap-2">
      {!geminiVoice && voices.length > 0 && (
        <p className="rounded-xl bg-amber-500/10 ring-1 ring-amber-500/30 px-3 py-2 text-[11px] text-ink-2">
          ⚠️ សំឡេង Gemini មិនដំណើរការពេលនេះ (key ខុស ឬអស់កូតា) — សំឡេងទាំងអស់នឹងចេញជាសំឡេងខ្មែរធម្មតា ប្រុស/ស្រី តែ ២ ប៉ុណ្ណោះ។ សូមពិនិត្យ Gemini key ក្នុង «ការកំណត់»។
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {mine.map(tile)}
        {featured.map(tile)}
        <button
          type="button"
          disabled={disabled || making}
          onClick={() => fileInput.current?.click()}
          className="flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-line-strong min-h-[44px] px-2 text-[12px] font-semibold text-accent disabled:opacity-60"
        >
          {making ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {making ? 'AI កំពុងស្ដាប់…' : 'សំឡេងពីឯកសារ'}
        </button>
        <button
          type="button"
          onClick={() => setShowAll(!open)}
          className="flex items-center justify-center gap-1 rounded-xl ring-1 ring-line-strong min-h-[44px] px-2 text-[12px] font-semibold text-ink-2"
        >
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />} សំឡេងទាំង {more.length + featured.length}
        </button>
        {open && more.map(tile)}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="audio/*,video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) makeVoice(f);
        }}
      />
      {making && <span className="text-[11px] text-mute">Gemini កំពុងស្ដាប់សំឡេង ហើយបង្កើតសំឡេង AI ដែលស្រដៀង — មិនមែន clone ដូចបេះបិទទេ</span>}
    </div>
  );
};

/** Output setting: one voice per character, or one voice actor for every character. */
export const SoloVoiceSetting: React.FC<{
  solo: boolean;
  onSolo: (v: boolean) => void;
  channel: Channel;
  disabled?: boolean;
}> = ({ solo, onSolo, channel, disabled }) => (
  <div className="flex flex-col gap-2 py-2 border-t border-line">
    <span className="block text-sm font-medium text-ink">សំឡេងតួ</span>
    <div className="grid grid-cols-2 gap-2">
      {[
        { v: false, label: '🎭 តួនីមួយៗ សំឡេងខុសគ្នា' },
        { v: true, label: '🎙️ សំឡេងតែមួយ គ្រប់តួ' },
      ].map((o) => (
        <button
          key={String(o.v)}
          type="button"
          disabled={disabled}
          onClick={() => onSolo(o.v)}
          className={`rounded-xl min-h-[44px] px-2 text-[12px] font-semibold ring-1 ${
            solo === o.v ? 'ring-2 ring-accent bg-accent/5 text-ink' : 'ring-line-strong text-ink-2'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
    {solo && (
      <>
        <span className="text-[11px] text-mute">
          អ្នកដាក់សំឡេងម្នាក់ សម្ដែងគ្រប់តួ — សំឡេងដដែលពេញរឿង តែប្ដូរលំនាំតាមតួ (ចាស់ ក្មេង ស្រី ប្រុស) និងអារម្មណ៍នៃឃ្លានីមួយៗ។ ដូចសំឡេង Recap របស់ឆាណែល។
        </span>
        <VoicePicker channel={channel} disabled={disabled} />
      </>
    )}
  </div>
);
