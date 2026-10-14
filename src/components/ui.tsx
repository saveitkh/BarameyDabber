import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Info, Loader2, Pause, Play, Send, TriangleAlert, X, XCircle } from 'lucide-react';
import type { ShowToast, ToastType } from '../lib/types';
import { withToken } from '../lib/api';

/* ── Toasts ─────────────────────────────────────────────── */
const ToastCtx = createContext<ShowToast>(() => {});
export const useToast = () => useContext(ToastCtx);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<{ id: number; msg: string; type: ToastType }[]>([]);
  const show = useCallback<ShowToast>((msg, type = 'info') => {
    const id = Date.now() + Math.random();
    setItems((p) => [...p.slice(-2), { id, msg, type }]);
    setTimeout(() => setItems((p) => p.filter((t) => t.id !== id)), type === 'error' ? 6000 : 3800);
  }, []);
  const icon = { success: CheckCircle2, error: XCircle, warning: TriangleAlert, info: Info };
  const tone = {
    success: 'text-ok',
    error: 'text-bad',
    warning: 'text-warn',
    info: 'text-accent',
  };
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-[max(12px,env(safe-area-inset-top))] pointer-events-none">
        {items.map((t) => {
          const Icon = icon[t.type];
          return (
            <div
              key={t.id}
              role="status"
              className="pointer-events-auto w-full max-w-md rounded-2xl bg-surface shadow-subtle ring-1 ring-line-strong px-4 py-3 flex items-start gap-3 animate-[toast_.2s_ease-out]"
            >
              <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${tone[t.type]}`} />
              <p className="text-sm text-ink leading-relaxed flex-1">{t.msg}</p>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
};

/* ── Buttons & bits ─────────────────────────────────────── */
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  block?: boolean;
};

export const Button: React.FC<BtnProps> = ({ variant = 'primary', loading, block, className = '', children, disabled, ...rest }) => {
  const v = {
    primary:
      'bg-gradient-to-r from-brand to-cyan-500 text-white shadow-lg shadow-brand/20 hover:brightness-110 active:brightness-95 disabled:bg-none disabled:bg-line-strong disabled:shadow-none',
    secondary: 'bg-raised text-ink ring-1 ring-line-strong hover:bg-line disabled:text-mute',
    ghost: 'text-ink-2 hover:bg-raised disabled:text-mute',
    danger: 'bg-red-500/10 text-bad ring-1 ring-red-500/30 hover:bg-red-500/20',
  }[variant];
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 min-h-[44px] text-sm font-semibold transition-colors disabled:cursor-not-allowed ${v} ${
        block ? 'w-full' : ''
      } ${className}`}
      {...rest}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
};

export const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = '', children }) => (
  <section className={`bg-surface rounded-2xl ring-1 ring-line ${className}`}>{children}</section>
);

export const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }> = ({
  checked,
  onChange,
  label,
  hint,
  disabled,
}) => (
  <label className={`flex items-center gap-3 py-2 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
    <span className="flex-1 min-w-0">
      <span className="block text-sm font-medium text-ink">{label}</span>
      {hint && <span className="block text-xs text-mute mt-0.5">{hint}</span>}
    </span>
    <input type="checkbox" className="sr-only peer" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    <span className="relative w-11 h-6 shrink-0 rounded-full bg-line-strong peer-checked:bg-brand transition-colors after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-accent" />
  </label>
);

export const Segmented = <T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) => (
  <div className="inline-flex rounded-xl bg-navy ring-1 ring-line p-1">
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        disabled={disabled}
        onClick={() => onChange(o.value)}
        className={`px-3 min-h-[32px] rounded-lg text-xs font-semibold transition-colors ${
          value === o.value ? 'bg-brand text-white shadow-sm' : 'text-mute'
        }`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export const Progress: React.FC<{ value: number; pulse?: boolean }> = ({ value, pulse }) => (
  <div className="h-2 rounded-full bg-raised overflow-hidden">
    <div className={`h-full bg-brand transition-all duration-500 ${pulse ? 'animate-pulse' : ''}`} style={{ width: `${Math.max(3, Math.min(100, value))}%` }} />
  </div>
);

/* ── Bottom sheet ───────────────────────────────────────── */
export const Sheet: React.FC<{ open: boolean; onClose: () => void; title: string; children: React.ReactNode }> = ({
  open,
  onClose,
  title,
  children,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="បិទ" className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[88vh] flex flex-col bg-surface ring-1 ring-line rounded-t-3xl sm:rounded-3xl shadow-xl animate-[sheet_.22s_ease-out]">
        <header className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-line">
          <h2 className="flex-1 text-base font-bold text-ink truncate">{title}</h2>
          <button type="button" onClick={onClose} className="w-9 h-9 -mr-2 rounded-full flex items-center justify-center text-mute hover:bg-raised" aria-label="បិទ">
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="overflow-y-auto px-5 py-4 pb-[max(16px,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>,
    document.body
  );
};

/* ── One shared audio player for every preview button ──── */
let sharedAudio: HTMLAudioElement | null = null;
const listeners = new Set<(src: string | null) => void>();
let playingSrc: string | null = null;
const emit = () => listeners.forEach((l) => l(playingSrc));

/** Shared playback state for one clip (optionally only the [start, end] seconds of a longer file). */
export const useSharedPlayback = (src: string, range?: [number, number]) => {
  const [current, setCurrent] = useState<string | null>(playingSrc);
  const [loading, setLoading] = useState(false);
  const base = withToken(src);
  const id = range ? `${base}#${range[0]}-${range[1]}` : base;
  const latest = useRef({ base, id, range });
  latest.current = { base, id, range };
  useEffect(() => {
    listeners.add(setCurrent);
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);
  const playing = current === id;
  const toggle = () => {
    const { base: url, id: key, range: r } = latest.current;
    if (!sharedAudio) {
      sharedAudio = new Audio();
      sharedAudio.onended = sharedAudio.onerror = () => {
        playingSrc = null;
        emit();
      };
    }
    const a = sharedAudio;
    if (playing) {
      a.pause();
      playingSrc = null;
      emit();
      return;
    }
    a.ontimeupdate = r
      ? () => {
          if (a.currentTime >= r[1]) {
            a.pause();
            playingSrc = null;
            emit();
          }
        }
      : null;
    a.src = url;
    if (r) a.addEventListener('loadedmetadata', () => (a.currentTime = r[0]), { once: true });
    setLoading(true);
    a
      .play()
      .then(() => {
        playingSrc = key;
        emit();
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  return { playing, loading, toggle };
};

export const PlayButton: React.FC<{ src: string; label?: string; size?: 'sm' | 'md'; range?: [number, number] }> = ({ src, label = 'ស្ដាប់', size = 'md', range }) => {
  const { playing, loading, toggle } = useSharedPlayback(src, range);
  const dim = size === 'sm' ? 'w-9 h-9' : 'w-11 h-11';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
      aria-label={playing ? 'ឈប់' : label}
      className={`${dim} shrink-0 rounded-full flex items-center justify-center transition-colors ${
        playing ? 'bg-brand text-white' : 'bg-accent/10 text-accent hover:bg-accent/20'
      }`}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
    </button>
  );
};

export const EmptyState: React.FC<{ icon: React.ElementType; title: string; body?: string; children?: React.ReactNode }> = ({
  icon: Icon,
  title,
  body,
  children,
}) => (
  <div className="text-center px-6 py-10">
    <div className="mx-auto w-14 h-14 rounded-2xl bg-raised flex items-center justify-center">
      <Icon className="w-7 h-7 text-mute" />
    </div>
    <p className="mt-3 text-sm font-semibold text-ink">{title}</p>
    {body && <p className="mt-1 text-xs text-mute leading-relaxed">{body}</p>}
    {children && <div className="mt-4">{children}</div>}
  </div>
);

/* ── Brand mark: origami paper plane in a gradient frame ── */
export const Logo: React.FC<{ size?: number }> = ({ size = 36 }) => (
  <span
    className="shrink-0 rounded-xl bg-gradient-to-tr from-sky-600 via-cyan-500 to-sky-400 p-[1.5px] flex shadow-lg shadow-brand/20"
    style={{ width: size, height: size }}
  >
    <span className="flex-1 rounded-[10px] bg-navy flex items-center justify-center">
      <Send className="text-cyan-400 -rotate-12" style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2.2} />
    </span>
  </span>
);

/* ── Step bar for the guided flow ── */
export const Stepper: React.FC<{ steps: string[]; current: number }> = ({ steps, current }) => (
  <ol className="flex items-start" aria-label="ជំហាន">
    {steps.map((label, i) => {
      const n = i + 1;
      const done = n < current;
      const on = n === current;
      return (
        <li key={label} className="flex-1 flex flex-col items-center relative" aria-current={on ? 'step' : undefined}>
          {i > 0 && <span className={`absolute top-[15px] right-1/2 w-full h-0.5 ${n <= current ? 'bg-accent' : 'bg-line'}`} aria-hidden />}
          <span
            className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ring-4 ring-navy ${
              done ? 'bg-accent text-navy' : on ? 'bg-accent text-navy shadow-glow' : 'bg-surface text-mute ring-1 ring-line-strong'
            }`}
          >
            {done ? '✓' : n}
          </span>
          <span className={`mt-1.5 text-[11px] font-semibold ${on || done ? 'text-accent' : 'text-mute'}`}>{label}</span>
        </li>
      );
    })}
  </ol>
);
