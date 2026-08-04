import type { Config } from 'tailwindcss'

/** Semantic colors follow CSS variables in globals.css (data-theme dark | light). */
const config: Config = {
  content: ['./src/renderer/src/**/*.{ts,tsx}', './src/renderer/index.html'],
  theme: {
    extend: {
      colors: {
        app: 'rgb(var(--color-app) / <alpha-value>)',
        window: 'rgb(var(--color-window) / <alpha-value>)',
        sidebar: 'rgb(var(--color-sidebar) / <alpha-value>)',
        background: 'rgb(var(--color-background) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        raised: 'rgb(var(--color-raised) / <alpha-value>)',
        elevated: 'rgb(var(--color-elevated) / <alpha-value>)',
        control: 'var(--color-control)',
        border: 'var(--color-border)',
        'border-strong': 'var(--color-border-strong)',
        'border-focus': 'var(--color-border-focus)',
        foreground: 'rgb(var(--color-foreground) / <alpha-value>)',
        'muted-foreground': 'rgb(var(--color-muted-foreground) / <alpha-value>)',
        'tertiary-foreground': 'rgb(var(--color-tertiary-foreground) / <alpha-value>)',
        'subtle-foreground': 'rgb(var(--color-subtle-foreground) / <alpha-value>)',
        inverse: 'rgb(var(--color-inverse) / <alpha-value>)',
        action: 'rgb(var(--color-action) / <alpha-value>)',
        'action-hover': 'rgb(var(--color-action-hover) / <alpha-value>)',
        'action-fg': 'rgb(var(--color-action-fg) / <alpha-value>)',
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        'accent-hover': 'rgb(var(--color-accent-hover) / <alpha-value>)',
        'accent-fg': 'rgb(var(--color-accent-fg) / <alpha-value>)',
        success: 'rgb(var(--color-success) / <alpha-value>)',
        warning: 'rgb(var(--color-warning) / <alpha-value>)',
        error: 'rgb(var(--color-error) / <alpha-value>)',
        'surface-hover': 'var(--color-surface-hover)',
        selection: 'var(--color-selection)',
        'divider-subtle': 'var(--color-divider-subtle)',
        'divider-strong': 'var(--color-divider-strong)',
        'state-active-bg': 'var(--color-state-active-bg)',
        'state-complete-bg': 'var(--color-state-complete-bg)',
        'state-queued-bg': 'var(--color-state-queued-bg)',
        'state-error-bg': 'var(--color-state-error-bg)',
        progress: 'var(--color-progress)',
        'progress-muted': 'var(--color-progress-muted)'
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Text',
          'Inter',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'Noto Sans CJK SC',
          'sans-serif'
        ]
      },
      borderRadius: {
        button: '12px',
        card: '18px',
        panel: '22px'
      },
      transitionDuration: {
        panel: '320ms'
      },
      transitionTimingFunction: {
        panel: 'cubic-bezier(0.32, 0.72, 0, 1)'
      },
      keyframes: {
        'panel-fade-in': {
          '0%': { opacity: '0', transform: 'translateX(6px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' }
        },
        'panel-fade-in-from-left': {
          '0%': { opacity: '0', transform: 'translateX(-8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' }
        }
      },
      animation: {
        'panel-fade-in': 'panel-fade-in 0.28s ease-out both',
        'panel-fade-in-from-left': 'panel-fade-in-from-left 0.28s ease-out both'
      }
    }
  },
  plugins: []
}

export default config
