import React, { useEffect, useState } from 'react';
import { Headphones, Loader2, Music2, Scissors, Sparkles, VolumeX, Waves, Mic2 } from 'lucide-react';
import { api } from '../../services/api';
import { OutputSettings } from './outputSettings';

type Toast = (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;

interface BackgroundMixCardProps {
  /** Uploaded video on the server; null while it is still uploading */
  projectKey: string | null;
  settings: OutputSettings;
  onChange: (next: OutputSettings) => void;
  disabled?: boolean;
  onShowToast: Toast;
}

const MODES: {
  id: OutputSettings['bgmMode'];
  title: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}[] = [
  {
    id: 'auto',
    title: 'Auto',
    badge: 'ណែនាំ',
    body: 'ឮភ្លេង & សំឡេងឈុតដើម ១០០% ពេលគ្មានគេនិយាយ · កាត់សំឡេងចិនចេញតែពេលតួនិយាយ · កំណត់កម្រិតសំឡេងឲ្យ',
    icon: Sparkles,
  },
  {
    id: 'clean',
    title: 'ភ្លេង & Effect',
    body: 'លុបសំឡេងនិយាយចិនចេញពីរឿងទាំងមូល — រក្សាតែភ្លេង និងសំឡេងឈុត',
    icon: Music2,
  },
  {
    id: 'original',
    title: 'Voice-over',
    body: 'ឮសំឡេងដើមទាំងមូលតិចៗ (មានសំឡេងចិនផង) ហើយស្រាលចុះពេលខ្មែរនិយាយ',
    icon: Mic2,
  },
  {
    id: 'none',
    title: 'គ្មានភ្លេង',
    body: 'មានតែសំឡេងខ្មែរ — សមសម្រាប់សាកស្ដាប់សំឡេងតួ',
    icon: VolumeX,
  },
];

const Slider: React.FC<{
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}> = ({ label, hint, value, min, max, onChange, disabled }) => (
  <label className="flex items-center gap-3 text-xs">
    <span className="w-28 shrink-0 text-[var(--cs-text-2)] font-semibold">
      {label}
      {hint && <span className="block text-[10px] font-normal text-[var(--cs-muted)]">{hint}</span>}
    </span>
    <input
      type="range"
      min={min}
      max={max}
      step={5}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className="flex-1 accent-[var(--cs-accent)]"
    />
    <span className="w-10 text-right font-mono text-[11px]">{value}%</span>
  </label>
);

/**
 * Background (BGM) of the finished video: pick how the original soundtrack is kept, set the
 * levels, and listen to the separated background before building the video. The split is
 * cached on the server, so building the video afterwards reuses it instead of separating again.
 */
export const BackgroundMixCard: React.FC<BackgroundMixCardProps> = ({ projectKey, settings: s, onChange, disabled, onShowToast }) => {
  const set = <K extends keyof OutputSettings>(key: K, value: OutputSettings[K]) => onChange({ ...s, [key]: value });
  const [separating, setSeparating] = useState(false);
  const [split, setSplit] = useState<{ bgmUrl: string; vocalsUrl: string; ai: boolean } | null>(null);

  useEffect(() => {
    setSplit(null);
  }, [projectKey]);

  const separate = async () => {
    if (!projectKey || separating) return;
    setSeparating(true);
    onShowToast('✂ កំពុងបំបែកភ្លេងចេញពីសំឡេងនិយាយ… (AI Demucs អាចចំណាយពេលពីរបីនាទី)', 'info');
    try {
      const res = await api.separateAudio(projectKey, true);
      const ai = res.engine === 'meta-demucs-ai';
      setSplit({ bgmUrl: res.bgmUrl, vocalsUrl: res.vocalsUrl, ai });
      onShowToast(ai ? '✓ បំបែកភ្លេងដោយ AI រួច — ចុច ▶ ស្ដាប់' : '✓ បំបែកភ្លេងរួច (Filter ធម្មតា) — ចុច ▶ ស្ដាប់', 'success');
    } catch (e: any) {
      onShowToast(`បំបែកភ្លេងមិនបាន: ${e.message}`, 'error');
    } finally {
      setSeparating(false);
    }
  };

  const usesSeparation = s.bgmMode === 'auto' || s.bgmMode === 'clean';

  return (
    <section id="cs-background" className="cs-card p-4 sm:p-5 flex flex-col gap-4" aria-label="សំឡេងផ្ទៃខាងក្រោយ">
      <div className="flex items-center gap-2 flex-wrap">
        <Waves className="w-4 h-4 text-[var(--cs-accent-text)]" />
        <h2 className="text-sm font-bold">សំឡេងផ្ទៃខាងក្រោយ (Background)</h2>
        <span className="text-[11px] text-[var(--cs-muted)]">— ភ្លេង & សំឡេងឈុតរបស់រឿងដើម</span>
      </div>

      <div role="radiogroup" aria-label="ប្រភេទភ្លេង" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
        {MODES.map((m) => {
          const on = s.bgmMode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => set('bgmMode', m.id)}
              className={`text-left rounded-xl border p-3 flex gap-2.5 transition-colors disabled:opacity-60 ${
                on ? 'border-[var(--cs-accent)] bg-[var(--cs-accent-soft)]' : 'border-[var(--cs-border)] hover:border-[var(--cs-border-strong)]'
              }`}
            >
              <span
                className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                  on ? 'bg-[var(--cs-accent)] text-[var(--cs-on-accent)]' : 'bg-[var(--cs-sunken)] text-[var(--cs-muted)]'
                }`}
              >
                <m.icon className="w-3.5 h-3.5" />
              </span>
              <span className="min-w-0">
                <span className="text-xs font-bold flex items-center gap-1.5">
                  {m.title}
                  {m.badge && (
                    <span className="rounded-full px-1.5 py-px text-[9.5px] font-bold bg-[var(--cs-ok-soft)] text-[var(--cs-ok)]">{m.badge}</span>
                  )}
                </span>
                <span className="block text-[10.5px] text-[var(--cs-muted)] leading-relaxed mt-0.5">{m.body}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="flex flex-col gap-3">
          {usesSeparation && (
            <Slider
              label="កម្រិតភ្លេង"
              hint={s.bgmMode === 'auto' ? '១០០% = Auto' : undefined}
              value={s.bgmVolume}
              min={0}
              max={s.bgmMode === 'auto' ? 200 : 150}
              onChange={(v) => set('bgmVolume', v)}
              disabled={disabled}
            />
          )}
          {s.bgmMode !== 'original' && (
            <Slider label="សំឡេងខ្មែរ" value={s.voiceVolume} min={50} max={150} onChange={(v) => set('voiceVolume', v)} disabled={disabled} />
          )}
          {s.bgmMode === 'original' && (
            <p className="text-[11px] text-[var(--cs-text-2)] leading-relaxed">Voice-over កំណត់កម្រិតសំឡេងដោយស្វ័យប្រវត្ត — មិនបាច់កែទេ។</p>
          )}
          {s.bgmMode === 'none' && (
            <p className="text-[11px] text-[var(--cs-text-2)] leading-relaxed">វីដេអូនឹងគ្មានភ្លេង ឬសំឡេងឈុតដើមទេ។</p>
          )}
        </div>

        {usesSeparation && (
          <div className="rounded-xl border border-[var(--cs-border)] p-3 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs font-bold flex items-center gap-1.5">
                <Headphones className="w-3.5 h-3.5 text-[var(--cs-accent-text)]" /> ស្ដាប់ភ្លេងមុនបង្កើតវីដេអូ
              </p>
              <button
                type="button"
                disabled={!projectKey || separating || disabled}
                onClick={separate}
                className={`${split ? 'cs-btn-ghost' : 'cs-btn-primary'} rounded-lg px-3 py-1.5 text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50`}
              >
                {separating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scissors className="w-3.5 h-3.5" />}
                {separating ? 'កំពុងបំបែក…' : split ? 'បំបែកម្តងទៀត' : 'បំបែក & ស្ដាប់ភ្លេង'}
              </button>
            </div>
            {split ? (
              <>
                <span
                  className={`self-start rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    split.ai ? 'bg-[var(--cs-ok-soft)] text-[var(--cs-ok)]' : 'bg-[var(--cs-warn-soft)] text-[var(--cs-warn)]'
                  }`}
                >
                  {split.ai ? 'AI Demucs — ភ្លេងច្បាស់' : 'Filter ធម្មតា — ដំឡើង Demucs ដើម្បីបានភ្លេងច្បាស់ជាង'}
                </span>
                <label className="flex flex-col gap-1 text-[11px] text-[var(--cs-text-2)]">
                  ភ្លេង & សំឡេងឈុត (គ្មានសំឡេងនិយាយ)
                  <audio controls preload="none" src={split.bgmUrl} className="w-full h-8" />
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-[var(--cs-text-2)]">
                  សំឡេងនិយាយដើមដែលត្រូវកាត់ចេញ
                  <audio controls preload="none" src={split.vocalsUrl} className="w-full h-8" />
                </label>
                <p className="text-[10px] text-[var(--cs-muted)]">
                  ✓ ពេលចុច “បង្កើតវីដេអូ” នឹងប្រើភ្លេងដែលបំបែករួចនេះ (លឿនជាងមុន)។ បើនៅឮសំឡេងចិនច្រើន សាក “Voice-over”។
                </p>
              </>
            ) : (
              <p className="text-[10.5px] text-[var(--cs-muted)] leading-relaxed">
                ចុចដើម្បីបំបែក និងស្ដាប់ភ្លេងដែលនឹងដាក់ក្នុងវីដេអូ — ដឹងមុនថាភ្លេងស្អាតឬអត់ ហើយការបង្កើតវីដេអូលើកក្រោយនឹងលឿនជាង។
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
