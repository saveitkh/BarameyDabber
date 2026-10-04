import React, { useEffect, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';

/**
 * Small floating button that toggles true browser/OS fullscreen (works on
 * desktop Chrome/Edge/Firefox and on Android; iOS Safari and Telegram's own
 * iOS webview don't expose the Fullscreen API, so on iOS this instead asks
 * Telegram's own SDK to expand the Mini App to its tallest size -- the
 * closest thing to fullscreen that platform allows, and a harmless no-op
 * outside Telegram.
 */
export const FullscreenToggleButton: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => Boolean(document.fullscreenElement));
  const [supported, setSupported] = useState<boolean>(true);

  useEffect(() => {
    const el = document.documentElement as any;
    setSupported(Boolean(el.requestFullscreen || el.webkitRequestFullscreen || (window as any).Telegram?.WebApp));
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  if (!supported) return null;

  const toggle = async () => {
    const el = document.documentElement as any;
    try {
      if (document.fullscreenElement) {
        await (document.exitFullscreen?.() ?? (document as any).webkitExitFullscreen?.());
        return;
      }
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      } else {
        // iOS / platforms with no Fullscreen API: fall back to Telegram's own expand
        (window as any).Telegram?.WebApp?.expand?.();
      }
    } catch {
      // A user gesture is required for fullscreen in most browsers; if this
      // was called without one (or the browser refused), just try Telegram's.
      (window as any).Telegram?.WebApp?.expand?.();
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={isFullscreen ? 'ចេញពី Fullscreen' : 'មើលពេញអេក្រង់ (Fullscreen)'}
      aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      className={`fixed bottom-4 right-4 z-[90] flex h-11 w-11 items-center justify-center rounded-full border border-slate-700/80 bg-slate-900/90 text-slate-200 shadow-lg backdrop-blur transition hover:bg-slate-800 active:scale-95 ${className}`}
    >
      {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
    </button>
  );
};
