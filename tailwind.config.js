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
        soft: '0 2px 12px -2px rgba(15, 23, 42, 0.08)',
        card: '0 1px 3px rgba(15, 23, 42, 0.06), 0 8px 24px -8px rgba(79, 70, 229, 0.12)',
        glow: '0 0 0 4px rgba(99, 102, 241, 0.15)',
      },
      backgroundImage: {
        blend: 'linear-gradient(120deg, #4f46e5 0%, #0d9488 55%, #d97706 110%)',
        'blend-soft': 'linear-gradient(120deg, #6366f1 0%, #14b8a6 55%, #f59e0b 110%)',
        'blend-radial': 'radial-gradient(1200px 600px at 20% -10%, rgba(99,102,241,0.12), transparent), radial-gradient(1000px 500px at 80% 110%, rgba(13,148,136,0.10), transparent)',
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