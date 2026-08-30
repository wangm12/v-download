import type { Download, DownloadStatus } from '../types'

export type QueueFilter = 'all' | 'active' | 'done' | 'attention'
export type QueueEmptyKind = 'ready' | 'noSearchMatches' | 'noFilterMatches'

const ACTIVE_STATUSES = new Set<DownloadStatus>(['downloading', 'queued', 'paused', 'resolving', 'ready'])
const ATTENTION_STATUSES = new Set<DownloadStatus>(['error', 'interrupted', 'cancelled'])

export function filterDownloadsBySearch(downloads: Download[], query: string): Download[] {
  const q = query.trim().toLowerCase()
  if (!q) return downloads
  return downloads.filter(
    (d) => d.title.toLowerCase().includes(q) || d.url.toLowerCase().includes(q)
  )
}

export function filterDownloadsByStatus(downloads: Download[], filter: QueueFilter): Download[] {
  if (filter === 'all') return downloads
  if (filter === 'done') return downloads.filter((item) => item.status === 'complete')
  if (filter === 'active') return downloads.filter((item) => ACTIVE_STATUSES.has(item.status))
  return downloads.filter((item) => ATTENTION_STATUSES.has(item.status))
}

export function filterQueueDownloads(downloads: Download[], query: string, filter: QueueFilter): Download[] {
  return filterDownloadsBySearch(filterDownloadsByStatus(downloads, filter), query)
}

export function countQueueAttention(downloads: Download[]): number {
  return downloads.filter((item) => ATTENTION_STATUSES.has(item.status)).length
}

export function getQueueEmptyKind(input: {
  totalCount: number
  visibleCount: number
  searchQuery: string
  filter: QueueFilter
}): QueueEmptyKind | null {
  if (input.visibleCount > 0) return null
  if (input.searchQuery.trim()) return 'noSearchMatches'
  if (input.totalCount === 0 && input.filter === 'all') return 'ready'
  return 'noFilterMatches'
}
