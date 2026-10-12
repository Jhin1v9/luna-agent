/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{svelte,js,ts}'],
  theme: {
    extend: {
      colors: {
        luna: {
          bg: '#0a0a1a',
          surface: '#12121f',
          elevated: '#1a1a2e',
          border: 'rgba(255,255,255,0.06)',
          text: '#e2e8f0',
          'text-secondary': '#94a3b8',
          primary: '#e94560',
          'primary-hover': '#ff6b6b',
          gold: '#ffd700',
        },
        tool: {
          writeFile: '#3b82f6',
          readFile: '#22c55e',
          executeShell: '#a855f7',
          searchWeb: '#f97316',
          git: '#6b7280',
          dashboard: '#ec4899',
          replaceInFile: '#06b6d4',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 300ms cubic-bezier(0.4, 0, 0.2, 1)',
        'slide-up': 'slideUp 300ms cubic-bezier(0.4, 0, 0.2, 1)',
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-dots': 'bounceDots 1.4s infinite ease-in-out both',
        'spring': 'spring 300ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        'progress-indeterminate': 'progressIndeterminate 1.5s infinite linear',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        bounceDots: {
          '0%, 80%, 100%': { transform: 'scale(0)' },
          '40%': { transform: 'scale(1)' },
        },
        spring: {
          '0%': { transform: 'scale(0.9)' },
          '100%': { transform: 'scale(1)' },
        },
        progressIndeterminate: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
    },
  },
  plugins: [],
};
