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

equal(getStatusLabel('complete'), 'Complete', 'complete label')
equal(getStatusLabel('downloading'), 'Downloading', 'downloading label')
equal(getStatusLabel('resolving'), 'Resolving…', 'resolving label')
equal(getStatusLabel('ready'), 'Ready to download', 'ready label')
equal(getStatusLabel('queued'), 'Queued', 'queued label')
equal(getStatusLabel('paused'), 'Paused', 'paused label')
equal(getStatusLabel('error'), 'Failed', 'error label')
equal(getStatusLabel('interrupted'), 'Interrupted', 'interrupted label')
equal(getStatusLabel('cancelled'), 'Cancelled', 'cancelled label')

equal(
  JSON.stringify(getCollectionStatus({ hasErrors: true, remainingCount: 2, hasActiveItems: true })),
  JSON.stringify({ label: 'Needs attention', tone: 'warning' }),
  'collection with errors'
)
equal(
  JSON.stringify(getCollectionStatus({ hasErrors: false, remainingCount: 0, hasActiveItems: false })),
  JSON.stringify({ label: 'Complete', tone: 'success' }),
  'collection complete'
)
equal(
  JSON.stringify(getCollectionStatus({ hasErrors: false, remainingCount: 3, hasActiveItems: true })),
  JSON.stringify({ label: 'In progress', tone: 'accent' }),
  'collection in progress'
)
equal(
  JSON.stringify(getCollectionStatus({ hasErrors: false, remainingCount: 3, hasActiveItems: false })),
  JSON.stringify({ label: 'Queued', tone: 'neutral' }),
  'collection queued'
)

console.log('Status presentation mapping passed')
