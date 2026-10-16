import React, { useId } from 'react';

/**
 * Glossy blue "3D" icons (soft gradients, a highlight and a drop shadow), drawn as inline SVG so
 * they stay sharp at any size and need no image files.
 */
export type Icon3DName = 'home' | 'create' | 'videos' | 'voices' | 'settings' | 'film' | 'link';

const BLUE = ['#7cc4ff', '#2f7cf6', '#1d4fd8'] as const; // light → mid → deep

export const Icon3D: React.FC<{ name: Icon3DName; className?: string; muted?: boolean }> = ({ name, className = 'w-7 h-7', muted = false }) => {
  const id = useId().replace(/:/g, '');
  const g = (n: string) => `url(#${n}${id})`;
  const defs = (
    <defs>
      <linearGradient id={`b${id}`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={BLUE[0]} />
        <stop offset=".55" stopColor={BLUE[1]} />
        <stop offset="1" stopColor={BLUE[2]} />
      </linearGradient>
      <linearGradient id={`y${id}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffe27a" />
        <stop offset="1" stopColor="#f5a524" />
      </linearGradient>
      <linearGradient id={`r${id}`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ff8a8a" />
        <stop offset="1" stopColor="#e5383b" />
      </linearGradient>
      <linearGradient id={`w${id}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffffff" stopOpacity=".95" />
        <stop offset="1" stopColor="#dbeafe" stopOpacity=".85" />
      </linearGradient>
      <linearGradient id={`s${id}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity=".55" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <filter id={`d${id}`} x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="2" stdDeviation="1.6" floodColor="#1e3a8a" floodOpacity=".35" />
      </filter>
    </defs>
  );
  let body: React.ReactNode;
  switch (name) {
    case 'home':
      body = (
        <>
          <path d="M8 24 24 9l16 15v14a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3Z" fill={g('b')} />
          <path d="M5 25 24 7l19 18" fill="none" stroke={g('r')} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="19" y="28" width="10" height="13" rx="2.5" fill={g('y')} />
          <path d="M10 26h28v-3L24 11 10 23Z" fill={g('s')} />
        </>
      );
      break;
    case 'create':
      body = (
        <>
          <rect x="7" y="9" width="30" height="26" rx="6" fill={g('b')} />
          <rect x="7" y="9" width="30" height="13" rx="6" fill={g('s')} />
          <circle cx="35" cy="34" r="9.5" fill={g('y')} />
          <path d="M35 29v10M30 34h10" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
          <path d="m18 17 9 5-9 5Z" fill={g('w')} />
        </>
      );
      break;
    case 'videos':
      body = (
        <>
          <path d="M6 14a4 4 0 0 1 4-4h9l4 5h15a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4Z" fill={g('y')} />
          <rect x="6" y="19" width="36" height="22" rx="4.5" fill={g('b')} />
          <rect x="6" y="19" width="36" height="9" rx="4.5" fill={g('s')} />
          <circle cx="24" cy="31" r="7" fill={g('w')} />
          <path d="m22 27.6 6 3.4-6 3.4Z" fill={g('r')} />
        </>
      );
      break;
    case 'voices':
      body = (
        <>
          <rect x="16" y="5" width="16" height="25" rx="8" fill={g('b')} />
          <rect x="16" y="5" width="16" height="11" rx="8" fill={g('s')} />
          <path d="M10 24a14 14 0 0 0 28 0" fill="none" stroke={g('b')} strokeWidth="4" strokeLinecap="round" />
          <path d="M24 38v5M17 43h14" stroke={g('y')} strokeWidth="4" strokeLinecap="round" />
          <path d="M20 14h8M20 19h8" stroke="#fff" strokeOpacity=".7" strokeWidth="2" strokeLinecap="round" />
        </>
      );
      break;
    case 'settings':
      body = (
        <>
          {[0, 45, 90, 135].map((a) => (
            <rect key={a} x="20" y="4.5" width="8" height="39" rx="3" fill={g('b')} transform={`rotate(${a} 24 24)`} />
          ))}
          <circle cx="24" cy="24" r="14.5" fill={g('b')} />
          <circle cx="24" cy="24" r="14.5" fill={g('s')} />
          <circle cx="24" cy="24" r="7.5" fill={g('w')} />
          <circle cx="24" cy="24" r="3.8" fill={g('y')} />
        </>
      );
      break;
    case 'film':
      body = (
        <>
          <rect x="5" y="10" width="38" height="28" rx="6" fill={g('b')} />
          <rect x="5" y="10" width="38" height="13" rx="6" fill={g('s')} />
          <path d="M5 17h38M5 31h38" stroke="#fff" strokeOpacity=".35" strokeWidth="1.5" />
          <circle cx="24" cy="24" r="9" fill={g('y')} />
          <path d="m21.5 19.8 8 4.2-8 4.2Z" fill="#fff" />
        </>
      );
      break;
    case 'link':
      body = (
        <>
          <rect x="4" y="17" width="23" height="14" rx="7" fill="none" stroke={g('b')} strokeWidth="5" transform="rotate(-35 15.5 24)" />
          <rect x="21" y="17" width="23" height="14" rx="7" fill="none" stroke={g('y')} strokeWidth="5" transform="rotate(-35 32.5 24)" />
        </>
      );
      break;
  }
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden style={muted ? { filter: 'saturate(.55)', opacity: 0.85 } : undefined}>
      {defs}
      <g filter={g('d')}>{body}</g>
    </svg>
  );
};
