import { ipcMain } from 'electron'
import * as downloadManager from '../downloadManager'
import * as ytdlp from '../ytdlp'
import { getDouyinInfo, getLastDouyinInfoError, isDouyinGallery } from '../douyin'
import {
  getXiaohongshuInfo,
  getLastXhsInfoError,
  isXiaohongshuGallery,
  isXiaohongshuUrl,
} from '../xiaohongshu'
import { listDouyinProfilePosts } from '../douyinProfile'
import { runDouyinBulkCli } from '../douyinBulk'
import { cancelDouyinBulkJob, getDouyinBulkJobStatus, startDouyinBulkJob } from '../douyinBulkJobs'
import * as settings from '../settings'
import { sniffMedia } from '../mediaSniffer'
import { fetchRemoteThumbnailDataUrl } from '../thumbnailFetch'
import { listPlaylistEntries } from '../playlistList'
import { resolveMediaCandidates, protocolFor, mediaTypeForCandidate } from '../mediaResolver'

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
  ipcMain.handle('get-video-info', async (_event, url: string) => {
    try {
      if (typeof url !== 'string' || !ytdlp.isValidDownloadUrl(url)) {
        return { error: 'Invalid URL' }
      }
      const cookiesPath = settings.getCookiesPath()
      const ytdlpPath = settings.get('ytdlpPath')
      const isDouyinUrl = /douyin\.com/i.test(url)
      const isXhsUrl = isXiaohongshuUrl(url)

      if (ytdlp.isMediaUrl(url)) {
        const candidate = resolveMediaCandidates([{ url, type: protocolFor(url), pageUrl: url, source: 'extension' }])[0]
        return { data: { id: url, title: 'Direct media', thumbnail: '', duration: 0, channel: '', view_count: 0, formats: candidate ? [candidate] : [], candidates: candidate ? [candidate] : [], webpage_url: url, _type: 'video' } }
      }

      const toDouyinData = (douyin: NonNullable<Awaited<ReturnType<typeof getDouyinInfo>>>) => {
        if (isDouyinGallery(douyin)) {
          return {
            id: douyin.id,
            title: douyin.title,
            thumbnail: ytdlp.normalizeThumbnailUrl(douyin.cover),
            duration: 0,
            channel: douyin.author,
            view_count: 0,
            formats: [],
            webpage_url: url,
            _type: 'douyin_gallery',
            image_urls: douyin.imageUrls
          }
        }
        return {
          id: douyin.id,
          title: douyin.title,
          thumbnail: ytdlp.normalizeThumbnailUrl(douyin.cover),
          duration: douyin.duration,
          channel: douyin.author,
          view_count: 0,
          formats: [],
          webpage_url: url,
          _type: 'video'
        }
      }

      const toXhsData = (xhs: NonNullable<Awaited<ReturnType<typeof getXiaohongshuInfo>>>) => ({
        id: xhs.id,
        title: xhs.title,
        thumbnail: ytdlp.normalizeThumbnailUrl(xhs.cover),
        duration: 0,
        channel: xhs.author,
        view_count: 0,
        formats: [],
        webpage_url: url,
        _type: 'xhs_gallery',
        image_urls: xhs.imageUrls,
      })

      let douyinHint: Awaited<ReturnType<typeof getDouyinInfo>> = null
      if (isDouyinUrl) {
        douyinHint = await getDouyinInfo(url, cookiesPath || undefined)
        // Gallery must bypass yt-dlp format-info path; UI should treat it as image set.
        if (isDouyinGallery(douyinHint)) {
          return { data: toDouyinData(douyinHint) }
        }
      }

      let xhsHint: Awaited<ReturnType<typeof getXiaohongshuInfo>> = null
      if (isXhsUrl) {
        xhsHint = await getXiaohongshuInfo(url, cookiesPath || undefined)
        if (isXiaohongshuGallery(xhsHint)) {
          return { data: toXhsData(xhsHint) }
        }
      }

      try {
        const info = await ytdlp.getVideoInfo(url, cookiesPath || undefined, ytdlpPath)
        return { data: info }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (isDouyinUrl) {
          const douyin = douyinHint ?? await getDouyinInfo(url, cookiesPath || undefined)
          if (douyin) {
            return { data: toDouyinData(douyin) }
          }
          const hint = getLastDouyinInfoError()
          if (hint) {
            return { error: `${msg} | ${hint}` }
          }
        }
        if (isXhsUrl) {
          const xhs = xhsHint ?? (await getXiaohongshuInfo(url, cookiesPath || undefined))
          if (xhs && isXiaohongshuGallery(xhs)) {
            return { data: toXhsData(xhs) }
          }
          const hint = getLastXhsInfoError()
          if (hint) {
            return { error: `${msg} | ${hint}` }
          }
        }
        return { error: msg }
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
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
        const result = await listDouyinProfilePosts({
          profileUrl: String(payload?.profileUrl ?? '').trim(),
          cursor: payload?.cursor ?? null,
          limit: payload?.limit,
          cookiesFilePath: cookiesPath || undefined,
          firstPageMode: payload?.firstPageMode,
          existingAwemeIds: payload?.existingAwemeIds,
          browserRecovery: payload?.browserRecovery === true,
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
