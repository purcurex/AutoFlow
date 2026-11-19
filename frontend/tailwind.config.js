/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Noto Sans SC', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        primary: {
          50: 'var(--color-selection-surface)',
          100: 'var(--color-selection-surface)',
          200: 'var(--color-selection-border)',
          300: 'var(--color-selection-border)',
          400: 'var(--color-primary)',
          500: 'var(--color-primary)',
          600: 'var(--color-primary)',
          700: 'var(--color-link)',
          800: 'var(--color-link)',
          900: 'var(--color-link)',
          950: 'var(--color-link)',
        },
      },
    },
  },
  plugins: [],
}
