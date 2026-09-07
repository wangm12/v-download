import { translate, type AppLanguage } from '../i18n/catalog'

const ACTIVE_QUIT_STATUSES = new Set(['downloading', 'resolving'])

export function quitDialogCopy(language: AppLanguage): {
  title: string
  message: string
  buttons: [string, string]
} {
  return {
    title: translate(language, 'quit.title'),
    message: translate(language, 'quit.message'),
    buttons: [translate(language, 'quit.cancel'), translate(language, 'quit.confirm')]
  }
}

export function shouldWarnBeforeQuit(input: {
  warnBeforeQuit: boolean
  statuses: string[]
}): boolean {
  if (!input.warnBeforeQuit) return false
  return input.statuses.some((status) => ACTIVE_QUIT_STATUSES.has(status))
}
