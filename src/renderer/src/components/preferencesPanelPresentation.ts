import { getQueueConcurrencyPolicy, type QueueSpeedMode } from '@v-download/shared'

export const PREFERENCES_WORKSPACE_CLASS = 'mx-auto grid w-full max-w-[1120px] grid-cols-1 gap-4 lg:grid-cols-2'
export const GENERAL_SECTION_CLASS = 'lg:col-span-2'

export const PREFERENCES_SECTION_TITLES = [
  'Behavior',
  'Storage',
  'Download speed',
  'Queue',
  'Direct media (sniff / extension)',
  'YouTube playlists',
  'Douyin bulk (optional)',
  'Output format',
  'Chrome companion',
  'Per-site defaults',
  'Engine'
] as const

export function hasSingleColumnPolicy(className: string): boolean {
  return className.includes('grid-cols-1') && className.includes('lg:grid-cols-2')
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
  return { label: labels[mode], description: descriptions[mode], policy }
}

export function getEffectiveIndividualLimit(mode: QueueSpeedMode, configuredConcurrency: unknown): number {
  const { individualLimit } = getQueueConcurrencyPolicy(mode)
  const numericConcurrency = Number(configuredConcurrency)
  if (Number.isNaN(numericConcurrency)) return individualLimit
  return Math.max(1, Math.min(Math.floor(numericConcurrency), individualLimit))
}
