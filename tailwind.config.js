/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        teal: {
          450: '#14b8a6',
        },
        accent: {
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        },
      },
      boxShadow: {
        soft: 'inset 0 1px 0 rgba(255,255,255,0.75), 0 16px 36px -22px rgba(49, 46, 129, 0.45)',
        card: 'inset 0 1px 0 rgba(255,255,255,0.85), 0 22px 44px -24px rgba(49, 46, 129, 0.5), 0 8px 16px -12px rgba(15, 23, 42, 0.18)',
        glow: '0 0 0 4px rgba(129, 140, 248, 0.28)',
        glass: 'inset 0 1px 0 rgba(255,255,255,0.8), 0 24px 50px -28px rgba(49, 46, 129, 0.55)',
        'glass-lg': 'inset 0 1px 0 rgba(255,255,255,0.9), 0 32px 64px -32px rgba(49, 46, 129, 0.55), 0 12px 24px -16px rgba(15, 23, 42, 0.2)',
        'glass-sm': 'inset 0 1px 0 rgba(255,255,255,0.7), 0 8px 16px -12px rgba(49, 46, 129, 0.35)',
      },
      backgroundImage: {
        blend: 'linear-gradient(120deg, #4f46e5 0%, #0d9488 55%, #d97706 110%)',
        'blend-soft': 'linear-gradient(120deg, #6366f1 0%, #14b8a6 55%, #f59e0b 110%)',
        'blend-radial': 'radial-gradient(1200px 600px at 20% -10%, rgba(99,102,241,0.12), transparent), radial-gradient(1000px 500px at 80% 110%, rgba(13,148,136,0.10), transparent)',
        'glass-gradient-light': 'linear-gradient(135deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.3) 100%)',
        'glass-gradient-dark': 'linear-gradient(135deg, rgba(30,41,72,0.6) 0%, rgba(8,12,24,0.4) 100%)',
        'glass-border-light': 'linear-gradient(135deg, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0.2) 100%)',
        'glass-border-dark': 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 100%)',
        'blob-1': 'radial-gradient(400px 400px at 20% 20%, rgba(99,102,241,0.15), transparent)',
        'blob-2': 'radial-gradient(350px 350px at 80% 80%, rgba(13,148,136,0.12), transparent)',
        'blob-3': 'radial-gradient(300px 300px at 60% 10%, rgba(245,158,11,0.1), transparent)',
      },
      animation: {
        'fade-up': 'fadeUp 0.45s ease forwards',
        'fade-in': 'fadeIn 0.4s ease forwards',
        'blob': 'blob 20s infinite ease-in-out',
        'blob-delay-1': 'blob 20s infinite ease-in-out 3s',
        'blob-delay-2': 'blob 20s infinite ease-in-out 7s',
        'shimmer': 'shimmer 3s infinite linear',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        blob: {
          '0%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(30px, -50px) scale(1.1)' },
          '66%': { transform: 'translate(-20px, 20px) scale(0.95)' },
          '100%': { transform: 'translate(0, 0) scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-up': 'fadeUp 0.45s ease forwards',
        'fade-in': 'fadeIn 0.4s ease forwards',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};