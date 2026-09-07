import type { AppLanguage } from '../i18n/catalog'

type Listener = (language: AppLanguage) => void

const listeners = new Set<Listener>()

export function onUiLanguageChanged(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function emitUiLanguageChanged(language: AppLanguage): void {
  for (const listener of listeners) listener(language)
}
