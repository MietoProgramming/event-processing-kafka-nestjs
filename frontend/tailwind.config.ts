import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(214 32% 91%)',
        input: 'hsl(214 32% 91%)',
        ring: 'hsl(210 95% 42%)',
        background: 'hsl(35 43% 97%)',
        foreground: 'hsl(210 34% 18%)',
        primary: {
          DEFAULT: 'hsl(210 95% 42%)',
          foreground: 'hsl(210 40% 98%)',
        },
        secondary: {
          DEFAULT: 'hsl(194 47% 92%)',
          foreground: 'hsl(210 34% 18%)',
        },
        muted: {
          DEFAULT: 'hsl(48 36% 93%)',
          foreground: 'hsl(212 17% 43%)',
        },
        card: {
          DEFAULT: 'hsla(0 0% 100% / 0.72)',
          foreground: 'hsl(210 34% 18%)',
        },
      },
      borderRadius: {
        lg: '1rem',
        md: '0.75rem',
        sm: '0.5rem',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"Manrope"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      boxShadow: {
        glass: '0 18px 45px -25px rgba(12, 43, 76, 0.42)',
      },
      keyframes: {
        floatIn: {
          '0%': { opacity: '0', transform: 'translateY(16px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        floatIn: 'floatIn 600ms ease-out both',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
