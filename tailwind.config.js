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
        glow: '0 0 25px -5px rgba(0, 240, 255, 0.25)',
        subtle: '0 4px 20px -2px rgba(0, 0, 0, 0.5)',
      },
    },
  },
  plugins: [],
};
