import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Play, Square } from 'lucide-react';
import { api } from '../lib/api';
import type { RecapNarrator } from '../lib/types';
import { useToast } from './ui';

/** The channel's one voice: the recap narrator and the solo dubbing voice start from the same pick. */
const CHANNEL_VOICE_KEY = 'kd_recap_narrator';

export const useChannelVoice = () => {
  const [voices, setVoices] = useState<RecapNarrator[]>([]);
  const [voice, setVoice] = useState<string>(() => {
    try {
      return localStorage.getItem(CHANNEL_VOICE_KEY) || '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    api
      .recapNarrators()
      .then((r) => {
        setVoices(r.items);
        setVoice((v) => (r.items.some((n) => n.id === v) ? v : r.default));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    try {
      if (voice) localStorage.setItem(CHANNEL_VOICE_KEY, voice);
    } catch {}
  }, [voice]);
  return { voices, voice, setVoice };
};

/** Four general voices in a grid, each with a ▶ sample. */
export const VoicePicker: React.FC<{
  voices: RecapNarrator[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}> = ({ voices, value, onChange, disabled }) => {
  const toast = useToast();
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
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

  return (
    <div className="grid grid-cols-2 gap-2">
      {voices.map((n) => (
        <div
          key={n.id}
          className={`flex items-center gap-1.5 rounded-xl ring-1 pl-3 pr-1 min-h-[44px] ${
            value === n.id ? 'ring-2 ring-accent bg-accent/5' : 'ring-line-strong'
          }`}
        >
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(n.id)}
            className="flex-1 min-w-0 text-left text-[12px] font-semibold text-ink leading-tight py-1.5"
          >
            {n.label}
          </button>
          <button
            type="button"
            onClick={() => preview(n.id)}
            aria-label={`ស្ដាប់ ${n.label}`}
            className="w-9 h-9 shrink-0 rounded-full bg-raised flex items-center justify-center text-accent"
          >
            {loading === n.id ? <Loader2 className="w-4 h-4 animate-spin" /> : playing === n.id ? <Square className="w-3.5 h-3.5" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
        </div>
      ))}
    </div>
  );
};

/** Output setting: one voice per character, or one voice actor for every character. */
export const SoloVoiceSetting: React.FC<{
  solo: boolean;
  onSolo: (v: boolean) => void;
  voices: RecapNarrator[];
  voice: string;
  onVoice: (id: string) => void;
  disabled?: boolean;
}> = ({ solo, onSolo, voices, voice, onVoice, disabled }) => (
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
        <VoicePicker voices={voices} value={voice} onChange={onVoice} disabled={disabled} />
      </>
    )}
  </div>
);
