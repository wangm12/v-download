import { translate, type AppLanguage } from '../i18n/catalog'

const UUID_PATH = /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function osNotificationCopy(
  status: 'complete' | 'error',
  title: string,
  language: AppLanguage
): { title: string; body: string } {
  return {
    title: translate(language, status === 'complete' ? 'notify.completeTitle' : 'notify.errorTitle'),
    body: title.trim() || translate(language, 'notify.fallbackBody')
  }
}

export function shouldNotifyOs(input: {
  status: string
  notifyOnComplete: boolean
  notifyOnError: boolean
  windowFocused: boolean
}): boolean {
  if (input.windowFocused) return false
  if (input.status === 'complete') return input.notifyOnComplete
  if (input.status === 'error') return input.notifyOnError
  return false
}

export function parseTaskDeepLink(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'vdownload:') return null
    if (parsed.hostname !== 'task') return null
    if (!UUID_PATH.test(parsed.pathname)) return null
    return parsed.pathname.slice(1)
  } catch {
    return null
  }
}
