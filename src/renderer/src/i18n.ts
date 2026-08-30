import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

export type AppLanguage = 'en' | 'zh-CN' | 'zh-TW'

const LANGUAGE_STORAGE_KEY = 'v-download:ui:language'

const resources = {
  en: {
    translation: {
      nav: {
        workspace: 'Workspace',
        downloads: 'Downloads',
        preferences: 'Preferences',
        applicationSettings: 'Application settings',
      },
      language: {
        label: 'Language',
        description: 'Choose the language used by the main navigation.',
        english: 'English',
        simplifiedChinese: '简体中文',
        traditionalChinese: '繁體中文',
      },
    },
  },
  'zh-CN': {
    translation: {
      nav: {
        workspace: '工作区',
        downloads: '下载',
        preferences: '偏好设置',
        applicationSettings: '应用设置',
      },
      language: {
        label: '语言',
        description: '选择主导航使用的语言。',
        english: 'English',
        simplifiedChinese: '简体中文',
        traditionalChinese: '繁體中文',
      },
    },
  },
  'zh-TW': {
    translation: {
      nav: {
        workspace: '工作區',
        downloads: '下載',
        preferences: '偏好設定',
        applicationSettings: '應用程式設定',
      },
      language: {
        label: '語言',
        description: '選擇主導覽使用的語言。',
        english: 'English',
        simplifiedChinese: '简体中文',
        traditionalChinese: '繁體中文',
      },
    },
  },
} as const

function readStoredLanguage(): AppLanguage | null {
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return value === 'en' || value === 'zh-CN' || value === 'zh-TW' ? value : null
  } catch {
    return null
  }
}

function detectLanguage(): AppLanguage {
  const stored = readStoredLanguage()
  if (stored) return stored
  const browserLanguage = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : ''
  if (browserLanguage.startsWith('zh-tw') || browserLanguage.startsWith('zh-hk')) return 'zh-TW'
  if (browserLanguage.startsWith('zh')) return 'zh-CN'
  return 'en'
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export async function changeAppLanguage(language: AppLanguage): Promise<void> {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    /* Continue changing the in-memory language when storage is unavailable. */
  }
  await i18n.changeLanguage(language)
}

export function currentAppLanguage(): AppLanguage {
  const language = i18n.language
  return language === 'zh-CN' || language === 'zh-TW' ? language : 'en'
}

export default i18n
