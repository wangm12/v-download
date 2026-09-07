import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import {
  catalogs,
  mapSystemLocale,
  normalizeUiLanguagePreference,
  resolveUiLanguage,
  type AppLanguage,
  type UiLanguagePreference
} from '../../i18n/catalog'

export type { AppLanguage, UiLanguagePreference }

const LANGUAGE_STORAGE_KEY = 'v-download:ui:language'

const resources = {
  en: { translation: catalogs.en },
  'zh-CN': { translation: catalogs['zh-CN'] },
  'zh-TW': { translation: catalogs['zh-TW'] }
} as const

function systemLocale(): string {
  return typeof navigator !== 'undefined' ? navigator.language : ''
}

function readStoredLanguagePreference(): UiLanguagePreference | null {
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return value === 'system' || value === 'en' || value === 'zh-CN' || value === 'zh-TW' ? value : null
  } catch {
    return null
  }
}

export function detectLanguage(): AppLanguage {
  const stored = readStoredLanguagePreference()
  if (stored === 'system' || stored === null) return mapSystemLocale(systemLocale())
  return stored
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

export async function changeAppLanguage(language: UiLanguagePreference): Promise<void> {
  const preference = normalizeUiLanguagePreference(language)
  const resolved = resolveUiLanguage(preference, systemLocale())
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, preference)
  } catch {
    /* Continue changing the in-memory language when storage is unavailable. */
  }
  await i18n.changeLanguage(resolved)
  if (typeof window !== 'undefined' && window.api?.updateSettings) {
    try {
      await window.api.updateSettings('uiLanguage', preference)
    } catch {
      /* Main persist is best-effort; renderer language already changed. */
    }
  }
}

export function syncLanguageFromSettings(value: unknown): void {
  const preference = normalizeUiLanguagePreference(value)
  const resolved = resolveUiLanguage(preference, systemLocale())
  if (i18n.language !== resolved) {
    void i18n.changeLanguage(resolved)
  }
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, preference)
  } catch {
    /* Ignore storage failures while syncing from main. */
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('languagechange', () => {
    if (readStoredLanguagePreference() !== 'system') return
    const resolved = mapSystemLocale(systemLocale())
    if (i18n.language !== resolved) void i18n.changeLanguage(resolved)
  })
}

export default i18n
