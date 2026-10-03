import React from 'react';
import { Subtitles, Music2, Zap, SlidersHorizontal, Mic } from 'lucide-react';
import { OutputSettings } from './outputSettings';

interface OutputSettingsCardProps {
  settings: OutputSettings;
  onChange: (next: OutputSettings) => void;
  disabled?: boolean;
  /** Gemini key works — natural voice uses Gemini TTS */
  geminiReady?: boolean;
}

const Switch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }> = ({
  checked,
  onChange,
  label,
  disabled,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative w-11 h-6 rounded-full shrink-0 transition-colors disabled:opacity-50 ${
      checked ? 'bg-[var(--cs-accent)]' : 'bg-[var(--cs-sunken)] border border-[var(--cs-border-strong)]'
    }`}
  >
    <span
      className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`}
    />
  </button>
);

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg bg-[var(--cs-sunken)] p-0.5 text-[11.5px] font-semibold">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={`flex-1 px-2 py-1.5 rounded-md whitespace-nowrap transition-colors ${
            value === o.id ? 'bg-[var(--cs-accent)] text-[var(--cs-on-accent)]' : 'text-[var(--cs-text-2)] hover:text-[var(--cs-text)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const Slider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}> = ({ label, value, min, max, onChange, disabled }) => (
  <label className="flex items-center gap-3 text-xs">
    <span className="w-24 shrink-0 text-[var(--cs-text-2)]">{label}</span>
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

const Block: React.FC<{ icon: React.ReactNode; title: string; hint: string; right?: React.ReactNode; children?: React.ReactNode }> = ({
  icon,
  title,
  hint,
  right,
  children,
}) => (
  <div className="flex flex-col gap-3 rounded-xl border border-[var(--cs-border)] p-4">
    <div className="flex items-start gap-3">
      <span className="w-8 h-8 rounded-lg bg-[var(--cs-accent-soft)] text-[var(--cs-accent-text)] flex items-center justify-center shrink-0">
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold">{title}</p>
        <p className="text-[11px] text-[var(--cs-muted)] leading-relaxed">{hint}</p>
      </div>
      {right}
    </div>
    {children}
  </div>
);

export const OutputSettingsCard: React.FC<OutputSettingsCardProps> = ({ settings: s, onChange, disabled, geminiReady }) => {
  const set = <K extends keyof OutputSettings>(key: K, value: OutputSettings[K]) => onChange({ ...s, [key]: value });

  return (
    <section id="cs-output-settings" className="cs-card p-4 sm:p-5 flex flex-col gap-4" aria-label="ការកំណត់វីដេអូ">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="w-4 h-4 text-[var(--cs-accent-text)]" />
        <h2 className="text-sm font-bold">ការកំណត់វីដេអូ</h2>
        <span className="text-[11px] text-[var(--cs-muted)]">— កំណត់ម្តង ចាំទុកសម្រាប់គ្រប់វីដេអូ</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-3">
        <Block
          icon={<Subtitles className="w-4 h-4" />}
          title="ចំណងជើងរងខ្មែរ (Subtitle)"
          hint={s.subtitles ? 'បើក — អក្សរខ្មែរនឹងដិតលើវីដេអូលទ្ធផល' : 'បិទ — វីដេអូគ្មានអក្សរ'}
          right={<Switch checked={s.subtitles} onChange={(v) => set('subtitles', v)} label="បើក/បិទ ចំណងជើងរង" disabled={disabled} />}
        >
          {s.subtitles && (
            <div className="flex flex-col gap-2">
              <Segmented
                label="ទីតាំងអក្សរ"
                value={s.subtitlePosition}
                onChange={(v) => set('subtitlePosition', v)}
                disabled={disabled}
                options={[
                  { id: 'bottom', label: 'ខាងក្រោម' },
                  { id: 'top', label: 'ខាងលើ' },
                ]}
              />
              <Segmented
                label="ទំហំអក្សរ"
                value={s.subtitleSize}
                onChange={(v) => set('subtitleSize', v)}
                disabled={disabled}
                options={[
                  { id: 'small', label: 'តូច' },
                  { id: 'medium', label: 'មធ្យម' },
                  { id: 'large', label: 'ធំ' },
                ]}
              />
            </div>
          )}
        </Block>

        <Block
          icon={<Music2 className="w-4 h-4" />}
          title="សំឡេងផ្ទៃខាងក្រោយ (Background)"
          hint={
            s.bgmMode === 'auto'
              ? 'ស្វ័យប្រវត្ត — លុបសំឡេងចិន ហើយវាស់ & កំណត់កម្រិតភ្លេង/សំឡេងខ្មែរដោយខ្លួនឯង'
              : s.bgmMode === 'clean'
              ? 'រក្សាភ្លេង & សំឡេងឈុត — លុបសំឡេងនិយាយចិនចេញ'
              : s.bgmMode === 'original'
              ? 'រក្សាសំឡេងដើមទាំងមូល (បន្ថយកណ្ដាល) នៅក្រោមសំឡេងខ្មែរ'
              : 'គ្មានភ្លេង — មានតែសំឡេងខ្មែរ'
          }
        >
          <Segmented
            label="ប្រភេទភ្លេង"
            value={s.bgmMode}
            onChange={(v) => set('bgmMode', v)}
            disabled={disabled}
            options={[
              { id: 'auto', label: 'Auto' },
              { id: 'clean', label: 'ភ្លេង' },
              { id: 'original', label: 'ដើម' },
              { id: 'none', label: 'គ្មាន' },
            ]}
          />
          {s.bgmMode !== 'auto' && s.bgmMode !== 'none' && (
            <Slider label="កម្រិតភ្លេង" value={s.bgmVolume} min={0} max={150} onChange={(v) => set('bgmVolume', v)} disabled={disabled} />
          )}
          {s.bgmMode !== 'auto' && (
            <Slider label="សំឡេងខ្មែរ" value={s.voiceVolume} min={50} max={150} onChange={(v) => set('voiceVolume', v)} disabled={disabled} />
          )}
        </Block>

        <Block
          icon={<Mic className="w-4 h-4" />}
          title="សំឡេងនិយាយ (Voice)"
          hint={
            !s.naturalVoice
              ? 'បិទ — សំឡេង AI ធម្មតា (អានត្រង់ៗ)'
              : geminiReady
              ? 'ធម្មជាតិ — Gemini ដើរតួតាមអារម្មណ៍ មានដង្ហើម & ការផ្អាក ១ តួ = ១ សំឡេង'
              : 'ធម្មជាតិ — សំឡេងខ្មែរ AI + ដង្ហើម & ការផ្អាកតាមឃ្លា (ដាក់ Gemini Key ដើម្បីបានធម្មជាតិជាងនេះ)'
          }
          right={<Switch checked={s.naturalVoice} onChange={(v) => set('naturalVoice', v)} label="សំឡេងធម្មជាតិ មានដង្ហើម" disabled={disabled} />}
        >
          {s.naturalVoice && (
            <p className="text-[11px] text-[var(--cs-text-2)] leading-relaxed">
              តួដែលមានសំឡេង Upload (Voice Clone) នៅតែប្រើសំឡេងរបស់ខ្លួន តែបន្ថែមការណែនាំឲ្យនិយាយតាមអារម្មណ៍ និងមានដង្ហើម។
            </p>
          )}
        </Block>

        <Block icon={<Zap className="w-4 h-4" />} title="ស្វ័យប្រវត្ត (Auto)" hint="ធ្វើការងារជំនួសអ្នក ពេល Upload វីដេអូថ្មី">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-[var(--cs-text-2)]">ស្កេនឃ្លា & តួ ភ្លាមៗក្រោយ Upload</span>
            <Switch checked={s.autoScan} onChange={(v) => set('autoScan', v)} label="ស្កេនស្វ័យប្រវត្ត" disabled={disabled} />
          </div>
          <div className={`flex items-center justify-between gap-3 text-xs ${s.autoScan ? '' : 'opacity-50'}`}>
            <span className="text-[var(--cs-text-2)]">បង្កើតវីដេអូភ្លាមៗក្រោយស្កេន</span>
            <Switch
              checked={s.autoScan && s.autoGenerate}
              onChange={(v) => set('autoGenerate', v)}
              label="បង្កើតវីដេអូស្វ័យប្រវត្ត"
              disabled={disabled || !s.autoScan}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-[var(--cs-muted)]">ស្កេនប៉ុន្មាន?</span>
            <Segmented
              label="ទំហំស្កេន"
              value={s.scanScope}
              onChange={(v) => set('scanScope', v)}
              disabled={disabled}
              options={[
                { id: 'full', label: 'ពេញវីដេអូ' },
                { id: '180', label: '៣ នាទីដំបូង (សាក)' },
              ]}
            />
          </div>
        </Block>
      </div>
    </section>
  );
};
