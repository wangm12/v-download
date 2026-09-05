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
      return 'Complete'
    case 'downloading':
      return 'Downloading'
    case 'resolving':
      return 'Resolving…'
    case 'ready':
      return 'Ready to download'
    case 'queued':
      return 'Queued'
    case 'paused':
      return 'Paused'
    case 'error':
      return 'Failed'
    case 'interrupted':
      return 'Interrupted'
    case 'cancelled':
      return 'Cancelled'
    default:
      return status
  }
}

export function getCollectionStatus(input: {
  hasErrors: boolean
  remainingCount: number
  hasActiveItems: boolean
}): { label: 'Needs attention' | 'Complete' | 'In progress' | 'Queued'; tone: StatusTone } {
  if (input.hasErrors) return { label: 'Needs attention', tone: 'warning' }
  if (input.remainingCount === 0) return { label: 'Complete', tone: 'success' }
  if (input.hasActiveItems) return { label: 'In progress', tone: 'accent' }
  return { label: 'Queued', tone: 'neutral' }
}
