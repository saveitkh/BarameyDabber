/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        khmer: ['"Kantumruy Pro"', '"Noto Sans Khmer"', 'system-ui', 'sans-serif'],
        sans: ['"Plus Jakarta Sans"', '"Kantumruy Pro"', '"Noto Sans Khmer"', 'system-ui', 'sans-serif'],
      },
      colors: {
        // TeleScripts design tokens (values live in index.css)
        navy: token('navy'),
        surface: token('surface'),
        raised: token('raised'),
        line: token('line'),
        'line-strong': token('line-strong'),
        ink: token('ink'),
        'ink-2': token('ink-2'),
        mute: token('mute'),
        brand: token('brand'),
        'brand-dark': token('brand-dark'),
        accent: token('accent'),
        cyan: { DEFAULT: token('cyan') },
        ok: token('ok'),
        warn: token('warn'),
        bad: token('bad'),
      },
      boxShadow: {
        glow: '0 2px 12px -2px rgba(14, 165, 233, 0.25)',
        subtle: '0 4px 16px -4px rgba(15, 23, 42, 0.12)',
      },
    },
  },
  plugins: [],
};
