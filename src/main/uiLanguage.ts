import { app } from 'electron'
import { resolveUiLanguage, type AppLanguage } from '../i18n/catalog'
import * as settings from './settings'

export function getUiLanguage(): AppLanguage {
  try {
    let locale = ''
    try {
      locale = app.getLocale()
    } catch {
      /* app may not be ready in isolated tests */
    }
    return resolveUiLanguage(settings.get('uiLanguage'), locale)
  } catch {
    return 'en'
  }
}
