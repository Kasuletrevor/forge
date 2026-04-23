import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        forge: {
          ink: '#241c1d',
          paper: '#f7f2e9',
          canvas: '#efe5d8',
          mist: '#fbf8f3',
          steel: '#9a8b80',
          ember: '#7f2f3f',
          burgundySoft: '#9a4d60',
          sage: '#6f7f68',
          night: '#1f1719',
        },
      },
      boxShadow: {
        panel: '0 20px 54px rgba(31, 23, 25, 0.16)',
        raised: '0 8px 22px rgba(31, 23, 25, 0.15)',
      },
      fontFamily: {
        body: ['"Inter"', '"IBM Plex Sans"', 'ui-sans-serif', 'sans-serif'],
        display: ['"Fraunces"', 'ui-serif', 'serif'],
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1.2rem', letterSpacing: '0.01em' }],
        sm: ['0.875rem', { lineHeight: '1.4rem' }],
        base: ['1rem', { lineHeight: '1.65rem' }],
        lg: ['1.125rem', { lineHeight: '1.8rem' }],
        xl: ['1.25rem', { lineHeight: '1.9rem' }],
        '2xl': ['1.5rem', { lineHeight: '2.1rem' }],
        '3xl': ['1.85rem', { lineHeight: '2.35rem' }],
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.2, 0, 0, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config
