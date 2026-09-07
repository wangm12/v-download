import type { DownloadStatus } from '../types'

export type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'error'

export function getStatusTone(status: DownloadStatus): StatusTone {
  switch (status) {
    case 'complete':
      return 'success'
    case 'downloading':
    case 'resolving':
    case 'ready':
      return 'accent'
    case 'paused':
    case 'interrupted':
      return 'warning'
    case 'error':
      return 'error'
    case 'queued':
    case 'cancelled':
    default:
      return 'neutral'
  }
}

export function getStatusLabel(status: DownloadStatus): string {
  switch (status) {
    case 'complete':
      return 'status.complete'
    case 'downloading':
      return 'status.downloading'
    case 'resolving':
      return 'status.resolving'
    case 'ready':
      return 'status.ready'
    case 'queued':
      return 'status.queued'
    case 'paused':
      return 'status.paused'
    case 'error':
      return 'status.error'
    case 'interrupted':
      return 'status.interrupted'
    case 'cancelled':
      return 'status.cancelled'
    default:
      return status
  }
}

export function getCollectionStatus(input: {
  hasErrors: boolean
  remainingCount: number
  hasActiveItems: boolean
}): { label: 'status.needsAttention' | 'status.complete' | 'status.inProgress' | 'status.queued'; tone: StatusTone } {
  if (input.hasErrors) return { label: 'status.needsAttention', tone: 'warning' }
  if (input.remainingCount === 0) return { label: 'status.complete', tone: 'success' }
  if (input.hasActiveItems) return { label: 'status.inProgress', tone: 'accent' }
  return { label: 'status.queued', tone: 'neutral' }
}
