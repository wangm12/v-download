import { getQueueConcurrencyPolicy, type QueueSpeedMode } from '@v-download/shared'
import { translate } from '../../../i18n/catalog'

export const PREFERENCES_WORKSPACE_CLASS = 'mx-auto flex w-full max-w-[760px] flex-col space-y-4'
export const GENERAL_SECTION_CLASS = 'w-full'

export const OUTPUT_FILENAME_TOKENS = ['{title}', '{id}', '{author}', '{date}', '{time}', '{site}', '{ext}'] as const
export const OUTPUT_FOLDER_TOKENS = ['{title}', '{id}', '{author}', '{date}', '{time}', '{site}'] as const

const FILENAME_TOKEN_NAMES = new Set(['title', 'id', 'author', 'date', 'time', 'site', 'ext'])
const FOLDER_TOKEN_NAMES = new Set(['title', 'id', 'author', 'date', 'time', 'site'])

export type OutputTemplateError = { key: string; vars?: Record<string, string | number> }

export function outputTemplateError(template: string, kind: 'filename' | 'folder'): OutputTemplateError | null {
  if (/%\(/.test(template)) return { key: 'prefs.saveFiles.errRaw' }
  if (template.replace(/\\/g, '/').split('/').some((segment) => segment === '..')) {
    return { key: 'prefs.saveFiles.errParent' }
  }
  if (kind === 'filename' && !template.trim()) return { key: 'prefs.saveFiles.errFilenameRequired' }
  const allowed = kind === 'folder' ? FOLDER_TOKEN_NAMES : FILENAME_TOKEN_NAMES
  const tokenRe = /\{([^{}]*)\}/g
  let match = tokenRe.exec(template)
  while (match) {
    if (!allowed.has(match[1])) return { key: 'prefs.saveFiles.errUnknownToken', vars: { token: match[1] } }
    match = tokenRe.exec(template)
  }
  return null
}

export function previewOutputPath(options: {
  downloadDir: string
  filenameTemplate: string
  folderNameTemplate: string
  archiveByAuthor: boolean
}): string {
  const filenameError = outputTemplateError(options.filenameTemplate, 'filename')
  if (filenameError) return translate('en', filenameError.key, filenameError.vars)
  const folderError = outputTemplateError(options.folderNameTemplate, 'folder')
  if (folderError) return translate('en', folderError.key, folderError.vars)
  const now = new Date()
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
  const sample: Record<string, string> = {
    title: 'Title',
    id: 'id',
    author: 'DemoAuthor',
    date,
    time,
    site: 'youtube',
    ext: 'mp4'
  }
  const render = (template: string) => template.replace(/\{([^{}]+)\}/g, (_all, token: string) => sample[token] ?? '')
  const file = options.filenameTemplate.includes('{ext}')
    ? render(options.filenameTemplate)
    : `${render(options.filenameTemplate)}.mp4`
  const folder = options.archiveByAuthor ? render(options.folderNameTemplate).trim() : ''
  const base = options.downloadDir || '~/Downloads'
  return [base, folder, file].filter(Boolean).join('/')
}

export const LANGUAGE_PREFERENCE_VALUES = ['system', 'en', 'zh-CN', 'zh-TW'] as const
export const THEME_PREFERENCE_VALUES = ['device', 'dark', 'light'] as const

export function languageSelectValue(preference: unknown): (typeof LANGUAGE_PREFERENCE_VALUES)[number] {
  return preference === 'system' || preference === 'zh-CN' || preference === 'zh-TW' ? preference : 'en'
}

export function themeSelectValue(preference: unknown): (typeof THEME_PREFERENCE_VALUES)[number] {
  return preference === 'dark' || preference === 'light' ? preference : 'device'
}

export const PREFERENCES_SECTION_TITLES = [
  'Language',
  'Theme',
  'Download behavior',
  'Startup and notifications',
  'Save files',
  'Default format',
  'Download speed',
  'Queue behavior',
  'Network / engine',
  'Playlists',
  'Chrome cookie sync',
  'In-app account login',
  'Per-site rules',
  'System',
  'Expert tools',
  'Remote Job API',
  'Agent skill'
] as const

export function canPersistSiteRule(domain: string): boolean {
  return domain.trim().length > 0
}

export function hasSingleColumnPolicy(className: string): boolean {
  return className.includes('max-w-') && className.includes('space-y-')
}

export const DOWNLOAD_SPEED_MODES: QueueSpeedMode[] = ['balanced', 'turbo', 'gentle']

export function getDownloadSpeedPresentation(mode: QueueSpeedMode) {
  const policy = getQueueConcurrencyPolicy(mode)
  const labels: Record<QueueSpeedMode, string> = { balanced: 'Balanced', turbo: 'Turbo', gentle: 'Gentle' }
  const descriptions: Record<QueueSpeedMode, string> = {
    balanced: `Up to ${policy.individualLimit} individual tasks, ${policy.collectionLimit} tasks per collection, and ${policy.activeCollectionLimit} active collections (${policy.theoreticalMax} active engine tasks theoretical maximum). Uses a short start delay, ${mode === 'balanced' ? 5 : 0} fragment slots, and the automatic media path.`,
    turbo: `Same ${policy.theoreticalMax}-task cap as Balanced. Removes the start delay, uses 16 fragment slots, and the yt-dlp direct-media path; faster, but more likely to trigger HTTP 429/rate limits.`,
    gentle: `Up to ${policy.individualLimit} individual task, ${policy.collectionLimit} task per collection, and ${policy.activeCollectionLimit} active collection (${policy.theoreticalMax} active engine tasks theoretical maximum). Uses a slower start interval, 2 fragment slots, and the automatic media path.`
  }
  const shortDescriptions: Record<QueueSpeedMode, string> = {
    balanced: 'Recommended for most downloads.',
    turbo: 'Faster starts; some sites may rate-limit you.',
    gentle: 'Slower starts for stricter sites and weaker connections.'
  }
  return { label: labels[mode], description: descriptions[mode], shortDescription: shortDescriptions[mode], policy }
}

export function getEffectiveIndividualLimit(mode: QueueSpeedMode, configuredConcurrency: unknown): number {
  const { individualLimit } = getQueueConcurrencyPolicy(mode)
  const numericConcurrency = Number(configuredConcurrency)
  if (Number.isNaN(numericConcurrency)) return individualLimit
  return Math.max(1, Math.min(Math.floor(numericConcurrency), individualLimit))
}
