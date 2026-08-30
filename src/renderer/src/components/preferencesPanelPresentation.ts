import { getQueueConcurrencyPolicy, type QueueSpeedMode } from '@v-download/shared'

export const PREFERENCES_WORKSPACE_CLASS = 'mx-auto flex w-full max-w-[760px] flex-col space-y-4'
export const GENERAL_SECTION_CLASS = 'w-full'

export const PREFERENCES_SECTION_TITLES = [
  'Download behavior',
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
  'Remote Job API'
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
