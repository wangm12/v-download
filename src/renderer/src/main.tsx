import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

function syncThemeFromStorage(): void {
  try {
    const pref = localStorage.getItem('v-download:ui:theme-preference')
    const resolved =
      pref === 'dark'
        ? 'dark'
        : pref === 'light'
          ? 'light'
          : window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
    document.documentElement.dataset.theme = resolved
    document.documentElement.style.colorScheme = resolved
    const nativeSource =
      pref === 'dark' ? 'dark' : pref === 'light' ? 'light' : ('system' as const)
    void window.api?.setNativeThemeSource?.(nativeSource)
  } catch {
    document.documentElement.dataset.theme = 'dark'
    document.documentElement.style.colorScheme = 'dark'
    void window.api?.setNativeThemeSource?.('dark')
  }
}

syncThemeFromStorage()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
