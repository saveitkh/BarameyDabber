/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        khmer: ['"Kantumruy Pro"', '"Noto Sans Khmer"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
