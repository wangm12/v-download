import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/renderer/src/**/*.{ts,tsx}', './src/renderer/index.html'],
  theme: {
    extend: {
      colors: {
        background: '#1A1A1E',
        surface: '#16161A',
        elevated: '#0F0F12',
        border: '#2A2A2E',
        'border-strong': '#3A3A40',
        foreground: '#FAFAF9',
        'muted-foreground': '#6B6B70',
        'tertiary-foreground': '#4A4A50',
        'subtle-foreground': '#8E8E93',
        'accent-green': '#32D583',
        'accent-green-dark': '#059669',
        'accent-indigo': '#FFFFFF',
        'accent-indigo-dark': '#D4D4D8',
        'accent-coral': '#E85A4F',
        'accent-amber': '#FFB547'
      },
      fontFamily: {
        sans: ['DM Sans', 'Inter', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
}

export default config
