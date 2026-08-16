import { ipcMain } from 'electron'
import * as downloadManager from '../downloadManager'
import * as ytdlp from '../ytdlp'
import * as infoResolutionManager from '../infoResolutionManager'
import { resolveVideoInfo } from '../videoInfoResolver'
import { listDouyinProfilePosts } from '../douyinProfile'
import { runDouyinBulkCli } from '../douyinBulk'
import { cancelDouyinBulkJob, getDouyinBulkJobStatus, startDouyinBulkJob } from '../douyinBulkJobs'
import * as settings from '../settings'
import { sniffMedia } from '../mediaSniffer'
import { fetchRemoteThumbnailDataUrl } from '../thumbnailFetch'
import { listPlaylistEntries } from '../playlistList'
import { resolveMediaCandidates, mediaTypeForCandidate } from '../mediaResolver'
import { LOCAL_SERVER_PORT } from '../localServer'
import { beginDouyinProfileExtensionRequest } from '../douyinProfileExtension'
import { openUrlInConfiguredBrowser } from '../openUrlInBrowser'

const profileListAbortControllers = new Map<string, AbortController>()

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 8192) return false
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function isDouyinUrl(value: unknown): value is string {
  if (!isHttpUrl(value)) return false
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === 'douyin.com' || host.endsWith('.douyin.com') || host === 'iesdouyin.com' || host.endsWith('.iesdouyin.com')
  } catch {
    return false
  }
}

export function registerDownloadHandlers(): void {
  ipcMain.handle('get-video-info', async (_event, url: string) => resolveVideoInfo(url))

  ipcMain.handle('start-info-resolve', async (_event, options: {
    url: string
    title?: string
    format?: string
    quality?: string
    metadata?: Record<string, unknown>
    referer?: string
    customHeaders?: Record<string, string>
  }) => {
    try {
      if (!options || typeof options.url !== 'string' || !ytdlp.isValidDownloadUrl(options.url)) {
        return { error: 'Invalid URL' }
      }
      const task = downloadManager.createInfoResolveTask(options)
      infoResolutionManager.enqueueInfoResolve(task.id)
      return { data: task }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('get-info-resolve-results', async () => ({ data: infoResolutionManager.getPendingInfoResolveResults() }))

  ipcMain.handle('promote-info-resolve', async (_event, payload: {
    id: string
    url?: string
    title?: string
    format: string
    quality?: string
    thumbnail?: string
    duration?: number
    metadata?: Record<string, unknown>
    mediaType?: string
    referer?: string
    customHeaders?: Record<string, string>
  }) => {
    try {
      if (!payload || typeof payload.id !== 'string' || typeof payload.format !== 'string') {
        return { error: 'Invalid resolver task' }
      }
      if (payload.url !== undefined && !ytdlp.isValidDownloadUrl(payload.url)) {
        return { error: 'Invalid URL' }
      }
      const task = infoResolutionManager.promoteInfoResolve(payload.id, payload)
      return task ? { data: task } : { error: 'Resolver task is no longer available' }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('mark-info-resolve-ready', async (_event, payload: {
    id: string
    title?: string
    thumbnail?: string | null
    duration?: number | null
  }) => {
    const ok = Boolean(payload && typeof payload.id === 'string' && infoResolutionManager.markInfoResolveReadyFromRenderer(payload.id, payload))
    return ok ? { ok: true } : { ok: false, error: 'Resolver task is no longer available' }
  })

  ipcMain.handle('get-entry-thumbnail', async (_event, pageUrl: string) => {
    try {
      if (!isHttpUrl(pageUrl) || !ytdlp.isValidDownloadUrl(pageUrl)) {
        return { error: 'Invalid URL' }
      }
      const cookiesPath = settings.getCookiesPath()
      const ytdlpPath = settings.get('ytdlpPath')
      const data = await ytdlp.fetchThumbnailForPageUrl(pageUrl, cookiesPath || undefined, ytdlpPath)
      if (!data) return { error: 'No thumbnail' }
      return { data }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('list-playlist-entries', async (_event, url: string) => {
    try {
      if (typeof url !== 'string' || !ytdlp.isValidDownloadUrl(url)) {
        return { error: 'Invalid URL' }
      }
      const cookiesPath = settings.getCookiesPath()
      const ytdlpPath = settings.get('ytdlpPath')
      const data = await listPlaylistEntries(url, cookiesPath || undefined, ytdlpPath)
      return { data }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    'fetch-thumbnail-data-url',
    async (_event, url: string, referer?: string) => {
      try {
        if (!isHttpUrl(url)) return { error: 'Invalid thumbnail URL' }
        if (referer !== undefined && !isHttpUrl(referer)) return { error: 'Invalid thumbnail referer' }
        const data = await fetchRemoteThumbnailDataUrl(url, referer)
        if (!data) return { error: 'Thumbnail fetch failed' }
        return { data }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle('start-download', async (_event, options: {
    url: string
    title: string
    format: string
    quality?: string
    outputDir?: string
    thumbnail?: string
    duration?: number
    metadata?: Record<string, unknown>
    playlistId?: string
    playlistIndex?: number
    isPlaylist?: boolean
    playlistTitle?: string
    mediaType?: string
    referer?: string
    customHeaders?: Record<string, string>
    candidates?: Array<Record<string, unknown>>
  }) => {
    try {
      if (!options || typeof options.url !== 'string' || !ytdlp.isValidDownloadUrl(options.url)) {
        return { error: 'Invalid URL' }
      }
      const candidates = resolveMediaCandidates((options.candidates || []).filter((c) => typeof c?.url === 'string') as Array<{ url: string } & Record<string, unknown>>)
      const selected = candidates[0]
      const task = downloadManager.addTask({ ...options, mediaType: options.mediaType || (selected ? mediaTypeForCandidate(selected) : undefined), metadata: { ...(options.metadata || {}), ...(selected ? { candidate: { url: selected.url, formatId: selected.formatId, container: selected.container, protocol: selected.protocol, mimeType: selected.mimeType } } : {}) } })
      return { data: task }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    'douyin-profile-list-posts',
    async (
      _event,
      payload: {
        profileUrl: string
        cursor?: string | null
        limit?: number
        firstPageMode?: 'merged' | 'api_quick' | 'html_only'
        existingAwemeIds?: string[]
        abortKey?: string
        browserRecovery?: boolean
      }
    ) => {
      const abortKey = payload?.abortKey?.trim()
      let ac: AbortController | undefined
      if (abortKey) {
        profileListAbortControllers.get(abortKey)?.abort()
        ac = new AbortController()
        profileListAbortControllers.set(abortKey, ac)
      }
      try {
        const cookiesPath = settings.getCookiesPath()

        if (payload?.browserRecovery === true) {
          const extensionRequest = beginDouyinProfileExtensionRequest({
            profileUrl: String(payload?.profileUrl ?? '').trim(),
            existingAwemeIds: payload?.existingAwemeIds,
          })
          const bridgeUrl = `http://127.0.0.1:${LOCAL_SERVER_PORT}/douyin-profile-import-landing?requestId=${encodeURIComponent(extensionRequest.requestId)}`

          const opened = await openUrlInConfiguredBrowser(bridgeUrl)
          if (!opened.ok) {
            extensionRequest.cancel()
            return {
              data: {
                ok: false,
                code: 'BROWSER_REQUIRED',
                message: `Could not open the configured browser: ${opened.error ?? 'unknown error'}`,
              },
            }
          }

          const onAbort = () => extensionRequest.cancel()
          if (ac) {
            if (ac.signal.aborted) extensionRequest.cancel()
            else ac.signal.addEventListener('abort', onAbort, { once: true })
          }
          try {
            return { data: await extensionRequest.promise }
          } finally {
            ac?.signal.removeEventListener('abort', onAbort)
          }
        }

        const result = await listDouyinProfilePosts({
          profileUrl: String(payload?.profileUrl ?? '').trim(),
          cursor: payload?.cursor ?? null,
          limit: payload?.limit,
          cookiesFilePath: cookiesPath || undefined,
          firstPageMode: payload?.firstPageMode,
          existingAwemeIds: payload?.existingAwemeIds,
          browserRecovery: false,
          signal: ac?.signal,
        })
        return { data: result }
      } catch (err) {
        return {
          data: {
            ok: false,
            code: 'TIMEOUT',
            message: err instanceof Error ? err.message : String(err),
          },
        }
      } finally {
        if (abortKey) profileListAbortControllers.delete(abortKey)
      }
    }
  )

  ipcMain.handle('douyin-profile-list-posts-abort', (_event, abortKey: string) => {
    const key = String(abortKey ?? '').trim()
    if (!key) return { ok: false }
    profileListAbortControllers.get(key)?.abort()
    profileListAbortControllers.delete(key)
    return { ok: true }
  })

  ipcMain.handle(
    'start-downloads-bulk',
    async (
      _event,
      tasks: Array<{
        url: string
        title: string
        format?: string
        quality?: string
        thumbnail?: string
        duration?: number
        metadata?: Record<string, unknown>
        playlistId?: string
        playlistIndex?: number
        playlistTitle?: string
      }>
    ) => {
      try {
        if (!Array.isArray(tasks) || tasks.length === 0) {
          return { error: 'No tasks' }
        }
        const defaultQ = settings.get('defaultVideoQuality')
        const normalized = tasks
          .map((t) => {
            const url = String(t?.url ?? '').trim()
            if (!url || !ytdlp.isValidDownloadUrl(url)) return null
            return {
              url,
              title: (t.title && t.title.trim()) || 'Download',
              format: t.format ?? 'mp4',
              quality: t.quality ?? defaultQ,
              thumbnail: t.thumbnail,
              duration: t.duration,
              playlistId: t.playlistId,
              playlistIndex: t.playlistIndex,
              playlistTitle: t.playlistTitle,
              metadata: {
                ...t.metadata,
                channel: String(t.metadata?.channel ?? ''),
                ...(t.playlistTitle ? { playlistTitle: t.playlistTitle } : {}),
              },
            }
          })
          .filter(Boolean) as Parameters<typeof downloadManager.addTasksBulk>[0]

        if (normalized.length === 0) {
          return { error: 'No tasks' }
        }

        const { count, ids } = downloadManager.addTasksBulk(normalized)
        return { data: { count, ids } }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { error: msg }
      }
    }
  )

  ipcMain.handle('cancel-download', async (_event, id: string) => {
    const cancelled = downloadManager.cancelTask(id)
    return { cancelled }
  })

  ipcMain.handle('pause-download', async (_event, id: string) => {
    const paused = downloadManager.pauseTask(id)
    return { paused }
  })

  ipcMain.handle('retry-download', async (_event, id: string) => {
    const retried = downloadManager.retryTask(id)
    return { retried }
  })

  ipcMain.handle('delete-task', async (_event, id: string) => {
    downloadManager.deleteTask(id)
    return { ok: true }
  })

  ipcMain.handle('delete-task-with-files', async (_event, id: string) => {
    await downloadManager.deleteTaskWithFiles(id)
    return { ok: true }
  })

  ipcMain.handle('delete-tasks-with-files', async (_event, ids: string[]) => {
    const result = await downloadManager.deleteTasksWithFiles(ids)
    return { ok: true, ...result }
  })

  ipcMain.handle('delete-tasks', async (_event, ids: string[]) => {
    const result = await downloadManager.deleteTasks(ids)
    return { ok: true, ...result }
  })

  ipcMain.handle('get-downloads', async () => {
    const tasks = downloadManager.getAll()
    return { data: tasks }
  })

  ipcMain.handle('resume-all', async () => {
    downloadManager.resumeAll()
    return { ok: true }
  })

  ipcMain.handle('pause-all', async () => {
    downloadManager.pauseAll()
    return { ok: true }
  })

  ipcMain.handle('clear-downloads', async (_event, mode: string) => {
    if (mode === 'all') {
      downloadManager.clearAll()
    } else {
      downloadManager.clearCompleted()
    }
    return { ok: true }
  })

  ipcMain.handle('sniff-media', async (_event, url: string) => {
    try {
      if (!isHttpUrl(url)) return { error: 'Invalid URL' }
      const media = await sniffMedia(url)
      return { data: { ...media, candidates: media.media.map((item) => item.candidate).filter(Boolean) } }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('start-douyin-bulk', async (_event, url: string) => {
    try {
      if (!isDouyinUrl(url)) return { error: 'Invalid Douyin URL' }
      return { data: startDouyinBulkJob(url) }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('get-douyin-bulk-status', async (_event, id: string) => {
    try {
      const job = getDouyinBulkJobStatus(id)
      if (!job) {
        return { error: 'Bulk job not found' }
      }
      return { data: job }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('cancel-douyin-bulk', async (_event, id: string) => {
    try {
      return { ok: cancelDouyinBulkJob(id) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('run-douyin-bulk', async (_event, url: string) => {
    try {
      if (!isDouyinUrl(url)) return { error: 'Invalid Douyin URL' }
      const { promise } = runDouyinBulkCli({ url: String(url || '').trim() })
      const result = await promise
      return { data: result }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
}
