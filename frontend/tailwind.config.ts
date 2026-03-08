import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        forge: {
          ink: '#151310',
          paper: '#f3efe7',
          steel: '#8a7d68',
          ember: '#d96b2b',
          sage: '#6f8466',
          night: '#25211c',
        },
      },
      boxShadow: {
        panel: '0 18px 50px rgba(23, 20, 16, 0.18)',
      },
      fontFamily: {
        body: ['"IBM Plex Sans"', 'ui-sans-serif', 'sans-serif'],
        display: ['"Fraunces"', 'ui-serif', 'serif'],
      },
    },
  },
  plugins: [],
} satisfies Config
