import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Info, Loader2, Pause, Play, TriangleAlert, X, XCircle } from 'lucide-react';
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
    success: 'text-emerald-600',
    error: 'text-red-600',
    warning: 'text-amber-600',
    info: 'text-blue-600',
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
              className="pointer-events-auto w-full max-w-md rounded-2xl bg-white shadow-lg ring-1 ring-slate-200 px-4 py-3 flex items-start gap-3 animate-[toast_.2s_ease-out]"
            >
              <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${tone[t.type]}`} />
              <p className="text-sm text-slate-800 leading-relaxed flex-1">{t.msg}</p>
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
    primary: 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 disabled:bg-slate-300',
    secondary: 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
    ghost: 'text-slate-600 hover:bg-slate-100 disabled:text-slate-300',
    danger: 'bg-white text-red-600 ring-1 ring-red-200 hover:bg-red-50',
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
  <section className={`bg-white rounded-2xl ring-1 ring-slate-200 ${className}`}>{children}</section>
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
      <span className="block text-sm font-medium text-slate-800">{label}</span>
      {hint && <span className="block text-xs text-slate-500 mt-0.5">{hint}</span>}
    </span>
    <input type="checkbox" className="sr-only peer" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    <span className="relative w-11 h-6 shrink-0 rounded-full bg-slate-300 peer-checked:bg-blue-600 transition-colors after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-400" />
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
  <div className="inline-flex rounded-xl bg-slate-100 p-1">
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        disabled={disabled}
        onClick={() => onChange(o.value)}
        className={`px-3 min-h-[32px] rounded-lg text-xs font-semibold transition-colors ${
          value === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
        }`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export const Progress: React.FC<{ value: number; pulse?: boolean }> = ({ value, pulse }) => (
  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
    <div className={`h-full bg-blue-600 transition-all duration-500 ${pulse ? 'animate-pulse' : ''}`} style={{ width: `${Math.max(3, Math.min(100, value))}%` }} />
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
      <button type="button" aria-label="បិទ" className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[88vh] flex flex-col bg-white rounded-t-3xl sm:rounded-3xl shadow-xl animate-[sheet_.22s_ease-out]">
        <header className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-slate-100">
          <h2 className="flex-1 text-base font-bold text-slate-900 truncate">{title}</h2>
          <button type="button" onClick={onClose} className="w-9 h-9 -mr-2 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100" aria-label="បិទ">
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

export const PlayButton: React.FC<{ src: string; label?: string; size?: 'sm' | 'md' }> = ({ src, label = 'ស្ដាប់', size = 'md' }) => {
  const [current, setCurrent] = useState<string | null>(playingSrc);
  const [loading, setLoading] = useState(false);
  const full = useRef(withToken(src));
  full.current = withToken(src);
  useEffect(() => {
    listeners.add(setCurrent);
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);
  const playing = current === full.current;
  const toggle = () => {
    if (!sharedAudio) {
      sharedAudio = new Audio();
      sharedAudio.onended = sharedAudio.onerror = () => {
        playingSrc = null;
        emit();
      };
    }
    if (playing) {
      sharedAudio.pause();
      playingSrc = null;
      emit();
      return;
    }
    sharedAudio.src = full.current;
    setLoading(true);
    sharedAudio
      .play()
      .then(() => {
        playingSrc = full.current;
        emit();
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
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
        playing ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
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
    <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
      <Icon className="w-7 h-7 text-slate-400" />
    </div>
    <p className="mt-3 text-sm font-semibold text-slate-800">{title}</p>
    {body && <p className="mt-1 text-xs text-slate-500 leading-relaxed">{body}</p>}
    {children && <div className="mt-4">{children}</div>}
  </div>
);
