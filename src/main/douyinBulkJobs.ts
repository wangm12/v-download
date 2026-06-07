import { randomUUID } from 'crypto'
import { runDouyinBulkCli } from './douyinBulk'

export type DouyinBulkJobState = 'running' | 'completed' | 'failed' | 'cancelled'

export interface DouyinBulkJobStatus {
  id: string
  state: DouyinBulkJobState
  startedAt: string
  endedAt?: string
  stderrTail: string
}

interface DouyinBulkJob extends DouyinBulkJobStatus {
  cancel: () => void
}

const STDERR_TAIL_LIMIT = 4000
const jobs = new Map<string, DouyinBulkJob>()

function tailStderr(stderr: string): string {
  return stderr.slice(-STDERR_TAIL_LIMIT)
}

export function startDouyinBulkJob(rawUrl: string): { id: string } {
  const url = String(rawUrl || '').trim()
  if (!url) {
    throw new Error('Douyin bulk URL is required')
  }

  const id = randomUUID()
  const startedAt = new Date().toISOString()
  const { promise, cancel } = runDouyinBulkCli({ url })

  jobs.set(id, {
    id,
    state: 'running',
    startedAt,
    stderrTail: '',
    cancel
  })

  promise
    .then(({ code, stderr }) => {
      const job = jobs.get(id)
      if (!job) return
      job.stderrTail = tailStderr(stderr)
      if (!job.endedAt) {
        job.endedAt = new Date().toISOString()
      }
      if (job.state !== 'cancelled') {
        job.state = code === 0 ? 'completed' : 'failed'
      }
    })
    .catch((error) => {
      const job = jobs.get(id)
      if (!job) return
      job.stderrTail = tailStderr(error instanceof Error ? error.message : String(error))
      if (!job.endedAt) {
        job.endedAt = new Date().toISOString()
      }
      if (job.state !== 'cancelled') {
        job.state = 'failed'
      }
    })

  return { id }
}

export function getDouyinBulkJobStatus(id: string): DouyinBulkJobStatus | null {
  const job = jobs.get(String(id || '').trim())
  if (!job) return null
  return {
    id: job.id,
    state: job.state,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    stderrTail: job.stderrTail
  }
}

export function cancelDouyinBulkJob(id: string): boolean {
  const job = jobs.get(String(id || '').trim())
  if (!job || job.state !== 'running') {
    return false
  }

  job.state = 'cancelled'
  job.endedAt = new Date().toISOString()
  try {
    job.cancel()
  } catch {
    // ignore cancellation errors; state is already updated to cancelled
  }
  return true
}
