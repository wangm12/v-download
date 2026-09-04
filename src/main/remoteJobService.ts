import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import * as downloadManager from './downloadManager'
import * as settings from './settings'
import * as db from './database'
import { listPlaylistEntries } from './playlistList'
import {
  JOB_ID_PATTERN,
  MAX_ATTEMPTS,
  classifyFailureMessage,
  classifyInputUrl,
  collectionTooLarge,
  listJobArtifacts,
  parseStoredError,
  shouldRetryError,
  type Artifact,
  type JobError,
  type JobRecord,
} from './apiJobsModel'
import {
  canContinueRemoteJob,
  collectOwnedPaths,
  deriveJobRecord,
  emptyPlaylistError,
  remoteJobOutputDir,
  siblingTaskIds,
  type StoredRemoteJob,
} from './remoteJobModel'
import type { RemoteJobBackend } from './remoteApiHandler'
import { resolveVideoInfo } from './videoInfoResolver'
import { isResolvePlaylist, taskOptionsFromResolveData } from './remoteResolveTask'

export const MAX_COLLECTION_ITEMS = 50
export type { StoredRemoteJob }

let storePath = ''
let cache: Record<string, StoredRemoteJob> | null = null
let listenerAttached = false

export function configureRemoteJobStore(path: string): void {
  storePath = path
  cache = null
}

function getStorePath(): string {
  if (!storePath) throw new Error('Remote job store path is not configured')
  return storePath
}

function loadStore(): Record<string, StoredRemoteJob> {
  if (cache) return cache
  try {
    const parsed = JSON.parse(readFileSync(getStorePath(), 'utf-8')) as Record<string, StoredRemoteJob>
    cache = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    cache = {}
  }
  return cache
}

function saveStore(): void {
  const path = getStorePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(cache ?? {}, null, 2), { encoding: 'utf-8', mode: 0o600 })
}

function nowIso(): string {
  return new Date().toISOString()
}

function newJobId(): string {
  let id = randomBytes(8).toString('hex')
  while (!JOB_ID_PATTERN.test(id) || loadStore()[id]) {
    id = randomBytes(8).toString('hex')
  }
  return id
}

function putJob(job: StoredRemoteJob): void {
  loadStore()[job.id] = job
  saveStore()
}

function readJob(id: string): StoredRemoteJob | null {
  return loadStore()[id] ?? null
}

function ensureOutputDir(job: StoredRemoteJob): string {
  const outputDir = job.outputDir || remoteJobOutputDir(settings.get('downloadDir'), job.id)
  if (!job.outputDir) job.outputDir = outputDir
  mkdirSync(outputDir, { recursive: true })
  return outputDir
}

function remoteTaskMeta(
  job: StoredRemoteJob,
  extra?: Record<string, unknown>,
  options?: { includeNote?: boolean },
): Record<string, unknown> {
  return {
    ...(extra ?? {}),
    remoteJobId: job.id,
    remoteOutputDir: ensureOutputDir(job),
    ...(options?.includeNote !== false && job.includeNote === true ? { includeNote: true } : {}),
  }
}

function ownedPathsForJob(job: StoredRemoteJob): string[] {
  const records = db.getDownloads()
  const ids = new Set(job.downloadTaskIds)
  return collectOwnedPaths({
    downloadDir: settings.get('downloadDir'),
    jobOutputDir: job.outputDir || remoteJobOutputDir(settings.get('downloadDir'), job.id),
    taskPaths: records.filter((row) => ids.has(row.id)).map((row) => row.file_path),
  })
}

function artifactsFromOwnedPaths(paths: string[]): Artifact[] {
  const out: Artifact[] = []
  const seen = new Set<string>()
  for (const owned of paths) {
    if (!owned || !existsSync(owned)) continue
    const st = statSync(owned)
    if (st.isFile()) {
      if (seen.has(owned)) continue
      seen.add(owned)
      out.push({ name: basename(owned), sizeBytes: st.size })
      continue
    }
    if (!st.isDirectory()) continue
    for (const artifact of listJobArtifacts(owned)) {
      const key = `${owned}:${artifact.name}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(artifact)
    }
  }
  return out
}

async function enqueueJob(jobId: string): Promise<void> {
  const job = readJob(jobId)
  if (!canContinueRemoteJob(job)) return

  const quality = settings.get('defaultVideoQuality')
  const input = classifyInputUrl(job.url)
  try {
    if (input === 'collection') {
      if (settings.get('youtubePlaylistMode') === 'fanout') {
        const listed = await listPlaylistEntries(job.url, settings.getCookiesPath() || undefined, settings.get('ytdlpPath') || undefined)
        const latest = readJob(jobId)
        if (!canContinueRemoteJob(latest)) return
        if (listed.items.length === 0) {
          latest.error = emptyPlaylistError()
          latest.updatedAt = nowIso()
          putJob(latest)
          return
        }
        if (listed.items.length > MAX_COLLECTION_ITEMS) {
          latest.error = collectionTooLarge(listed.items.length, MAX_COLLECTION_ITEMS)
          latest.updatedAt = nowIso()
          putJob(latest)
          return
        }
        const ids: string[] = []
        for (const [index, item] of listed.items.entries()) {
          const current = readJob(jobId)
          if (!canContinueRemoteJob(current)) {
            for (const id of ids) downloadManager.cancelTask(id)
            return
          }
          const task = downloadManager.addTask({
            url: item.pageUrl,
            title: item.title || `Item ${index + 1}`,
            format: 'video',
            quality,
            thumbnail: item.thumbnail,
            duration: item.duration || undefined,
            playlistId: current.id,
            playlistIndex: item.playlistIndex ?? index + 1,
            playlistTitle: listed.playlistTitle,
            forceNew: true,
            metadata: remoteTaskMeta(current, { playlistTitle: listed.playlistTitle }, { includeNote: false }),
          })
          ids.push(task.id)
          current.downloadTaskIds = [...ids]
          current.title = listed.playlistTitle || current.title
          current.updatedAt = nowIso()
          putJob(current)
        }
        return
      }

      const current = readJob(jobId)
      if (!canContinueRemoteJob(current)) return
      const task = downloadManager.addTask({
        url: current.url,
        title: current.title || 'Playlist',
        format: 'video',
        quality,
        playlistId: current.id,
        forceNew: true,
        metadata: remoteTaskMeta(current, { nativeYoutubePlaylist: true }),
      })
      current.downloadTaskIds = [task.id]
      current.updatedAt = nowIso()
      putJob(current)
      return
    }

    const current = readJob(jobId)
    if (!canContinueRemoteJob(current)) return
    const resolved = await resolveVideoInfo(current.url)
    const latest = readJob(jobId)
    if (!canContinueRemoteJob(latest)) return
    if (resolved.error) {
      latest.error = classifyFailureMessage(resolved.error)
      latest.updatedAt = nowIso()
      putJob(latest)
      return
    }
    if (isResolvePlaylist(resolved.data)) {
      const task = downloadManager.addTask({
        url: latest.url,
        title: latest.title || 'download',
        format: 'video',
        quality,
        forceNew: true,
        metadata: remoteTaskMeta(latest),
      })
      latest.downloadTaskIds = [task.id]
      latest.updatedAt = nowIso()
      putJob(latest)
      return
    }
    const fields = taskOptionsFromResolveData(resolved.data, latest.url)
    if (fields.metadata.noteOnly === true && latest.includeNote !== true) {
      latest.error = { code: 'no_media', message: 'This post has no video or images to download' }
      latest.updatedAt = nowIso()
      putJob(latest)
      return
    }
    const task = downloadManager.addTask({
      url: latest.url,
      title: fields.title,
      format: fields.format,
      quality,
      thumbnail: fields.thumbnail,
      duration: fields.duration,
      forceNew: true,
      metadata: remoteTaskMeta(latest, fields.metadata),
    })
    latest.downloadTaskIds = [task.id]
    latest.title = fields.title
    latest.updatedAt = nowIso()
    putJob(latest)
  } catch (err) {
    const latest = readJob(jobId)
    if (!latest || latest.cancelled) return
    latest.error = classifyFailureMessage(err instanceof Error ? err.message : String(err))
    latest.updatedAt = nowIso()
    putJob(latest)
  }
}

function onDownloadTask(task: { id: string; status: string; error?: string | null; title?: string }): void {
  const jobs = Object.values(loadStore())
  const job = jobs.find((row) => row.downloadTaskIds.includes(task.id))
  if (!job || job.cancelled || job.error) return
  const previous = job.lastTaskStatus[task.id]
  job.lastTaskStatus[task.id] = task.status
  if (task.title && !job.title) job.title = task.title
  job.updatedAt = nowIso()

  if (task.status === 'error' && previous !== 'error') {
    const nextAttempt = (job.attempts[task.id] ?? 0) + 1
    job.attempts[task.id] = nextAttempt
    const classified = classifyFailureMessage(task.error || 'Download failed')
    if (nextAttempt < MAX_ATTEMPTS && shouldRetryError(classified.code)) {
      putJob(job)
      downloadManager.retryTask(task.id)
      return
    }
    job.error = job.downloadTaskIds.length > 1
      ? { code: 'collection_item_failed', message: classified.message, details: { id: task.id, attempts: nextAttempt } }
      : classified
    putJob(job)
    if (job.downloadTaskIds.length > 1) {
      for (const siblingId of siblingTaskIds(job.downloadTaskIds, task.id)) {
        downloadManager.cancelTask(siblingId)
      }
    }
    return
  }
  putJob(job)
}

export function attachRemoteJobListener(): void {
  if (listenerAttached) return
  listenerAttached = true
  downloadManager.addDownloadListener((task) => {
    onDownloadTask(task)
  })
}

export function createRemoteJob(
  url: string,
  options?: { includeNote?: boolean },
): { id: string; status: string; url: string } {
  const id = newJobId()
  const outputDir = remoteJobOutputDir(settings.get('downloadDir'), id)
  mkdirSync(outputDir, { recursive: true })
  const job: StoredRemoteJob = {
    id,
    url,
    title: null,
    error: null,
    downloadTaskIds: [],
    outputDir,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    cancelled: false,
    attempts: {},
    lastTaskStatus: {},
    ...(options?.includeNote === true ? { includeNote: true } : {}),
  }
  putJob(job)
  void enqueueJob(job.id)
  return { id, status: 'queued', url }
}

export function getStoredJob(id: string): StoredRemoteJob | null {
  return readJob(id)
}

export function getJobRecord(id: string): JobRecord | null {
  const job = getStoredJob(id)
  if (!job) return null
  const records = db.getDownloads().filter((row) => job.downloadTaskIds.includes(row.id))
  return deriveJobRecord(job, records)
}

export function artifactsForJob(id: string): Artifact[] {
  const job = getStoredJob(id)
  if (!job) return []
  return artifactsFromOwnedPaths(ownedPathsForJob(job))
}

export function ownedPathsForStoredJob(id: string): string[] {
  const job = getStoredJob(id)
  return job ? ownedPathsForJob(job) : []
}

export function cancelRemoteJob(id: string): 'ok' | 'not_found' | 'not_cancellable' {
  const job = getStoredJob(id)
  if (!job) return 'not_found'
  const current = deriveJobRecord(
    job,
    db.getDownloads().filter((row) => job.downloadTaskIds.includes(row.id)),
  )
  if (current.status === 'complete' || current.status === 'error' || current.status === 'cancelled') {
    return 'not_cancellable'
  }
  job.cancelled = true
  job.updatedAt = nowIso()
  putJob(job)
  for (const taskId of job.downloadTaskIds) {
    downloadManager.cancelTask(taskId)
  }
  return 'ok'
}

export function listJobRecords(): JobRecord[] {
  return Object.values(loadStore())
    .map((job) => {
      const records = db.getDownloads().filter((row) => job.downloadTaskIds.includes(row.id))
      return deriveJobRecord(job, records)
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function createElectronRemoteJobBackend(): RemoteJobBackend {
  return {
    getToken: () => settings.get('remoteApiToken'),
    createJob: createRemoteJob,
    getJob: getJobRecord,
    listJobs: listJobRecords,
    artifactsFor: artifactsForJob,
    ownedPathsFor: ownedPathsForStoredJob,
    cancelJob: cancelRemoteJob,
    allowMcpWrite: () => settings.get('remoteApiMcpAllowWrite'),
    requireMcpConfirm: () => settings.get('remoteApiMcpRequireConfirm'),
  }
}

export function parseStoredJobError(raw: JobError | string | null): JobError | null {
  return parseStoredError(raw)
}
