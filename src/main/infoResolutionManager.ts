import * as downloadManager from './downloadManager'
import { resolveVideoInfo, type VideoInfoResolveResult } from './videoInfoResolver'
import { InfoResolutionScheduler } from './infoResolutionScheduler'

export interface InfoResolveEvent {
  id: string
  url: string
  autoStart: boolean
  format: string
  quality: string
  requestedTitle?: string
  data?: unknown
  error?: string
}

type ActiveResolve = {
  controller: AbortController
}

const MAX_CONCURRENT_RESOLVERS = 2
/** A resolver must never leave a task (and a hidden browser) running forever. */
export const INFO_RESOLVE_TIMEOUT_MS = 90_000
let scheduler: InfoResolutionScheduler | null = null
const active = new Map<string, ActiveResolve>()
const readyResults = new Map<string, InfoResolveEvent>()

function getTask(id: string): downloadManager.DownloadTask | undefined {
  return downloadManager.getAll().find((task) => task.id === id)
}

function isResolverTask(task: downloadManager.DownloadTask | undefined): boolean {
  return Boolean(task?.metadata?.infoResolve === true)
}

function autoStartForTask(task: downloadManager.DownloadTask): boolean {
  return task.metadata.resolveAutoStart === true
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function emitResult(task: downloadManager.DownloadTask, result: VideoInfoResolveResult): void {
  const event: InfoResolveEvent = {
    id: task.id,
    url: task.url,
    autoStart: autoStartForTask(task),
    format: task.format,
    quality: task.quality,
    ...(typeof task.metadata.resolveTitle === 'string' ? { requestedTitle: task.metadata.resolveTitle } : {}),
    ...(result.data !== undefined ? { data: result.data } : {}),
    ...(result.error ? { error: result.error } : {})
  }
  if (result.data !== undefined) readyResults.set(task.id, event)
  downloadManager.emitInfoResolveResult(event)
}

function failAndEmit(id: string, message: string): void {
  downloadManager.failInfoResolveTask(id, message)
  readyResults.delete(id)
  const failed = getTask(id)
  if (failed) emitResult(failed, { error: message })
}

async function resolveOne(id: string): Promise<void> {
  const task = getTask(id)
  if (!task || !isResolverTask(task) || task.status !== 'resolving') return

  const controller = new AbortController()
  active.set(id, { controller })
  let timedOut = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const resolution = resolveVideoInfo(task.url, controller.signal)
    const timeoutResult = new Promise<VideoInfoResolveResult>((_, reject) => {
      timeout = setTimeout(() => {
        timedOut = true
        controller.abort()
        reject(new Error(`Resolution timed out after ${Math.round(INFO_RESOLVE_TIMEOUT_MS / 1000)} seconds`))
      }, INFO_RESOLVE_TIMEOUT_MS)
    })
    const result = await Promise.race([resolution, timeoutResult])
    const current = getTask(id)
    if (controller.signal.aborted || !isResolverTask(current) || current?.status !== 'resolving') return

    if (result.data !== undefined) {
      const data = result.data as Record<string, unknown>
      downloadManager.markInfoResolveReady(id, {
        title: typeof data.title === 'string' ? data.title : undefined,
        thumbnail: typeof data.thumbnail === 'string' ? data.thumbnail : undefined,
        duration: typeof data.duration === 'number' ? data.duration : undefined,
        channel: typeof data.channel === 'string' ? data.channel : undefined
      })
      const ready = getTask(id)
      if (ready) emitResult(ready, result)
    } else {
      failAndEmit(id, result.error || 'Failed to fetch video info')
    }
  } catch (error) {
    const current = getTask(id)
    if (timedOut) {
      if (isResolverTask(current) && current?.status === 'resolving') {
        const message = `Resolution timed out after ${Math.round(INFO_RESOLVE_TIMEOUT_MS / 1000)} seconds`
        console.warn(`[info-resolve] ${id.slice(0, 8)} timed out; marking task retryable`)
        failAndEmit(id, message)
      }
      return
    }
    if (controller.signal.aborted || isAbortError(error) || !isResolverTask(current) || current?.status !== 'resolving') return
    const message = error instanceof Error ? error.message : String(error)
    failAndEmit(id, message)
  } finally {
    if (timeout) clearTimeout(timeout)
    if (active.get(id)?.controller === controller) active.delete(id)
  }
}

export function initializeInfoResolutionManager(): void {
  if (scheduler) return
  scheduler = new InfoResolutionScheduler(resolveOne, {
    maxConcurrent: MAX_CONCURRENT_RESOLVERS,
    onCancelActive: (id) => active.get(id)?.controller.abort()
  })
  downloadManager.setInfoResolveHooks({
    onCancel: cancelInfoResolve,
    onRetry: retryInfoResolve
  })
  resumePersistedInfoResolves()
}

export function enqueueInfoResolve(id: string): boolean {
  if (!scheduler) initializeInfoResolutionManager()
  const task = getTask(id)
  if (!task || !isResolverTask(task) || task.status !== 'resolving') return false
  return scheduler!.enqueue(id)
}

export function cancelInfoResolve(id: string): boolean {
  if (!scheduler) initializeInfoResolutionManager()
  const cancelled = scheduler!.cancel(id)
  readyResults.delete(id)
  const persisted = downloadManager.cancelInfoResolveTask(id)
  return cancelled || persisted
}

export function retryInfoResolve(id: string): boolean {
  if (!scheduler) initializeInfoResolutionManager()
  const task = getTask(id)
  if (!task || !isResolverTask(task)) return false
  readyResults.delete(id)
  if (task.status === 'error' || task.status === 'ready') {
    downloadManager.markInfoResolveResolving(id)
  }
  return scheduler!.retry(id) || scheduler!.enqueue(id)
}

export function resumePersistedInfoResolves(): void {
  if (!scheduler) return
  for (const task of downloadManager.getAll()) {
    if (!isResolverTask(task)) continue
    if (task.status === 'ready') downloadManager.markInfoResolveResolving(task.id)
    if (task.status === 'resolving' || task.status === 'ready') enqueueInfoResolve(task.id)
  }
}

export function getPendingInfoResolveResults(): InfoResolveEvent[] {
  return [...readyResults.values()].filter((event) => {
    const task = getTask(event.id)
    return Boolean(task && task.status === 'ready' && isResolverTask(task))
  })
}

export function markInfoResolveReadyFromRenderer(
  id: string,
  patch: { title?: string; thumbnail?: string | null; duration?: number | null; channel?: string | null }
): boolean {
  return Boolean(downloadManager.markInfoResolveReady(id, patch))
}

export function promoteInfoResolve(id: string, options: downloadManager.PromoteInfoResolveOptions): downloadManager.DownloadTask | null {
  const task = downloadManager.promoteInfoResolveTask(id, options)
  if (task) readyResults.delete(id)
  return task
}

export function getInfoResolveStats(): { maxConcurrent: number; active: number; queued: number } {
  return {
    maxConcurrent: MAX_CONCURRENT_RESOLVERS,
    active: scheduler?.activeCount ?? 0,
    queued: scheduler?.queuedCount ?? 0
  }
}
