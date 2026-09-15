import type { Download } from '@/types'

export const COMPACT_HASH = '#/compact'
export const COMPACT_WINDOW_TITLE = 'V-Download Mini'

const ACTIVE_STATUSES = new Set(['downloading', 'queued', 'resolving'])

export function isCompactHash(hash: string): boolean {
  return hash === COMPACT_HASH
}

export function compactActiveDownloads<T extends Pick<Download, 'status'>>(downloads: T[]): T[] {
  return downloads.filter((item) => ACTIVE_STATUSES.has(item.status))
}

export function compactProgressLine(download: Pick<Download, 'progress' | 'eta'>): string {
  const pct = Math.max(0, Math.min(100, Math.round(Number(download.progress) || 0)))
  const eta = typeof download.eta === 'string' && download.eta.trim() ? download.eta.trim() : ''
  return eta ? `${pct}% ${eta}` : `${pct}%`
}

export function oneShotClipboardFill(currentValue: string, clipboardText: string, extractUrl: (text: string) => string | null): string {
  if (currentValue.trim()) return currentValue
  return extractUrl(clipboardText) ?? ''
}
