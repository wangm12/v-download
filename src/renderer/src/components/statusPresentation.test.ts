import type { DownloadStatus } from '../types'
import {
  getCollectionStatus,
  getStatusLabel,
  getStatusTone
} from './statusPresentation'

const equal = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

const toneByStatus: Record<DownloadStatus, ReturnType<typeof getStatusTone>> = {
  complete: 'success',
  downloading: 'accent',
  resolving: 'accent',
  ready: 'accent',
  paused: 'warning',
  interrupted: 'warning',
  error: 'error',
  queued: 'neutral',
  cancelled: 'neutral'
}

for (const [status, tone] of Object.entries(toneByStatus) as Array<
  [DownloadStatus, ReturnType<typeof getStatusTone>]
>) {
  equal(getStatusTone(status), tone, `${status} tone`)
}

equal(getStatusLabel('complete'), 'status.complete', 'complete label')
equal(getStatusLabel('downloading'), 'status.downloading', 'downloading label')
equal(getStatusLabel('resolving'), 'status.resolving', 'resolving label')
equal(getStatusLabel('ready'), 'status.ready', 'ready label')
equal(getStatusLabel('queued'), 'status.queued', 'queued label')
equal(getStatusLabel('paused'), 'status.paused', 'paused label')
equal(getStatusLabel('error'), 'status.error', 'error label')
equal(getStatusLabel('interrupted'), 'status.interrupted', 'interrupted label')
equal(getStatusLabel('cancelled'), 'status.cancelled', 'cancelled label')

equal(
  JSON.stringify(getCollectionStatus({ hasErrors: true, remainingCount: 2, hasActiveItems: true })),
  JSON.stringify({ label: 'status.needsAttention', tone: 'warning' }),
  'collection with errors'
)
equal(
  JSON.stringify(getCollectionStatus({ hasErrors: false, remainingCount: 0, hasActiveItems: false })),
  JSON.stringify({ label: 'status.complete', tone: 'success' }),
  'collection complete'
)
equal(
  JSON.stringify(getCollectionStatus({ hasErrors: false, remainingCount: 3, hasActiveItems: true })),
  JSON.stringify({ label: 'status.inProgress', tone: 'accent' }),
  'collection in progress'
)
equal(
  JSON.stringify(getCollectionStatus({ hasErrors: false, remainingCount: 3, hasActiveItems: false })),
  JSON.stringify({ label: 'status.queued', tone: 'neutral' }),
  'collection queued'
)

console.log('Status presentation mapping passed')
