import { normalizeProxyUrl } from './settingsModel'

export const INTEGRATION_BOOLEAN_DEFAULTS = {
  launchAtStartup: false,
  notifyOnComplete: true,
  notifyOnError: true,
  warnBeforeQuit: true,
  showTray: true
} as const

export type IntegrationBooleanKey = keyof typeof INTEGRATION_BOOLEAN_DEFAULTS

const INTEGRATION_BOOLEAN_KEYS = Object.keys(INTEGRATION_BOOLEAN_DEFAULTS) as IntegrationBooleanKey[]

export function isIntegrationBooleanKey(key: string): key is IntegrationBooleanKey {
  return (INTEGRATION_BOOLEAN_KEYS as string[]).includes(key)
}

export function validateSettingUpdate(key: string, value: unknown): boolean {
  if (isIntegrationBooleanKey(key)) return typeof value === 'boolean'
  if (key === 'proxyUrl') return typeof value === 'string' && (value.trim() === '' || normalizeProxyUrl(value) !== '')
  return false
}

export function normalizeIntegrationSettings(s: {
  launchAtStartup: boolean
  notifyOnComplete: boolean
  notifyOnError: boolean
  warnBeforeQuit: boolean
  showTray: boolean
  proxyUrl: string
}): void {
  s.launchAtStartup = Boolean(s.launchAtStartup)
  s.notifyOnComplete = Boolean(s.notifyOnComplete)
  s.notifyOnError = Boolean(s.notifyOnError)
  s.warnBeforeQuit = Boolean(s.warnBeforeQuit)
  s.showTray = Boolean(s.showTray)
  s.proxyUrl = normalizeProxyUrl(s.proxyUrl)
}
