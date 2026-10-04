import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';

/** Coarse amplitude envelope of the whole original soundtrack, fetched once per project. */
export const useSourceWaveform = (projectKey: string | null) => {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    setPeaks(null);
    if (!projectKey) return;
    let cancelled = false;
    api
      .getWaveform(projectKey)
      .then((r) => {
        if (!cancelled) setPeaks(r.peaks || []);
      })
      .catch(() => {
        if (!cancelled) setPeaks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectKey]);
  return peaks;
};

/** Mirrored bar waveform across a whole track row, from server-computed peaks (0..1). */
export const TrackWaveform: React.FC<{ peaks: number[] | null; className?: string }> = ({ peaks, className }) => {
  if (!peaks || peaks.length === 0) return null;
  return (
    <div className={`pointer-events-none absolute inset-0 flex items-center gap-px px-px ${className || ''}`}>
      {peaks.map((p, i) => (
        <span
          key={i}
          className="flex-1 min-w-px rounded-full bg-current transition-[height] duration-150"
          style={{ height: `${Math.max(6, p * 100)}%` }}
        />
      ))}
    </div>
  );
};

const sparkCache = new Map<string, number[] | 'loading' | 'error'>();

/**
 * Small amplitude sparkline decoded client-side from one line's own (short) generated clip.
 * Cached per URL for the lifetime of the page.
 */
export const LineSparkline: React.FC<{ url: string }> = ({ url }) => {
  const [, force] = useState(0);
  const cached = sparkCache.get(url);

  useEffect(() => {
    if (sparkCache.has(url)) return;
    sparkCache.set(url, 'loading');
    let cancelled = false;
    (async () => {
      try {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) throw new Error('no AudioContext');
        const ctx = new Ctx();
        const buf = await fetch(url).then((r) => r.arrayBuffer());
        const audio = await ctx.decodeAudioData(buf);
        const data = audio.getChannelData(0);
        const bars = 28;
        const chunk = Math.max(1, Math.floor(data.length / bars));
        const peaks: number[] = [];
        for (let i = 0; i < bars; i++) {
          let max = 0;
          const start = i * chunk;
          const end = Math.min(data.length, start + chunk);
          for (let j = start; j < end; j++) max = Math.max(max, Math.abs(data[j]));
          peaks.push(max);
        }
        const top = Math.max(...peaks, 0.01);
        ctx.close().catch(() => {});
        if (!cancelled) {
          sparkCache.set(url, peaks.map((p) => p / top));
          force((x) => x + 1);
        }
      } catch {
        if (!cancelled) {
          sparkCache.set(url, 'error');
          force((x) => x + 1);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!cached || cached === 'loading' || cached === 'error') return null;
  return (
    <div className="pointer-events-none absolute inset-x-1 bottom-0.5 top-4 flex items-end gap-px opacity-60">
      {cached.map((p, i) => (
        <span
          key={i}
          className="flex-1 min-w-px rounded-sm bg-current transition-[height] duration-150"
          style={{ height: `${Math.max(8, p * 100)}%`, ['--cs-bar-i' as any]: i }}
        />
      ))}
    </div>
  );
};

/** A time readout bubble shown above a segment while it is being dragged. */
export const DragTooltip: React.FC<{ left: string; label: string }> = ({ left, label }) => (
  <span
    className="pointer-events-none absolute -top-6 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--cs-text)] text-[var(--cs-surface)] text-[10px] font-mono font-bold px-1.5 py-0.5 shadow"
    style={{ left }}
  >
    {label}
  </span>
);
