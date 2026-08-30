import { existsSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { classifyFailureMessage, type JobError, type JobRecord } from './apiJobsModel'

export const REMOTE_JOB_DIR_NAME = 'remote-jobs'

export interface StoredRemoteJob {
  id: string
  url: string
  title: string | null
  error: JobError | string | null
  downloadTaskIds: string[]
  outputDir: string
  createdAt: string
  updatedAt: string
  cancelled: boolean
  attempts: Record<string, number>
  lastTaskStatus: Record<string, string>
}

export interface JobTaskSnapshot {
  id: string
  status: string
  progress: number
  title?: string | null
  error?: string | null
  file_path?: string | null
}

export function remoteJobOutputDir(downloadDir: string, jobId: string): string {
  return join(downloadDir, REMOTE_JOB_DIR_NAME, jobId)
}

export function isPathInside(parent: string, child: string): boolean {
  const root = resolve(parent)
  const target = resolve(child)
  if (target === root) return true
  const prefix = root.endsWith(sep) ? root : root + sep
  return target.startsWith(prefix)
}

export function emptyPlaylistError(): JobError {
  return { code: 'empty_output', message: 'Playlist has no downloadable items' }
}

export function canContinueRemoteJob(job: StoredRemoteJob | null | undefined): job is StoredRemoteJob {
  return Boolean(job && !job.cancelled && !job.error)
}

export function siblingTaskIds(taskIds: string[], failedId: string): string[] {
  return taskIds.filter((id) => id !== failedId)
}

/**
 * Only files/dirs under this job's output folder are owned.
 * The library root is never owned, even if a task's file_path points at it.
 */
export function collectOwnedPaths(options: {
  downloadDir: string
  jobOutputDir: string
  taskPaths?: Array<string | null | undefined>
}): string[] {
  if (!options.downloadDir.trim() || !options.jobOutputDir.trim()) return []
  const downloadDir = resolve(options.downloadDir)
  const jobsRoot = resolve(join(downloadDir, REMOTE_JOB_DIR_NAME))
  const jobDir = resolve(options.jobOutputDir)
  if (jobDir === downloadDir || jobDir === jobsRoot || !isPathInside(jobsRoot, jobDir)) {
    return []
  }

  if (existsSync(jobDir) && statSync(jobDir).isDirectory()) {
    return [jobDir]
  }

  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of options.taskPaths ?? []) {
    if (!raw) continue
    const path = resolve(raw)
    if (path === downloadDir || !isPathInside(jobDir, path)) continue
    if (!existsSync(path)) continue
    if (!seen.has(path)) {
      seen.add(path)
      out.push(path)
    }
  }
  return out
}

export function deriveJobRecord(job: StoredRemoteJob, records: JobTaskSnapshot[]): JobRecord {
  let status = job.cancelled ? 'cancelled' : 'queued'
  let progress = 0
  let title = job.title
  let error: JobError | string | null = job.error

  if (job.cancelled) {
    status = 'cancelled'
  } else if (job.error) {
    status = 'error'
  } else if (records.length === 0) {
    status = 'queued'
  } else {
    const statuses = records.map((row) => row.status)
    title = records.find((row) => row.title)?.title ?? job.title
    progress = Math.round(records.reduce((sum, row) => sum + (Number(row.progress) || 0), 0) / records.length)
    if (statuses.some((s) => s === 'error')) {
      status = 'error'
      const failed = records.find((row) => row.status === 'error')
      error = failed?.error
        ? classifyFailureMessage(failed.error)
        : { code: 'download_failed', message: 'Download failed' }
      if (records.length > 1) {
        error = {
          code: 'collection_item_failed',
          message: failed?.error || 'A collection item failed',
          details: { id: failed?.id },
        }
      }
    } else if (statuses.some((s) => s === 'cancelled') && statuses.every((s) => s === 'cancelled' || s === 'complete' || s === 'error')) {
      status = 'cancelled'
    } else if (statuses.every((s) => s === 'complete')) {
      status = 'complete'
      progress = 100
    } else if (statuses.some((s) => s === 'downloading' || s === 'resolving')) {
      status = 'downloading'
    } else {
      status = 'queued'
    }
  }

  return {
    id: job.id,
    url: job.url,
    title,
    status,
    progress,
    error,
    updatedAt: job.updatedAt,
  }
}
