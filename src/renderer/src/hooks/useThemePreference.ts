import { useCallback, useEffect, useLayoutEffect, useState } from 'react'

export type ThemePreference = 'dark' | 'light' | 'device'

const LS_THEME = 'v-download:ui:theme-preference'

function readStoredPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(LS_THEME)
    if (v === 'dark' || v === 'light' || v === 'device') return v
  } catch {
    /* ignore */
  }
  return 'device'
}

function useSystemPrefersDark(): boolean {
  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : true
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return dark
}

function preferenceToNativeSource(preference: ThemePreference): 'dark' | 'light' | 'system' {
  if (preference === 'dark') return 'dark'
  if (preference === 'light') return 'light'
  return 'system'
}

/** Sync document `data-theme` + localStorage; `resolvedTheme` is the applied light/dark scheme. */
export function useThemePreference() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredPreference())
  const systemDark = useSystemPrefersDark()

  const resolvedTheme: 'dark' | 'light' =
    preference === 'dark' ? 'dark' : preference === 'light' ? 'light' : systemDark ? 'dark' : 'light'

  useLayoutEffect(() => {
    try {
      localStorage.setItem(LS_THEME, preference)
    } catch {
      /* ignore */
    }
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.style.colorScheme = resolvedTheme
    void window.api?.setNativeThemeSource?.(preferenceToNativeSource(preference))
  }, [preference, resolvedTheme])

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
  }, [])

  return { preference, setPreference, resolvedTheme }
}
