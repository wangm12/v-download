import { v4 as uuidv4 } from 'uuid'
import { BrowserWindow } from 'electron'
import type { ChildProcess } from 'child_process'
import * as db from './database'
import * as settings from './settings'
import * as ytdlp from './ytdlp'
import * as ffmpegDownload from './ffmpegDownload'
import { worklog } from './worklog'
import {
  getDouyinInfo,
  getDouyinInfoForProfilePick,
  downloadDouyinVideo,
  downloadDouyinImageGallery,
  enrichDouyinVideoPlayUrls,
  isDouyinUrl,
  getLastDouyinInfoError,
  isDouyinGallery,
  isDouyinAbortError,
} from './douyin'
import {
  downloadXiaohongshuImageGallery,
  isXhsAbortError,
} from './xiaohongshu'
import * as dockProgress from './dockProgress'
import { basename, dirname, extname, join } from 'path'
import { existsSync } from 'fs'
import { stat, readdir, unlink, rm, rename } from 'fs/promises'
import { statfs } from 'fs/promises'
import { sanitizeDownloadBasename } from './sanitizeDownloadBasename'
import { classifyResolverError, filterPersistedHeaders, mediaTypeForCandidate, sanitizeResolverError } from './mediaResolver'
import { ensurePoTokenProvider } from './poTokenServer'
import { planQueueAdmissions } from './groupedQueueScheduler'
import { transcodeFile } from './transcodeManager'
import type { TranscodePresetId } from './transcodeModel'
import { findReusableDownload, shouldRedownloadExisting, stableMediaUrl } from './mediaIdentity'
type DownloadErrorCode = 'ENGINE_MISSING' | 'PO_TOKEN_REQUIRED' | 'AUTH_REQUIRED' | 'BROWSER_REQUIRED' | 'NETWORK_RETRYABLE' | 'STORAGE_UNAVAILABLE' | 'UNSUPPORTED' | 'DRM_PROTECTED'

const MIN_DOUYIN_OUTPUT_BYTES = 512
const MIN_YTDLP_OUTPUT_BYTES = 512

async function chooseSafeOutputPath(path: string): Promise<string> {
  try {
    await stat(path)
    const dot = path.lastIndexOf('.')
    const stem = dot > 0 ? path.slice(0, dot) : path
    const ext = dot > 0 ? path.slice(dot) : ''
    for (let i = 1; i < 1000; i++) {
      const candidate = `${stem} (${i})${ext}`
      try { await stat(candidate) } catch { return candidate }
    }
  } catch { return path }
  return `${path}.copy`
}

async function hasWorkingDiskSpace(dir: string): Promise<boolean> {
  try {
    const fs = await statfs(dir)
    return Number(fs.bavail) * Number(fs.bsize) > 32 * 1024 * 1024
  } catch { return true }
}

function ytdlpMediaIdFromOutput(output: string): string {
  const m = output.match(/\[info\]\s+(\d+):\s+Downloading/i)
  return m?.[1]?.trim() ?? ''
}

async function findYtdlpOutputByIdMarker(
  outDir: string,
  ytdlpId: string,
  outputExtGuess: string
): Promise<{ path: string; size: number } | null> {
  const marker = `[${ytdlpId}]`
  const exts = new Set(
    outputExtGuess === 'mp3'
      ? ['mp3', 'm4a', 'opus', 'webm']
      : ['mp4', 'mkv', 'webm', 'm4a']
  )
  try {
    const files = await readdir(outDir)
    for (const f of files) {
      if (!f.includes(marker)) continue
      const dot = f.lastIndexOf('.')
      if (dot < 1) continue
      if (!exts.has(f.slice(dot + 1).toLowerCase())) continue
      const p = join(outDir, f)
      try {
        const st = await stat(p)
        if (st.isFile() && st.size >= MIN_YTDLP_OUTPUT_BYTES) {
          return { path: p, size: st.size }
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* dir missing */
  }
  return null
}

async function tryAdoptExistingYtdlpOutput(
  task: DownloadTask,
  outDir: string,
  cookiesPath: string | undefined,
  ytdlpPath: string | undefined,
  outputExtGuess: string
): Promise<boolean> {
  const taskMeta = task.metadata as Record<string, unknown> | undefined
  if (taskMeta?.douyinImageUrls || taskMeta?.xhsImageUrls) return false

  let ytdlpId = String(taskMeta?.ytdlpId ?? '').trim()
  if (!ytdlpId) {
    try {
      const info = await ytdlp.getVideoInfo(task.url, cookiesPath || undefined, ytdlpPath)
      const row = info as { id?: string }
      ytdlpId = String(row?.id ?? '').trim()
      if (ytdlpId) {
        const merged = { ...(taskMeta ?? {}), ytdlpId }
        task.metadata = merged
        db.updateDownload(task.id, { extras: serializeExtras(merged) })
      }
    } catch {
      return false
    }
  }
  if (!ytdlpId) return false

  const hit = await findYtdlpOutputByIdMarker(outDir, ytdlpId, outputExtGuess)
  if (!hit || isTaskAborted(task.id)) return false

  task.filePath = hit.path
  task.status = 'complete'
  task.progress = 100
  task.error = null
  task.errorCode = null
  task.updatedAt = new Date().toISOString()
  taskExtraMeta.delete(task.id)
  db.updateDownload(task.id, {
    status: 'complete',
    progress: 100,
    file_path: hit.path,
    file_size: hit.size,
    error: null,
    error_code: null,
    extras: serializeExtras(task.metadata as Record<string, unknown> | undefined)
  })
  emitProgress(task)
  console.log(`[runTask] adopted existing yt-dlp file id=${task.id.slice(0, 8)} path=${hit.path}`)
  return true
}

async function tryAdoptExistingDouyinOutput(task: DownloadTask, outDir: string): Promise<boolean> {
  if (!isDouyinUrl(task.url)) return false
  const taskMeta = task.metadata as Record<string, unknown> | undefined
  const imageUrls = taskMeta?.douyinImageUrls as string[] | undefined
  if (imageUrls && imageUrls.length > 0) return false

  const outputPath = join(outDir, `${sanitizeDownloadBasename(task.title, 100)}.mp4`)
  try {
    const st = await stat(outputPath)
    if (isTaskAborted(task.id)) return false
    if (!st.isFile() || st.size < MIN_DOUYIN_OUTPUT_BYTES) return false
    task.filePath = outputPath
    task.status = 'complete'
    task.progress = 100
    task.error = null
    task.errorCode = null
    task.updatedAt = new Date().toISOString()
    taskExtraMeta.delete(task.id)
    db.updateDownload(task.id, {
      status: 'complete',
      progress: 100,
      file_path: outputPath,
      file_size: st.size,
      error: null,
      error_code: null,
    })
    emitProgress(task)
    console.log(`[runTask] adopted existing Douyin file id=${task.id.slice(0, 8)} path=${outputPath}`)
    return true
  } catch {
    return false
  }
}

function isHlsLikeDirectMedia(mediaType: string | undefined, url: string): boolean {
  const mt = (mediaType || '').toLowerCase()
  if (mt === 'hls') return true
  return /\.m3u8(\?|#|$)/i.test(url)
}

function ytdlpRetrySleepsForSpeedMode(mode: string | undefined): string[] | undefined {
  if (mode === 'turbo') return ['fragment:linear=2::5', 'http:linear=2::5']
  if (mode === 'gentle') return ['fragment:linear=4::12']
  if (mode === 'balanced') return ['fragment:linear=1::4']
  return undefined
}

export type TaskStatus =
  | 'resolving'
  | 'ready'
  | 'queued'
  | 'downloading'
  | 'complete'
  | 'error'
  | 'interrupted'
  | 'cancelled'
  | 'paused'

export interface DownloadTask {
  id: string
  url: string
  title: string
  format: string
  quality: string
  status: TaskStatus
  progress: number
  filePath: string | null
  thumbnail: string | null
  duration: number | null
  metadata: Record<string, unknown>
  playlistId: string | null
  playlistIndex: number | null
  error: string | null
  errorCode?: DownloadErrorCode | null
  createdAt: string
  updatedAt: string
}

interface AddTaskOptions {
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
  candidate?: Record<string, unknown>
  /** Skip URL reuse so a remote API job cannot attach to (or cancel) a desktop task. */
  forceNew?: boolean
}

let activeDownloads = new Map<string, { cancel: () => void; getStderr?: () => string; getDestinations?: () => string[] }>()
/** Tasks the user removed/cancelled; in-flight runTask loops must exit without touching DB. */
const abortedTaskIds = new Set<string>()
const taskAbortControllers = new Map<string, AbortController>()
const taskExtraMeta = new Map<string, { mediaType?: string; referer?: string; customHeaders?: Record<string, string> }>()
const transcodeJobs = new Set<string>()
const taskSpeedBytes = new Map<string, number>()
const taskProgress = new Map<string, number>()
const progressEmitLastAt = new Map<string, number>()
const PROGRESS_EMIT_MIN_MS = 400
let lastDockUpdateAt = 0
const DOCK_UPDATE_MIN_MS = 1000
let mainWindow: BrowserWindow | null = null

type InfoResolveHooks = {
  onCancel?: (id: string) => void
  onRetry?: (id: string) => void
}

let infoResolveHooks: InfoResolveHooks = {}

type ProgressExtras = {
  speed?: string
  eta?: string
  totalSize?: string | null
  phase?: string | null
}

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

export function setInfoResolveHooks(hooks: InfoResolveHooks): void {
  infoResolveHooks = hooks
}

function ensureTaskAbortController(id: string): AbortSignal {
  let ctrl = taskAbortControllers.get(id)
  if (!ctrl || ctrl.signal.aborted) {
    ctrl = new AbortController()
    taskAbortControllers.set(id, ctrl)
  }
  return ctrl.signal
}

function getTaskAbortSignal(id: string): AbortSignal | undefined {
  return taskAbortControllers.get(id)?.signal
}

function disposeTaskAbortController(id: string): void {
  taskAbortControllers.delete(id)
}

function markTaskAborted(id: string): void {
  abortedTaskIds.add(id)
  taskAbortControllers.get(id)?.abort()
}

function clearTaskAborted(id: string): void {
  abortedTaskIds.delete(id)
  disposeTaskAbortController(id)
}

function isTaskAborted(id: string): boolean {
  if (abortedTaskIds.has(id)) return true
  return !db.getDownloads().some((r) => r.id === id)
}

function classifyDownloadError(message: string, isYoutube: boolean): DownloadErrorCode {
  if (/po.?token|provider|missing[_ -]?pot|youtubepot|youtube.*bot|bot.*youtube|confirm you.?re not a bot/i.test(message) && isYoutube) return 'PO_TOKEN_REQUIRED'
  if (/captcha|browser challenge|challenge required|javascript required/i.test(message)) return 'BROWSER_REQUIRED'
  if (/drm|widevine|protected content/i.test(message)) return 'DRM_PROTECTED'
  if (/login required|private video|sign in|authentication|cookies/i.test(message)) return 'AUTH_REQUIRED'
  if (/browser|javascript runtime|client.*required|chrome extension|chrome:\/\/extensions|extension.*reload/i.test(message)) return 'BROWSER_REQUIRED'
  if (/unsupported|no video formats|not available/i.test(message)) return 'UNSUPPORTED'
  if (/network|timed out|timeout|connection|503|429|temporarily unavailable/i.test(message)) return 'NETWORK_RETRYABLE'
  if (/enoent|not found|executable/i.test(message)) return 'ENGINE_MISSING'
  return isYoutube ? 'NETWORK_RETRYABLE' : 'UNSUPPORTED'
}

function setTaskError(task: DownloadTask, message: string, code?: DownloadErrorCode): void {
  task.status = 'error'
  task.error = sanitizeResolverError(message)
  task.errorCode = code ?? classifyDownloadError(task.error, ytdlp.isValidYouTubeUrl(task.url))
  task.updatedAt = new Date().toISOString()
  db.updateDownload(task.id, { status: 'error', error: task.error, error_code: task.errorCode, progress: task.progress })
}

function emitToRenderer(channel: string, data: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

export function emitInfoResolveResult(data: unknown): void {
  emitToRenderer('info-resolve-result', data)
}

function serializeExtras(metadata?: Record<string, unknown>): string | null {
  if (!metadata) return null
  const out: Record<string, unknown> = {}
  if (metadata.infoResolve === true) out.infoResolve = true
  if (metadata.resolveAutoStart === true) out.resolveAutoStart = true
  if (typeof metadata.resolveTitle === 'string' && metadata.resolveTitle.trim()) out.resolveTitle = metadata.resolveTitle.trim()
  if (metadata.nativeYoutubePlaylist === true) out.nativeYoutubePlaylist = true
  if (metadata.candidate && typeof metadata.candidate === 'object') {
    const c = metadata.candidate as Record<string, unknown>
    if (typeof c.url === 'string' && /^https?:\/\//i.test(c.url)) {
      out.candidate = { url: c.url, formatId: typeof c.formatId === 'string' ? c.formatId : undefined, container: typeof c.container === 'string' ? c.container : undefined, protocol: typeof c.protocol === 'string' ? c.protocol : undefined, mimeType: typeof c.mimeType === 'string' ? c.mimeType : undefined }
    }
  }
  if (Array.isArray(metadata.douyinImageUrls)) out.douyinImageUrls = metadata.douyinImageUrls
  if (Array.isArray(metadata.xhsImageUrls)) out.xhsImageUrls = metadata.xhsImageUrls
  // Persist direct-media fields so retry / app restart still routes ffmpeg-first like the original enqueue.
  if (typeof metadata.mediaType === 'string' && metadata.mediaType.trim()) {
    out.mediaType = metadata.mediaType.trim()
  }
  if (typeof metadata.referer === 'string' && metadata.referer.trim()) {
    out.referer = metadata.referer.trim()
  }
  if (
    metadata.customHeaders &&
    typeof metadata.customHeaders === 'object' &&
    !Array.isArray(metadata.customHeaders)
  ) {
    const safeHeaders = filterPersistedHeaders(metadata.customHeaders as Record<string, string>)
    if (Object.keys(safeHeaders).length > 0) out.customHeaders = safeHeaders
  }
  if (metadata.douyinProfilePick === true) out.douyinProfilePick = true
  if (typeof metadata.awemeId === 'string') out.awemeId = metadata.awemeId
  if (typeof metadata.douyinMediaType === 'string') out.douyinMediaType = metadata.douyinMediaType
  if (typeof metadata.douyinProfileBatchSize === 'number') {
    out.douyinProfileBatchSize = metadata.douyinProfileBatchSize
  }
  if (typeof metadata.playlistTitle === 'string') out.playlistTitle = metadata.playlistTitle
  if (typeof metadata.ytdlpId === 'string' && metadata.ytdlpId.trim()) {
    out.ytdlpId = metadata.ytdlpId.trim()
  }
  if (typeof metadata.transcodePreset === 'string' && metadata.transcodePreset.trim()) {
    out.transcodePreset = metadata.transcodePreset.trim()
  }
  if (typeof metadata.remoteJobId === 'string' && metadata.remoteJobId.trim()) {
    out.remoteJobId = metadata.remoteJobId.trim()
  }
  if (typeof metadata.remoteOutputDir === 'string' && metadata.remoteOutputDir.trim()) {
    out.remoteOutputDir = metadata.remoteOutputDir.trim()
  }
  return Object.keys(out).length ? JSON.stringify(out) : null
}

function taskFromRecord(r: db.DownloadRecord): DownloadTask {
  const metadata: Record<string, unknown> = {}
  if (r.channel) metadata.channel = r.channel
  if (r.extras) {
    try {
      Object.assign(metadata, JSON.parse(r.extras) as Record<string, unknown>)
    } catch {
      /* ignore corrupt extras */
    }
  }
  return {
    id: r.id,
    url: r.url,
    title: r.title,
    format: r.format,
    quality: r.quality,
    status: r.status as TaskStatus,
    progress: r.progress,
    filePath: r.file_path,
    thumbnail: r.thumbnail,
    duration: r.duration,
    metadata,
    playlistId: r.playlist_id,
    playlistIndex: r.playlist_index,
    error: r.error,
    errorCode: (r.error_code as DownloadErrorCode | null) ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function parseSpeedToBytes(speedStr: string): number {
  if (!speedStr) return 0
  const m = speedStr.match(/([\d.]+)\s*(GiB|MiB|KiB|B)\/s/i)
  if (!m) return 0
  const val = parseFloat(m[1])
  switch (m[2]) {
    case 'GiB': return val * 1024 * 1024 * 1024
    case 'MiB': return val * 1024 * 1024
    case 'KiB': return val * 1024
    default: return val
  }
}

/** yt-dlp often emits 0% for the first lines even when `--continue` resumes; don't regress UI/DB below last known. */
function mergeMonotonicProgress(task: DownloadTask, reported: number): number {
  const prev = typeof task.progress === 'number' && Number.isFinite(task.progress) ? task.progress : 0
  return Math.max(reported, prev)
}

function waitChildClose(proc: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    proc.once('close', (code, signal) => resolve({ code, signal }))
    proc.once('error', () => resolve({ code: 1, signal: null }))
  })
}

function updateDockProgress(force = false): void {
  if (activeDownloads.size === 0) {
    dockProgress.reset()
    return
  }

  const now = Date.now()
  if (!force && now - lastDockUpdateAt < DOCK_UPDATE_MIN_MS) return
  lastDockUpdateAt = now

  let totalSpeed = 0
  for (const [id] of activeDownloads) {
    totalSpeed += taskSpeedBytes.get(id) ?? 0
  }

  const all = db.getDownloads()
  const downloadRows = all.filter((r) => r.status !== 'resolving' && r.status !== 'ready')
  const activeCount = downloadRows.filter((r) => r.status === 'downloading' || r.status === 'queued').length

  let overallProgress = 0
  for (const r of downloadRows) {
    if (r.status === 'complete') {
      overallProgress += 100
    } else {
      overallProgress += taskProgress.get(r.id) ?? r.progress ?? 0
    }
  }
  const avgProgress = downloadRows.length > 0 ? overallProgress / downloadRows.length : 0

  dockProgress.updateProgress(avgProgress, totalSpeed, activeCount)
}

/** Slim IPC payload — avoids shipping full task metadata/thumbnails on every progress tick. */
function slimProgressPayload(task: DownloadTask, extras?: ProgressExtras): Record<string, unknown> {
  const stateChange = ['resolving', 'ready', 'complete', 'error', 'cancelled', 'paused', 'interrupted'].includes(task.status)
  return {
    id: task.id,
    status: task.status,
    progress: task.progress,
    speed: extras?.speed ?? '',
    eta: extras?.eta ?? '',
    totalSize: extras?.totalSize ?? null,
    phase: extras?.phase ?? null,
    ...(task.filePath != null ? { filePath: task.filePath } : {}),
    ...(task.title ? { title: task.title } : {}),
    ...(stateChange
      ? {
          error: task.error,
          errorCode: task.errorCode ?? null,
          thumbnail: task.thumbnail,
          duration: task.duration,
          channel: task.metadata.channel ?? null,
        }
      : {}),
  }
}

const downloadListeners = new Set<(task: DownloadTask) => void>()

export function addDownloadListener(listener: (task: DownloadTask) => void): () => void {
  downloadListeners.add(listener)
  return () => {
    downloadListeners.delete(listener)
  }
}

function emitProgress(task: DownloadTask, extras?: ProgressExtras, opts?: { force?: boolean }): void {
  const stateChange = ['resolving', 'ready', 'complete', 'error', 'cancelled', 'paused', 'interrupted'].includes(task.status)
  const isStart = task.status === 'downloading' && task.progress <= 1
  if (!opts?.force && !stateChange && !isStart) {
    const now = Date.now()
    const last = progressEmitLastAt.get(task.id) ?? 0
    if (now - last < PROGRESS_EMIT_MIN_MS) return
    progressEmitLastAt.set(task.id, now)
  } else {
    progressEmitLastAt.set(task.id, Date.now())
  }
  emitToRenderer('download-progress', slimProgressPayload(task, extras))
  for (const listener of downloadListeners) {
    try {
      listener(task)
    } catch (err) {
      console.warn('[downloadManager] listener failed', err)
    }
  }
}

function emitThumbnailRefresh(task: DownloadTask): void {
  emitToRenderer('download-progress', {
    id: task.id,
    status: task.status,
    progress: task.progress,
    title: task.title,
    thumbnail: task.thumbnail,
    speed: '',
    eta: '',
    totalSize: null,
    phase: null,
  })
}

function douyinResolveUrlForTask(task: DownloadTask): string {
  const meta = task.metadata as Record<string, unknown> | undefined
  const awemeId = typeof meta?.awemeId === 'string' ? meta.awemeId.trim() : ''
  if (awemeId) {
    const mt = meta?.douyinMediaType
    if (mt === 'note' || mt === 'gallery') {
      return `https://m.douyin.com/share/note/${awemeId}`
    }
    return `https://m.douyin.com/share/video/${awemeId}`
  }
  return task.url
}

function reportDouyinDownloadProgress(
  task: DownloadTask,
  p: number,
  extras?: ProgressExtras
): void {
  if (isTaskAborted(task.id)) return
  task.progress = p
  task.status = 'downloading'
  task.updatedAt = new Date().toISOString()
  db.updateDownload(task.id, { status: 'downloading', progress: p })
  taskProgress.set(task.id, p)
  if (extras?.speed) taskSpeedBytes.set(task.id, parseSpeedToBytes(extras.speed))
  updateDockProgress()
  emitProgress(task, extras)
}

async function runDouyinDirectDownload(
  task: DownloadTask,
  outDir: string,
  cookiesPath: string | undefined,
  options?: { profilePick?: boolean }
): Promise<boolean> {
  if (isTaskAborted(task.id)) return true

  const resolveUrl = douyinResolveUrlForTask(task)
  if (!isDouyinUrl(resolveUrl) && !isDouyinUrl(task.url)) return false

  task.status = 'downloading'
  task.updatedAt = new Date().toISOString()
  db.updateDownload(task.id, { status: 'downloading', progress: 1 })
  emitProgress(task, {}, { force: true })

  try {
    console.log(
      `[runTask] Douyin direct${options?.profilePick ? ' (profile pick)' : ''} id=${task.id.slice(0, 8)}`
    )
    const fetchOpts = { signal: getTaskAbortSignal(task.id) }
    const taskMeta = task.metadata as Record<string, unknown> | undefined
    const profileAwemeId =
      options?.profilePick && typeof taskMeta?.awemeId === 'string' ? taskMeta.awemeId.trim() : ''
    const profileMediaType =
      typeof taskMeta?.douyinMediaType === 'string' ? taskMeta.douyinMediaType : undefined

    let douyinInfo: Awaited<ReturnType<typeof getDouyinInfo>> = null
    if (profileAwemeId) {
      douyinInfo = await getDouyinInfoForProfilePick(profileAwemeId, cookiesPath || undefined, {
        ...fetchOpts,
        mediaType: profileMediaType,
      })
      if (isTaskAborted(task.id)) return true
      if (!douyinInfo) {
        console.log(
          `[runTask] profile pick API miss for ${profileAwemeId}; falling back to page fetch id=${task.id.slice(0, 8)}`
        )
      }
    }
    if (!douyinInfo) {
      douyinInfo = await getDouyinInfo(resolveUrl, cookiesPath || undefined, fetchOpts)
    }
    if (isTaskAborted(task.id)) return true
    if (!douyinInfo) {
      if (options?.profilePick) {
        task.progress = 0
        setTaskError(task, getLastDouyinInfoError() || 'Could not resolve Douyin media', 'UNSUPPORTED')
        emitProgress(task, {}, { force: true })
        return true
      }
      return false
    }

    let filePath: string
    if (isDouyinGallery(douyinInfo)) {
      filePath = await downloadDouyinImageGallery(
        douyinInfo.imageUrls,
        outDir,
        douyinInfo.title || task.title,
        cookiesPath || undefined,
        (pct) => {
          const p = Math.min(99, Math.round(10 + pct * 0.89))
          reportDouyinDownloadProgress(task, p, {
            speed: '',
            eta: '',
            totalSize: null,
            phase: 'video',
          })
        },
        fetchOpts
      )
    } else {
      const videoInfo = await enrichDouyinVideoPlayUrls(douyinInfo, cookiesPath || undefined, fetchOpts)
      if (isTaskAborted(task.id)) return true
      filePath = await downloadDouyinVideo(
        videoInfo.videoUrl,
        outDir,
        task.title,
        cookiesPath || undefined,
        (prog) => {
          const p = Math.min(99, Math.round(10 + prog.percent * 0.89))
          reportDouyinDownloadProgress(task, p, {
            speed: prog.speed ?? '',
            eta: prog.eta ?? '',
            totalSize: null,
            phase: 'video',
          })
        },
        videoInfo.videoUrlFallbacks,
        fetchOpts
      )
    }

    if (isTaskAborted(task.id)) return true

    let fileSize: number | null = null
    try {
      const st = await stat(filePath)
      fileSize = st.isFile() ? st.size : null
    } catch {
      /* ignore */
    }
    task.filePath = filePath
    task.status = 'complete'
    task.progress = 100
    task.error = null
    task.errorCode = null
    task.updatedAt = new Date().toISOString()
    taskExtraMeta.delete(task.id)
    db.updateDownload(task.id, {
      status: 'complete',
      progress: 100,
      file_path: filePath,
      file_size: fileSize,
      error: null,
      error_code: null,
    })
    emitProgress(task, {}, { force: true })
    return true
  } catch (e) {
    if (isTaskAborted(task.id) || isDouyinAbortError(e)) return true
    task.progress = 0
    taskExtraMeta.delete(task.id)
    setTaskError(task, e instanceof Error ? e.message : String(e))
    emitProgress(task, {}, { force: true })
    return true
  }
}

function scheduleDirectMediaThumbnailIfNeeded(task: DownloadTask, options: AddTaskOptions): void {
  if (options.thumbnail && options.thumbnail.trim()) return
  if (!ffmpegDownload.shouldTryStreamThumbnail(options.mediaType, task.url, task.format)) return

  const id = task.id
  const { url } = task
  const { mediaType, referer, customHeaders } = options

  void (async () => {
    try {
      const dataUrl = await ffmpegDownload.extractStreamThumbnailAsDataUrl({
        url,
        mediaType,
        referer,
        customHeaders
      })
      if (!dataUrl) return
      const row = db.getDownloads().find((r) => r.id === id)
      if (!row) return
      if (row.thumbnail && String(row.thumbnail).trim()) return
      if (row.status === 'cancelled') return
      db.updateDownload(id, { thumbnail: dataUrl })
      const updated = db.getDownloads().find((r) => r.id === id)
      if (!updated) return
      emitThumbnailRefresh(taskFromRecord(updated))
    } catch (e) {
      console.warn('[thumbnail] extract failed:', e instanceof Error ? e.message : e)
    }
  })()
}

function outputFilePresent(filePath: string | null | undefined): boolean {
  return Boolean(filePath && existsSync(filePath))
}

function requeueMissingOutput(record: db.DownloadRecord): DownloadTask {
  clearTaskAborted(record.id)
  db.updateDownload(record.id, {
    status: 'queued',
    progress: 0,
    file_path: null,
    file_size: null,
    error: null,
    error_code: null,
  })
  const updated = db.getDownloads().find((r) => r.id === record.id)
  const task = taskFromRecord(updated ?? { ...record, status: 'queued', progress: 0, file_path: null, file_size: null, error: null })
  emitProgress(task, {}, { force: true })
  processQueue()
  return task
}

export function addTask(options: AddTaskOptions): DownloadTask {
  if (!options.forceNew) {
    const reusable = findReusableDownload(db.getDownloads(), options.url)
    if (reusable) {
      if (shouldRedownloadExisting(reusable, outputFilePresent)) return requeueMissingOutput(reusable)
      return taskFromRecord(reusable)
    }
  }

  const id = uuidv4()
  const outputDir = options.outputDir ?? settings.get('downloadDir')
  const quality = options.quality ?? settings.get('defaultVideoQuality')

  const mergedMetadata: Record<string, unknown> = {
    ...(options.metadata ?? {}),
    ...(options.mediaType ? { mediaType: options.mediaType } : {}),
    ...(options.referer ? { referer: options.referer } : {}),
    ...(options.customHeaders ? { customHeaders: options.customHeaders } : {}),
    ...(options.candidate ? { candidate: options.candidate } : {})
  }

  const task: DownloadTask = {
    id,
    url: options.url,
    title: options.title,
    format: options.format,
    quality,
    status: 'queued',
    progress: 0,
    filePath: null,
    thumbnail: options.thumbnail ?? null,
    duration: options.duration ?? null,
    metadata: mergedMetadata,
    playlistId: options.playlistId ?? null,
    playlistIndex: options.playlistIndex ?? null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  if (options.mediaType || options.referer || options.customHeaders) {
    taskExtraMeta.set(id, {
      mediaType: options.mediaType,
      referer: options.referer,
      customHeaders: options.customHeaders
    })
  }

  db.insertDownload({
    id: task.id,
    url: task.url,
    title: task.title,
    format: task.format,
    quality: task.quality,
    status: task.status,
    progress: task.progress,
    file_path: null,
    file_size: null,
    thumbnail: task.thumbnail,
    duration: task.duration,
    channel: (options.metadata?.channel as string) || null,
    playlist_id: task.playlistId,
    playlist_index: task.playlistIndex,
    extras: serializeExtras(mergedMetadata),
    error: null
  })

  emitToRenderer('new-download', task)
  try {
    const u = new URL(task.url)
    worklog('task_enqueued', {
      id: task.id,
      host: u.hostname,
      hasThumbnail: Boolean(task.thumbnail),
      mediaType: options.mediaType ?? '',
      format: task.format
    })
  } catch {
    worklog('task_enqueued', {
      id: task.id,
      hasThumbnail: Boolean(task.thumbnail),
      mediaType: options.mediaType ?? '',
      format: task.format
    })
  }
  scheduleDirectMediaThumbnailIfNeeded(task, options)
  processQueue()
  return task
}

export interface InfoResolveTaskOptions {
  url: string
  title?: string
  format?: string
  quality?: string
  thumbnail?: string
  duration?: number
  metadata?: Record<string, unknown>
  referer?: string
  customHeaders?: Record<string, string>
}

export interface PromoteInfoResolveOptions {
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
}

function metadataFromRecord(record: db.DownloadRecord): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  if (record.channel) metadata.channel = record.channel
  if (record.extras) {
    try {
      Object.assign(metadata, JSON.parse(record.extras) as Record<string, unknown>)
    } catch {
      /* ignore corrupt extras */
    }
  }
  return metadata
}

export function isInfoResolveTaskRecord(record: db.DownloadRecord): boolean {
  if (!record.extras) return false
  try {
    return (JSON.parse(record.extras) as Record<string, unknown>)?.infoResolve === true
  } catch {
    return false
  }
}

export function isInfoResolveTask(id: string): boolean {
  const record = db.getDownloads().find((candidate) => candidate.id === id)
  return Boolean(record && isInfoResolveTaskRecord(record))
}

/** Create the durable placeholder shown while the main-process resolver works. */
export function createInfoResolveTask(options: InfoResolveTaskOptions): DownloadTask {
  const id = uuidv4()
  const now = new Date().toISOString()
  const quality = options.quality ?? settings.get('defaultVideoQuality')
  const metadata: Record<string, unknown> = {
    ...(options.metadata ?? {}),
    infoResolve: true,
    ...(options.title?.trim() ? { resolveTitle: options.title.trim() } : {}),
    ...(options.referer ? { referer: options.referer } : {}),
    ...(options.customHeaders ? { customHeaders: options.customHeaders } : {})
  }
  const task: DownloadTask = {
    id,
    url: options.url,
    title: options.title?.trim() || 'Resolving…',
    format: options.format || 'video',
    quality,
    status: 'resolving',
    progress: 0,
    filePath: null,
    thumbnail: options.thumbnail ?? null,
    duration: options.duration ?? null,
    metadata,
    playlistId: null,
    playlistIndex: null,
    error: null,
    errorCode: null,
    createdAt: now,
    updatedAt: now
  }

  db.insertDownload({
    id: task.id,
    url: task.url,
    title: task.title,
    format: task.format,
    quality: task.quality,
    status: task.status,
    progress: 0,
    file_path: null,
    file_size: null,
    thumbnail: task.thumbnail,
    duration: task.duration,
    channel: typeof metadata.channel === 'string' ? metadata.channel : null,
    playlist_id: null,
    playlist_index: null,
    extras: serializeExtras(metadata),
    error: null
  })
  emitToRenderer('new-download', task)
  return task
}

export function markInfoResolveResolving(id: string): DownloadTask | null {
  const record = db.getDownloads().find((candidate) => candidate.id === id)
  if (!record || !isInfoResolveTaskRecord(record) || record.status === 'cancelled') return null
  db.updateDownload(id, { status: 'resolving', progress: 0, error: null, error_code: null })
  const updated = db.getDownloads().find((candidate) => candidate.id === id)
  if (!updated) return null
  const task = taskFromRecord(updated)
  emitProgress(task, {}, { force: true })
  return task
}

export function markInfoResolveReady(
  id: string,
  patch: { title?: string; thumbnail?: string | null; duration?: number | null; channel?: string | null } = {}
): DownloadTask | null {
  const record = db.getDownloads().find((candidate) => candidate.id === id)
  if (!record || !isInfoResolveTaskRecord(record) || record.status === 'cancelled') return null
  db.updateDownload(id, {
    status: 'ready',
    progress: 0,
    error: null,
    error_code: null,
    ...(patch.title?.trim() ? { title: patch.title.trim() } : {}),
    ...(patch.thumbnail !== undefined ? { thumbnail: patch.thumbnail } : {}),
    ...(patch.duration !== undefined ? { duration: patch.duration } : {}),
    ...(patch.channel !== undefined ? { channel: patch.channel } : {})
  })
  const updated = db.getDownloads().find((candidate) => candidate.id === id)
  if (!updated) return null
  const task = taskFromRecord(updated)
  emitProgress(task, {}, { force: true })
  return task
}

export function failInfoResolveTask(id: string, message: string): DownloadTask | null {
  const record = db.getDownloads().find((candidate) => candidate.id === id)
  if (!record || !isInfoResolveTaskRecord(record) || record.status === 'cancelled') return null
  const error = sanitizeResolverError(message)
  const errorCode = classifyDownloadError(error, ytdlp.isValidYouTubeUrl(record.url))
  db.updateDownload(id, { status: 'error', error, error_code: errorCode })
  const updated = db.getDownloads().find((candidate) => candidate.id === id)
  if (!updated) return null
  const task = taskFromRecord(updated)
  emitProgress(task, {}, { force: true })
  return task
}

/** Transition a resolver placeholder into the normal download queue without creating a second row. */
export function promoteInfoResolveTask(id: string, options: PromoteInfoResolveOptions): DownloadTask | null {
  const record = db.getDownloads().find((candidate) => candidate.id === id)
  if (!record || !isInfoResolveTaskRecord(record) || record.status === 'cancelled') return null

  const previous = metadataFromRecord(record)
  const metadata: Record<string, unknown> = {
    ...previous,
    ...(options.metadata ?? {}),
    ...(options.mediaType ? { mediaType: options.mediaType } : {}),
    ...(options.referer ? { referer: options.referer } : {}),
    ...(options.customHeaders ? { customHeaders: options.customHeaders } : {})
  }
  delete metadata.infoResolve
  delete metadata.resolveAutoStart
  delete metadata.resolveTitle

  const title = options.title?.trim() || record.title || 'Download'
  const quality = options.quality ?? record.quality ?? settings.get('defaultVideoQuality')
  db.updateDownload(id, {
    ...(options.url ? { url: options.url } : {}),
    title,
    format: options.format,
    quality,
    status: 'queued',
    progress: 0,
    file_path: null,
    file_size: null,
    error: null,
    error_code: null,
    ...(options.thumbnail !== undefined ? { thumbnail: options.thumbnail } : {}),
    ...(options.duration !== undefined ? { duration: options.duration } : {}),
    channel: typeof metadata.channel === 'string' ? metadata.channel : record.channel,
    extras: serializeExtras(metadata)
  })
  clearTaskAborted(id)
  if (options.mediaType || options.referer || options.customHeaders) {
    taskExtraMeta.set(id, {
      mediaType: options.mediaType,
      referer: options.referer,
      customHeaders: options.customHeaders
    })
  } else {
    taskExtraMeta.delete(id)
  }
  const updated = db.getDownloads().find((candidate) => candidate.id === id)
  if (!updated) return null
  const task = taskFromRecord(updated)
  emitProgress(task, {}, { force: true })
  processQueue()
  return task
}

/** Used by the resolver manager after it has cancelled the in-flight worker. */
export function cancelInfoResolveTask(id: string): boolean {
  const record = db.getDownloads().find((candidate) => candidate.id === id)
  if (!record || !isInfoResolveTaskRecord(record)) return false
  db.updateDownload(id, { status: 'cancelled', error: 'Cancelled by user', error_code: null })
  const updated = db.getDownloads().find((candidate) => candidate.id === id)
  if (updated) emitProgress(taskFromRecord(updated), {}, { force: true })
  return true
}

/** Max tasks per bulk enqueue (matches profile picker load-all cap). */
export const MAX_BULK_TASKS = 2000

function buildTaskFromOptions(options: AddTaskOptions, id: string): DownloadTask {
  const quality = options.quality ?? settings.get('defaultVideoQuality')
  const mergedMetadata: Record<string, unknown> = {
    ...(options.metadata ?? {}),
    ...(options.mediaType ? { mediaType: options.mediaType } : {}),
    ...(options.referer ? { referer: options.referer } : {}),
    ...(options.customHeaders ? { customHeaders: options.customHeaders } : {}),
    ...(options.playlistTitle ? { playlistTitle: options.playlistTitle } : {}),
  }
  const now = new Date().toISOString()
  return {
    id,
    url: options.url,
    title: options.title,
    format: options.format,
    quality,
    status: 'queued',
    progress: 0,
    filePath: null,
    thumbnail: options.thumbnail ?? null,
    duration: options.duration ?? null,
    metadata: mergedMetadata,
    playlistId: options.playlistId ?? null,
    playlistIndex: options.playlistIndex ?? null,
    error: null,
    createdAt: now,
    updatedAt: now,
  }
}

/** Enqueue many tasks in one DB transaction; queue runs at Settings concurrency. */
export function addTasksBulk(optionsList: AddTaskOptions[]): { count: number; ids: string[] } {
  if (optionsList.length === 0) return { count: 0, ids: [] }
  if (optionsList.length > MAX_BULK_TASKS) {
    throw new Error(`Too many tasks (max ${MAX_BULK_TASKS})`)
  }

  const batchSize = optionsList.length
  const isProfileBatch =
    batchSize >= 2 && optionsList.every((o) => o.metadata?.douyinProfilePick === true)

  const records: Array<Omit<db.DownloadRecord, 'created_at' | 'updated_at'>> = []
  const tasks: DownloadTask[] = []
  const ids: string[] = []
  const acceptedOptions: AddTaskOptions[] = []
  const staleComplete: db.DownloadRecord[] = []
  const seenKeys = new Set<string>()
  const existing = db.getDownloads()

  for (const options of optionsList) {
    const key = stableMediaUrl(options.url)
    if (key && seenKeys.has(key)) continue
    const reusable = options.forceNew ? null : findReusableDownload(existing, options.url)
    if (reusable) {
      if (shouldRedownloadExisting(reusable, outputFilePresent)) staleComplete.push(reusable)
      if (key) seenKeys.add(key)
      continue
    }
    if (key) seenKeys.add(key)
    acceptedOptions.push(options)
    const id = uuidv4()
    ids.push(id)
    const metadata: Record<string, unknown> = {
      ...(options.metadata ?? {}),
      channel: String(options.metadata?.channel ?? ''),
      ...(options.playlistTitle ? { playlistTitle: options.playlistTitle } : {}),
      ...(isProfileBatch ? { douyinProfileBatchSize: batchSize } : {}),
    }
    const task = buildTaskFromOptions({ ...options, metadata }, id)
    tasks.push(task)

    if (options.mediaType || options.referer || options.customHeaders) {
      taskExtraMeta.set(id, {
        mediaType: options.mediaType,
        referer: options.referer,
        customHeaders: options.customHeaders,
      })
    }

    records.push({
      id: task.id,
      url: task.url,
      title: task.title,
      format: task.format,
      quality: task.quality,
      status: task.status,
      progress: task.progress,
      file_path: null,
      file_size: null,
      thumbnail: task.thumbnail,
      duration: task.duration,
      channel: (metadata.channel as string) || null,
      playlist_id: task.playlistId,
      playlist_index: task.playlistIndex,
      extras: serializeExtras(metadata),
      error: null,
    })
  }

  if (records.length === 0 && staleComplete.length === 0) return { count: 0, ids: [] }

  if (records.length > 0) {
    db.insertDownloadsBulk(records)
  }

  for (let i = 0; i < tasks.length; i++) {
    scheduleDirectMediaThumbnailIfNeeded(tasks[i]!, acceptedOptions[i]!)
  }

  const requeued = staleComplete.map((record) => requeueMissingOutput(record))
  worklog('bulk_enqueued', { count: tasks.length, profileBatch: isProfileBatch, requeued: requeued.length })
  if (tasks.length > 0) {
    emitToRenderer('download-progress', { bulkAdded: tasks.length })
  }
  processQueue()
  return { count: tasks.length + requeued.length, ids: [...ids, ...requeued.map((task) => task.id)] }
}

async function runTask(task: DownloadTask): Promise<void> {
  // Claim a concurrency slot before any await so processQueue cannot over-start tasks.
  let workerCancel: (() => void) | null = null
  activeDownloads.set(task.id, {
    cancel: () => workerCancel?.(),
    getStderr: () => '',
    getDestinations: () => []
  })
  ensureTaskAbortController(task.id)
  updateDockProgress()

  const releaseSlot = (): void => {
    activeDownloads.delete(task.id)
    taskSpeedBytes.delete(task.id)
    taskProgress.delete(task.id)
    progressEmitLastAt.delete(task.id)
    disposeTaskAbortController(task.id)
    updateDockProgress(true)
  }

  const stopIfAborted = (): boolean => {
    if (!isTaskAborted(task.id)) return false
    releaseSlot()
    processQueue()
    return true
  }

  const batchSize = Number(task.metadata?.douyinProfileBatchSize ?? 0)
  if (batchSize >= 50 && task.metadata?.douyinProfilePick === true) {
    const delaySec = settings.get('sleepInterval')
    // Profile picks use aweme/detail API (fast); keep a short stagger only when sleepInterval is unset.
    const pauseMs = delaySec > 0 ? delaySec * 1000 : 250
    await new Promise((r) => setTimeout(r, pauseMs))
    if (stopIfAborted()) return
  }

  const cookiesPath = settings.getCookiesPath()
  const sleepInterval = settings.get('sleepInterval')
  const ytdlpPath = settings.get('ytdlpPath')
  const playlistSubfolder = settings.get('playlistSubfolder')
  const taskMeta = task.metadata as Record<string, unknown> | undefined

  const qualityNum = parseInt(task.quality, 10) || 1080
  const isPlaylist = task.playlistId != null
  const sanitizedPlaylistId = task.playlistId?.replace(/[/\\?*:|"<>]/g, '-')
  const remoteOutputDir = typeof taskMeta?.remoteOutputDir === 'string' ? taskMeta.remoteOutputDir.trim() : ''
  const outputDir = remoteOutputDir || settings.get('downloadDir')
  const outDir = remoteOutputDir
    ? remoteOutputDir
    : playlistSubfolder && isPlaylist && sanitizedPlaylistId
      ? join(outputDir, sanitizedPlaylistId)
      : outputDir
  const cached = taskExtraMeta.get(task.id)
  const candidate = (taskMeta?.candidate && typeof taskMeta.candidate === 'object' ? taskMeta.candidate : null) as { url?: string; type?: string; protocol?: 'http' | 'https' | 'hls' | 'dash' | 'file' | 'unknown'; container?: string; mimeType?: string } | null
  const effectiveUrl = candidate?.url || task.url
  const mediaType = cached?.mediaType || (candidate ? mediaTypeForCandidate(candidate) : '') || (taskMeta?.mediaType as string) || undefined
  const referer = cached?.referer || (taskMeta?.referer as string) || undefined
  const customHeaders = cached?.customHeaders || (taskMeta?.customHeaders as Record<string, string>) || undefined

  if (await tryAdoptExistingDouyinOutput(task, outDir)) {
    if (stopIfAborted()) return
    releaseSlot()
    processQueue()
    return
  }
  if (stopIfAborted()) return

  const douyinImageUrls = taskMeta?.douyinImageUrls as string[] | undefined
  const xhsImageUrls = taskMeta?.xhsImageUrls as string[] | undefined
  const galleryFetchOpts = { signal: getTaskAbortSignal(task.id) }
  const galleryImageUrls = douyinImageUrls?.length ? douyinImageUrls : xhsImageUrls
  const galleryDownloader = douyinImageUrls?.length
    ? downloadDouyinImageGallery
    : xhsImageUrls?.length
      ? downloadXiaohongshuImageGallery
      : null
  if (galleryImageUrls && galleryImageUrls.length > 0 && galleryDownloader) {
    task.status = 'downloading'
    task.updatedAt = new Date().toISOString()
    db.updateDownload(task.id, { status: 'downloading', progress: 1 })
    emitProgress(task)
    try {
      const dir = await galleryDownloader(
        galleryImageUrls,
        outDir,
        task.title,
        cookiesPath || undefined,
        (pct) => {
          if (isTaskAborted(task.id)) return
          task.progress = pct
          task.updatedAt = new Date().toISOString()
          db.updateDownload(task.id, { status: 'downloading', progress: pct })
          taskProgress.set(task.id, pct)
          updateDockProgress()
          emitProgress(task, {
            speed: '',
            eta: '',
            totalSize: null,
            phase: 'video',
          })
        },
        galleryFetchOpts
      )
      if (stopIfAborted()) return
      let fileSize: number | null = null
      try {
        const st = await stat(dir)
        if (st.isDirectory()) fileSize = null
      } catch {
        /* ignore */
      }
      task.filePath = dir
      task.status = 'complete'
      task.progress = 100
      task.error = null
      task.errorCode = null
      task.updatedAt = new Date().toISOString()
      taskExtraMeta.delete(task.id)
      db.updateDownload(task.id, {
        status: 'complete',
        progress: 100,
        file_path: dir,
        file_size: fileSize,
        error: null,
        error_code: null
      })
      emitProgress(task)
    } catch (e) {
      if (stopIfAborted() || isDouyinAbortError(e) || isXhsAbortError(e)) return
      task.progress = 0
      taskExtraMeta.delete(task.id)
      setTaskError(task, e instanceof Error ? e.message : String(e))
      emitProgress(task)
    }
    taskProgress.delete(task.id)
    releaseSlot()
    processQueue()
    return
  }

  const nativeYoutube = taskMeta?.nativeYoutubePlaylist === true
  const useNativePlaylist =
    nativeYoutube && Boolean(task.playlistId) && ytdlp.isPlaylistUrl(task.url)
  const playlistSleep = useNativePlaylist ? settings.get('youtubePlaylistSleepRequests') : 0
  const playlistMax = useNativePlaylist ? settings.get('youtubePlaylistMaxDownloads') : 0

  const outputExtGuess =
    task.format === 'audio' || task.format === 'mp3' || mediaType === 'mp3'
      ? 'mp3'
      : mediaType === 'jpeg'
        ? 'jpg'
        : 'mp4'
  const sanitizedTitle = task.title.replace(/[/\\?*:|"<>]/g, '-')
  const expectedPath = join(outDir, `${sanitizedTitle}.${outputExtGuess}`)
  const finalPath = await chooseSafeOutputPath(expectedPath)
  if (!(await hasWorkingDiskSpace(outDir))) {
    task.progress = 0
    setTaskError(task, 'Not enough free disk space to start download.', 'STORAGE_UNAVAILABLE')
    releaseSlot()
    processQueue()
    return
  }

  if (!mediaType && !useNativePlaylist) {
    if (await tryAdoptExistingYtdlpOutput(task, outDir, cookiesPath || undefined, ytdlpPath, outputExtGuess)) {
      if (stopIfAborted()) return
      releaseSlot()
      processQueue()
      return
    }
    if (stopIfAborted()) return
  }

  const directEngine = settings.get('directMediaEngine')
  const speedMode = settings.get('downloadSpeedMode')
  const concFragments = Math.min(
    32,
    Math.max(1, Math.floor(Number(settings.get('concurrentFragments')) || 5))
  )

  const tryFfmpegFirst =
    Boolean(mediaType) &&
    (directEngine === 'auto' || directEngine === 'ffmpeg') &&
    ffmpegDownload.isFfmpegDirectMediaEligible(mediaType, effectiveUrl) &&
    !(directEngine === 'auto' && isHlsLikeDirectMedia(mediaType, effectiveUrl))

  if (tryFfmpegFirst) {
    const fdp = ffmpegDownload.downloadDirectMediaWithFfmpeg({
      url: effectiveUrl,
      outputPath: `${finalPath}.part`,
      mediaType,
      format: task.format,
      referer,
      customHeaders,
      durationSec: task.duration
    })
    workerCancel = fdp.cancel
    activeDownloads.set(task.id, {
      cancel: fdp.cancel,
      getStderr: fdp.getStderr,
      getDestinations: fdp.getDestinations
    })
    fdp.onProgress((progress) => {
      const pct = mergeMonotonicProgress(task, progress.percent)
      task.progress = pct
      task.status = 'downloading'
      task.updatedAt = new Date().toISOString()
      db.updateDownload(task.id, { status: 'downloading', progress: pct })

      taskProgress.set(task.id, pct)
      taskSpeedBytes.set(task.id, parseSpeedToBytes(progress.speed))
      updateDockProgress()

      emitProgress(task, {
        speed: progress.speed,
        eta: progress.eta,
        totalSize: progress.total,
        phase: progress.phase,
      })
    })

    console.log(`[runTask] ffmpeg id=${task.id.slice(0, 8)} title=${task.title.slice(0, 20)}`)

    const { code, signal } = await waitChildClose(fdp.process)
    if (isTaskAborted(task.id)) {
      await unlink(`${finalPath}.part`).catch(() => {})
      stopIfAborted()
      return
    }

    const isStale =
      !activeDownloads.has(task.id) || activeDownloads.get(task.id)?.cancel !== fdp.cancel

    if (isStale) {
      await unlink(`${finalPath}.part`).catch(() => {})
      releaseSlot()
      processQueue()
      return
    }

    const current = db.getDownloads().find((r) => r.id === task.id)

    if (signal === 'SIGTERM' || signal === 'SIGKILL') {
      await unlink(`${finalPath}.part`).catch(() => {})
      if (current?.status !== 'paused') {
        task.status = 'cancelled'
        task.error = 'Cancelled by user'
        task.errorCode = null
        db.updateDownload(task.id, { status: 'cancelled', error: 'Cancelled by user', error_code: null })
      } else {
        task.status = 'paused'
        task.error = null
        task.errorCode = null
        db.updateDownload(task.id, { status: 'paused', error: null, error_code: null })
      }
      emitProgress(taskFromRecord(db.getDownloads().find((r) => r.id === task.id)!))
      releaseSlot()
      processQueue()
      return
    }

    if (code === 0 && current?.status !== 'paused') {
      const MIN_OUTPUT_BYTES = 512
      try {
        const st = await stat(`${finalPath}.part`)
        if (st.isFile() && st.size >= MIN_OUTPUT_BYTES) {
          const actualFinalPath = await chooseSafeOutputPath(finalPath)
          await rename(`${finalPath}.part`, actualFinalPath)
          task.filePath = actualFinalPath
          task.status = 'complete'
          task.progress = 100
          task.error = null
          task.errorCode = null
          task.updatedAt = new Date().toISOString()
          taskExtraMeta.delete(task.id)
          db.updateDownload(task.id, {
            status: 'complete',
            progress: 100,
            file_path: actualFinalPath,
            file_size: st.size,
            error: null,
            error_code: null
          })
          emitProgress(task)
          releaseSlot()
          processQueue()
          return
        }
      } catch {
        /* missing output */
      }
      await unlink(`${finalPath}.part`).catch(() => {})
    }

    const stderrTail = fdp
      .getStderr()
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-6)
      .join('\n')
    if (directEngine === 'ffmpeg') {
      task.progress = 0
      taskExtraMeta.delete(task.id)
      setTaskError(task, stderrTail || (code !== 0 ? `ffmpeg exited with code ${code}` : 'ffmpeg produced no output file'))
      emitProgress(task)
      await unlink(`${finalPath}.part`).catch(() => {})
      releaseSlot()
      processQueue()
      return
    }

    if (stderrTail) {
      console.warn(`[runTask] ffmpeg stderr tail (fallback to yt-dlp):\n${sanitizeResolverError(stderrTail)}`)
    } else {
      console.warn(`[runTask] ffmpeg failed (code=${code}); falling back to yt-dlp`)
    }
    await unlink(`${finalPath}.part`).catch(() => {})
  }

  const externalDl = settings.get('ytdlpExternalDownloader')
  const retrySleeps = ytdlpRetrySleepsForSpeedMode(speedMode)

  const isProfilePick = taskMeta?.douyinProfilePick === true
  if (isProfilePick && isDouyinUrl(task.url)) {
    await runDouyinDirectDownload(task, outDir, cookiesPath || undefined, { profilePick: true })
    taskProgress.delete(task.id)
    releaseSlot()
    processQueue()
    return
  }

  const poToken = ytdlp.isValidYouTubeUrl(effectiveUrl) && !mediaType
    ? await ensurePoTokenProvider()
    : { status: 'unavailable' as const }
  const dp = ytdlp.download(
    {
      url: effectiveUrl,
      format: task.format,
      quality: qualityNum,
      outputDir: outDir,
      cookiesPath: cookiesPath || undefined,
      sleepInterval,
      isPlaylist: useNativePlaylist,
      youtubeNativePlaylist: useNativePlaylist,
      playlistTitle: useNativePlaylist ? (task.playlistId ?? undefined) : undefined,
      playlistSleepRequests: playlistSleep,
      playlistMaxDownloads: playlistMax,
      referer,
      customHeaders,
      outputTitle: mediaType ? basename(finalPath, extname(finalPath)) : undefined,
      mediaType,
      concurrentFragments: concFragments > 1 ? concFragments : undefined,
      externalDownloader: externalDl || undefined,
      retrySleeps,
      extractorArgs: poToken.provider?.extractorArgs,
      pluginDir: poToken.provider?.pluginDir,
      proxyUrl: settings.get('proxyUrl') || undefined
    },
    ytdlpPath
  )

  workerCancel = dp.cancel
  activeDownloads.set(task.id, { cancel: dp.cancel, getStderr: dp.getStderr, getDestinations: dp.getDestinations })
  dp.onProgress((progress) => {
    const pct = mergeMonotonicProgress(task, progress.percent)
    task.progress = pct
    task.status = 'downloading'
    task.updatedAt = new Date().toISOString()
    db.updateDownload(task.id, { status: 'downloading', progress: pct })

    taskProgress.set(task.id, pct)
    taskSpeedBytes.set(task.id, parseSpeedToBytes(progress.speed))
    updateDockProgress()

    emitProgress(task, {
      speed: progress.speed,
      eta: progress.eta,
      totalSize: progress.total,
      phase: progress.phase,
    })
  })

  console.log(`[runTask] started id=${task.id.slice(0,8)} title=${task.title.slice(0,20)}`)

  return new Promise((resolve) => {
    dp.process.on('close', async (code, signal) => {
      if (isTaskAborted(task.id)) {
        releaseSlot()
        resolve()
        processQueue()
        return
      }

      const isStale = !activeDownloads.has(task.id) || activeDownloads.get(task.id)?.cancel !== dp.cancel

      console.log(`[close] id=${task.id.slice(0,8)} code=${code} signal=${signal} isStale=${isStale}`)

      if (isStale) {
        console.log(`[close] id=${task.id.slice(0,8)} STALE - skipping`)
        releaseSlot()
        resolve()
        processQueue()
        return
      }

      const current = db.getDownloads().find((r) => r.id === task.id)
      console.log(`[close] id=${task.id.slice(0,8)} dbStatus=${current?.status}`)

      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
      if (current?.status !== 'paused') {
        task.status = 'cancelled'
        task.error = 'Cancelled by user'
        task.errorCode = null
        db.updateDownload(task.id, { status: 'cancelled', error: 'Cancelled by user', error_code: null })
      } else {
        task.status = 'paused'
        task.error = null
        task.errorCode = null
        db.updateDownload(task.id, { status: 'paused', error: null, error_code: null })
        }
        emitProgress(taskFromRecord(db.getDownloads().find((r) => r.id === task.id)!))
        releaseSlot()
        resolve()
        processQueue()
        return
      }

      if (code !== 0) {
        const stderr = dp.getStderr().trim()
        const stderrTail = stderr ? stderr.split('\n').filter(Boolean).slice(-6).join('\n') : ''
        if (stderrTail) {
          console.warn(`[runTask] id=${task.id.slice(0,8)} yt-dlp stderr tail:\n${sanitizeResolverError(stderrTail)}`)
        }
        const isAudio = task.format === 'audio' || task.format === 'mp3'
        let recovered = false
        if (!isAudio && isDouyinUrl(task.url)) {
          console.log('[runTask] yt-dlp failed for Douyin; trying mobile share fallback')
          await runDouyinDirectDownload(task, outDir, cookiesPath || undefined)
          recovered = task.status === 'complete'
        }
        if (!recovered) {
          const errorLine = stderr.split('\n').filter((l) => l.includes('ERROR:')).pop()
          let taskError = errorLine || `yt-dlp exited with code ${code}`
          if (!isAudio && isDouyinUrl(task.url)) {
            const hint = getLastDouyinInfoError()
            if (hint) {
              taskError = `${taskError} — Douyin fallback: ${hint}`
            } else {
              taskError = `${taskError} — Douyin fallback did not recover this link`
            }
          }
          taskError = `${taskError} — ${classifyResolverError(taskError).action}`
          setTaskError(task, taskError)
          emitProgress(task)
        }
        releaseSlot()
        resolve()
        processQueue()
        return
      }

      let filePath: string | null = null
      let fileSize: number | null = null

      if (useNativePlaylist) {
        let totalBytes = 0
        try {
          const files = await readdir(outDir)
          for (const f of files) {
            const p = join(outDir, f)
            try {
              const st = await stat(p)
              if (st.isFile()) totalBytes += st.size
            } catch {
              /* skip */
            }
          }
        } catch {
          /* folder missing — still mark playlist folder */
        }
        task.filePath = outDir
        task.status = 'complete'
        task.progress = 100
        task.error = null
        task.errorCode = null
        task.updatedAt = new Date().toISOString()
        taskExtraMeta.delete(task.id)
        db.updateDownload(task.id, {
          status: 'complete',
          progress: 100,
          file_path: outDir,
          file_size: totalBytes > 0 ? totalBytes : null,
          error: null,
          error_code: null
        })
        emitProgress(task)
        releaseSlot()
        resolve()
        processQueue()
        return
      }

      const outputExtGuess =
        task.format === 'audio' || task.format === 'mp3' || mediaType === 'mp3'
          ? 'mp3'
          : mediaType === 'jpeg'
            ? 'jpg'
            : 'mp4'
      const sanitizedTitle = task.title.replace(/[/\\?*:|"<>]/g, '-')
      const expectedPath = join(outDir, `${sanitizedTitle}.${outputExtGuess}`)
      const expectedPathAlt =
        mediaType === 'jpeg' ? join(outDir, `${sanitizedTitle}.jpeg`) : null

      const MIN_OUTPUT_BYTES = MIN_YTDLP_OUTPUT_BYTES
      const ytdlpOutput = dp.getOutput?.() ?? dp.getStderr()
      const ytdlpId = String(taskMeta?.ytdlpId ?? ytdlpMediaIdFromOutput(ytdlpOutput)).trim()
      const idMarker = ytdlpId ? `[${ytdlpId}]` : ''
      if (ytdlpId && !taskMeta?.ytdlpId) {
        const merged = { ...(taskMeta ?? {}), ytdlpId }
        task.metadata = merged
        db.updateDownload(task.id, { extras: serializeExtras(merged) })
      }

      const tryStat = async (p: string): Promise<{ path: string; size: number } | null> => {
        try {
          const st = await stat(p)
          if (st.isFile() && st.size >= MIN_OUTPUT_BYTES) return { path: p, size: st.size }
        } catch {
          /* missing */
        }
        return null
      }

      const destinationMatchesTask = (p: string): boolean => {
        if (!idMarker) return true
        return p.includes(idMarker)
      }

      // 1) Paths yt-dlp reported on stdout (authoritative when present)
      const dests = (dp.getDestinations?.() ?? []).filter(destinationMatchesTask)
      for (let i = dests.length - 1; i >= 0; i--) {
        const hit = await tryStat(dests[i])
        if (hit) {
          filePath = hit.path
          fileSize = hit.size
          break
        }
      }

      // 2) Filename contains yt-dlp video id (matches our default -o template)
      if (!filePath && ytdlpId) {
        const hit = await findYtdlpOutputByIdMarker(outDir, ytdlpId, outputExtGuess)
        if (hit) {
          filePath = hit.path
          fileSize = hit.size
        }
      }

      // 3) Reserved unique path from start-of-task (never the leftover file the user just deleted)
      if (!filePath) {
        const hit = await tryStat(finalPath)
        if (hit) {
          filePath = hit.path
          fileSize = hit.size
        } else if (expectedPathAlt && expectedPath === finalPath) {
          const hitAlt = await tryStat(expectedPathAlt)
          if (hitAlt) {
            filePath = hitAlt.path
            fileSize = hitAlt.size
          }
        }
      }

      // 4) Same directory, same title prefix only (never "newest mp4 in folder" — that mis-attributes unrelated files)
      if (!filePath) {
        try {
          const files = await readdir(outDir)
          const exts = new Set(
            outputExtGuess === 'mp3'
              ? ['mp3', 'm4a', 'opus', 'webm']
              : mediaType === 'jpeg'
                ? ['jpg', 'jpeg', 'png', 'webp']
                : ['mp4', 'mkv', 'webm', 'm4a']
          )
          const outputBase = basename(finalPath, extname(finalPath))
          let newest: { path: string; mtime: number; size: number } | null = null
          for (const f of files) {
            const dot = f.lastIndexOf('.')
            if (dot < 1) continue
            const ext = f.slice(dot + 1).toLowerCase()
            if (!exts.has(ext)) continue
            if (!f.startsWith(outputBase)) continue
            const p = join(outDir, f)
            try {
              const st = await stat(p)
              if (!st.isFile() || st.size < MIN_OUTPUT_BYTES) continue
              if (!newest || st.mtimeMs > newest.mtime) {
                newest = { path: p, mtime: st.mtimeMs, size: st.size }
              }
            } catch {
              /* skip */
            }
          }
          if (newest) {
            filePath = newest.path
            fileSize = newest.size
          }
        } catch {
          /* dir missing */
        }
      }

      if (!filePath) {
        const stderr = dp.getStderr().trim()
        const tail = stderr ? stderr.split('\n').filter(Boolean).slice(-4).join('\n') : ''
        const sanitizedTail = sanitizeResolverError(tail)
        const outputError = sanitizedTail
          ? `yt-dlp reported success but no output file was found.\n${sanitizedTail}`
          : 'yt-dlp reported success but no output file was found (check download folder permissions and disk space).'
        task.progress = 0
        taskExtraMeta.delete(task.id)
        setTaskError(task, outputError, 'STORAGE_UNAVAILABLE')
        db.updateDownload(task.id, { file_path: null, file_size: null })
        emitProgress(task)
        releaseSlot()
        resolve()
        processQueue()
        return
      }

      task.filePath = filePath
      task.status = 'complete'
      task.progress = 100
      task.error = null
      task.errorCode = null
      task.updatedAt = new Date().toISOString()
      taskExtraMeta.delete(task.id)
      db.updateDownload(task.id, {
        status: 'complete',
        progress: 100,
        file_path: filePath,
        file_size: fileSize,
        error: null,
        error_code: null
      })

      emitProgress(task)
      releaseSlot()
      resolve()
      processQueue()
    })

    dp.process.on('error', (err) => {
      console.error(`[runTask] id=${task.id.slice(0,8)} process error: ${sanitizeResolverError(err.message)}`)
      const isStale = !activeDownloads.has(task.id) || activeDownloads.get(task.id)?.cancel !== dp.cancel

      if (isStale) {
        releaseSlot()
        resolve()
        processQueue()
        return
      }

      setTaskError(task, err.message)
      emitProgress(task)
      releaseSlot()
      resolve()
      processQueue()
    })
  })
}

let pendingQueue = false
function processQueue(): void {
  if (pendingQueue) return
  pendingQueue = true

  queueMicrotask(() => {
    pendingQueue = false

    const all = db.getDownloads()

    // Heal zombie rows left from older builds: DB says downloading but no in-process slot.
    for (const r of all) {
      if (abortedTaskIds.has(r.id)) continue
      if (r.status === 'downloading' && !activeDownloads.has(r.id)) {
        console.warn(`[processQueue] re-queue zombie downloading id=${r.id.slice(0, 8)}`)
        db.updateDownload(r.id, { status: 'queued', error: r.error })
      }
    }

    const refreshed = db.getDownloads()
    const mode = settings.get('downloadSpeedMode')
    const active = refreshed.filter((r) => activeDownloads.has(r.id)).map((r) => ({ id: r.id, playlistId: r.playlist_id, playlistIndex: r.playlist_index, status: r.status as 'downloading' }))
    const queued = refreshed
      .filter((r) => r.status === 'queued')
      .sort((a, b) => {
        if (a.playlist_id && b.playlist_id && a.playlist_id === b.playlist_id) {
          const ai = a.playlist_index ?? 0
          const bi = b.playlist_index ?? 0
          if (ai !== bi) return ai - bi
        }
        return a.created_at.localeCompare(b.created_at)
      })

    const toStart = planQueueAdmissions(active, queued.map((r) => ({ id: r.id, playlistId: r.playlist_id, playlistIndex: r.playlist_index, status: 'queued' as const })), mode, settings.get('concurrency'))
    console.log(`[processQueue] active=${active.length} mode=${mode} queued=${queued.length} planned=${toStart.length} activeMap=${activeDownloads.size}`)

    for (const id of toStart) {
      const r = queued.find((candidate) => candidate.id === id)
      if (!r || activeDownloads.has(r.id)) continue
      db.updateDownload(r.id, { status: 'downloading' })
      const task = taskFromRecord({ ...r, status: 'downloading' })
      task.status = 'downloading'
      taskProgress.set(task.id, task.progress)
      emitProgress(task)
      runTask(task).catch(() => {})
    }
  })
}

export function cancelTask(id: string): boolean {
  markTaskAborted(id)
  const active = activeDownloads.get(id)
  if (active) {
    active.cancel()
    activeDownloads.delete(id)
    taskSpeedBytes.delete(id)
    taskProgress.delete(id)
    updateDockProgress()
  }

  const tasks = db.getDownloads()
  const record = tasks.find((r) => r.id === id)
  if (record && isInfoResolveTaskRecord(record) && (record.status === 'resolving' || record.status === 'ready' || record.status === 'error')) {
    infoResolveHooks.onCancel?.(id)
    return cancelInfoResolveTask(id)
  }
  if (record && (record.status === 'queued' || record.status === 'downloading')) {
    db.updateDownload(id, { status: 'cancelled', error: 'Cancelled by user', error_code: null })
    const updated = db.getDownloads().find((r) => r.id === id)
    if (updated) {
      emitProgress(taskFromRecord(updated))
    }
    processQueue()
    return true
  }
  return false
}

export function pauseTask(id: string): boolean {
  const tasks = db.getDownloads()
  const record = tasks.find((r) => r.id === id)
  if (record && (record.status === 'queued' || record.status === 'downloading')) {
    db.updateDownload(id, { status: 'paused', error: null, error_code: null })

    const active = activeDownloads.get(id)
    if (active) {
      active.cancel()
      activeDownloads.delete(id)
      taskSpeedBytes.delete(id)
      taskProgress.delete(id)
      updateDockProgress()
    }
    const updated = db.getDownloads().find((r) => r.id === id)
    if (updated) {
      emitProgress(taskFromRecord(updated))
    }
    processQueue()
    return true
  }
  return false
}

export function retryTask(id: string): boolean {
  const tasks = db.getDownloads()
  const record = tasks.find((r) => r.id === id)
  console.log(`[retryTask] id=${id.slice(0,8)} status=${record?.status ?? 'NOT_FOUND'}`)
  if (record && isInfoResolveTaskRecord(record) && (record.status === 'error' || record.status === 'cancelled')) {
    clearTaskAborted(id)
    db.updateDownload(id, { status: 'resolving', progress: 0, error: null, error_code: null })
    const updated = db.getDownloads().find((r) => r.id === id)
    if (updated) emitProgress(taskFromRecord(updated), {}, { force: true })
    infoResolveHooks.onRetry?.(id)
    return true
  }
  if (record && (record.status === 'error' || record.status === 'interrupted' || record.status === 'cancelled' || record.status === 'paused')) {
    clearTaskAborted(id)
    // Preserve progress for crash / pause / failed retries so the UI matches yt-dlp --continue (partial .part).
    // Only explicit user cancel gets a clean slate when they choose Retry again.
    const preserveProgress =
      record.status === 'interrupted' || record.status === 'paused' || record.status === 'error'
    if (preserveProgress) {
      db.updateDownload(id, { status: 'queued', error: null, error_code: null })
    } else {
      db.updateDownload(id, { status: 'queued', progress: 0, error: null, error_code: null })
    }
    const updated = db.getDownloads().find((r) => r.id === id)
    if (updated) {
      emitProgress(taskFromRecord(updated))
    }
    processQueue()
    return true
  }
  return false
}

export function deleteTask(id: string): void {
  markTaskAborted(id)
  cancelTask(id)
  taskExtraMeta.delete(id)
  db.deleteDownload(id)
  clearTaskAborted(id)
}

async function deleteTaskFilesForRecord(
  record: db.DownloadRecord,
  capturedDests: string[] = []
): Promise<void> {
  const baseOutputDir = settings.get('downloadDir')
  const playlistSubfolder = settings.get('playlistSubfolder')
  const isPlaylist = record.playlist_id != null
  const sanitizedPlaylistId = record.playlist_id?.replace(/[/\\?*:|"<>]/g, '-')
  const filesToDelete: string[] = []
  const dirsToDelete: string[] = []

  let searchDir = (playlistSubfolder && isPlaylist && sanitizedPlaylistId)
    ? join(baseOutputDir, sanitizedPlaylistId)
    : baseOutputDir

  if (record.file_path) {
    try {
      const st = await stat(record.file_path)
      if (st.isDirectory()) {
        dirsToDelete.push(record.file_path)
        searchDir = record.file_path
      } else {
        filesToDelete.push(record.file_path)
        searchDir = dirname(record.file_path)
      }
    } catch {
      // Missing file path, keep fallback searchDir.
    }
  }

  const ext = record.format === 'audio' || record.format === 'mp3' ? 'mp3' : 'mp4'
  const sanitizedTitle = record.title.replace(/[/\\?*:|"<>]/g, '-')

  const knownBases = new Set<string>()
  knownBases.add(sanitizedTitle)

  for (const dest of capturedDests) {
    filesToDelete.push(dest)
    filesToDelete.push(dest + '.part')
    filesToDelete.push(dest + '.ytdl')
    const base = dest.replace(/\.[^.]+$/, '').split('/').pop() ?? ''
    if (base) knownBases.add(base)
  }

  try {
    const files = await readdir(searchDir)
    for (const f of files) {
      for (const base of knownBases) {
        if (
          f.startsWith(base) &&
          (f.endsWith('.part') || f.endsWith('.ytdl') || /\.part-Frag\d+$/i.test(f) ||
           /\.f\d+\.\w+$/.test(f) || /\.f\d+\.\w+\.part$/.test(f) ||
           f === `${base}.${ext}` || f === `${base}.mp4` || f === `${base}.webm`)
        ) {
          filesToDelete.push(join(searchDir, f))
          break
        }
      }
    }
  } catch { /* dir may not exist */ }

  const uniqueFiles = [...new Set(filesToDelete)]
  const uniqueDirs = [...new Set(dirsToDelete)]
  await Promise.allSettled(uniqueFiles.map((p) => unlink(p)))
  await Promise.allSettled(uniqueDirs.map((p) => rm(p, { recursive: true, force: true })))
}

export async function deleteTaskWithFiles(id: string): Promise<void> {
  const record = db.getDownloads().find((r) => r.id === id)

  const active = activeDownloads.get(id)
  const capturedDests = active?.getDestinations?.() ?? []

  markTaskAborted(id)
  cancelTask(id)

  if (record) {
    await deleteTaskFilesForRecord(record, capturedDests)
  }

  taskExtraMeta.delete(id)
  db.deleteDownload(id)
  clearTaskAborted(id)
}

export async function deleteTasksWithFiles(ids: string[]): Promise<{ removed: number }> {
  const uniqueIds = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))]
  if (uniqueIds.length === 0) return { removed: 0 }

  const records = new Map<string, db.DownloadRecord>()
  const capturedById = new Map<string, string[]>()
  for (const id of uniqueIds) {
    const record = db.getDownloads().find((r) => r.id === id)
    if (record) records.set(id, record)
    const active = activeDownloads.get(id)
    capturedById.set(id, active?.getDestinations?.() ?? [])
    markTaskAborted(id)
    cancelTask(id)
    taskExtraMeta.delete(id)
  }

  for (const [id, record] of records) {
    await deleteTaskFilesForRecord(record, capturedById.get(id) ?? [])
    db.deleteDownload(id)
    clearTaskAborted(id)
  }

  emitToRenderer('download-progress', { bulkRemoved: records.size })
  processQueue()
  return { removed: records.size }
}

export async function deleteTasks(ids: string[]): Promise<{ removed: number }> {
  const uniqueIds = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))]
  if (uniqueIds.length === 0) return { removed: 0 }

  let removed = 0
  for (const id of uniqueIds) {
    if (db.getDownloads().some((r) => r.id === id)) removed++
    deleteTask(id)
  }

  emitToRenderer('download-progress', { bulkRemoved: removed })
  processQueue()
  return { removed }
}

export function isTranscoding(id: string): boolean {
  return transcodeJobs.has(id)
}

export async function transcodeTask(id: string, preset: TranscodePresetId): Promise<DownloadTask> {
  if (transcodeJobs.has(id)) throw new Error('This file is already being transcoded')

  const record = db.getDownloads().find((row) => row.id === id)
  if (!record || record.status !== 'complete' || !record.file_path) {
    throw new Error('Only completed downloads with an available file can be transcoded')
  }

  transcodeJobs.add(id)
  emitToRenderer('transcode-progress', { id, preset, status: 'started', percent: 0 })
  try {
    const task = taskFromRecord(record)
    const result = await transcodeFile({
      inputPath: record.file_path,
      preset,
      durationSec: task.duration,
      onProgress: (progress) => {
        emitToRenderer('transcode-progress', { id, preset, status: 'progress', ...progress })
      },
    })

    const latest = db.getDownloads().find((row) => row.id === id)
    if (!latest) {
      await unlink(result.outputPath).catch(() => {})
      throw new Error('The download was removed while transcoding')
    }

    const metadata = { ...task.metadata, transcodePreset: preset }
    db.updateDownload(id, {
      file_path: result.outputPath,
      file_size: result.bytes,
      extras: serializeExtras(metadata),
      error: null,
      error_code: null,
    })
    const updated = taskFromRecord(db.getDownloads().find((row) => row.id === id) ?? latest)
    emitProgress(updated, { phase: 'complete' }, { force: true })
    emitToRenderer('transcode-progress', {
      id,
      preset,
      status: 'complete',
      percent: 100,
      filePath: result.outputPath,
    })
    return updated
  } catch (error) {
    emitToRenderer('transcode-progress', {
      id,
      preset,
      status: 'error',
      percent: 0,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    transcodeJobs.delete(id)
  }
}

export function getAll(): DownloadTask[] {
  return db.getDownloads().map(taskFromRecord)
}

export function clearCompleted(): void {
  db.clearCompleted()
  emitToRenderer('download-progress', { cleared: true })
}

export function clearAll(): void {
  for (const r of db.getDownloads()) {
    markTaskAborted(r.id)
    if (isInfoResolveTaskRecord(r)) infoResolveHooks.onCancel?.(r.id)
  }
  for (const id of [...activeDownloads.keys()]) {
    cancelTask(id)
  }
  abortedTaskIds.clear()
  taskAbortControllers.clear()
  db.clearAll()
  emitToRenderer('download-progress', { cleared: true })
  processQueue()
}

export function pauseAll(): void {
  const all = db.getDownloads()
  for (const r of all) {
    if (r.status === 'downloading' || r.status === 'queued') {
      pauseTask(r.id)
    }
  }
}

export function resumeAll(): void {
  const all = db.getDownloads()
  for (const r of all) {
    // Do not bulk-resume user-cancelled items; per-row Retry still works for those.
    if (r.status === 'paused' || r.status === 'interrupted' || r.status === 'error') {
      retryTask(r.id)
    }
  }
}

export function loadFromDbAndRecover(): void {
  const all = db.getDownloads()
  const statusCounts: Record<string, number> = {}
  for (const r of all) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1
  console.log(`[recover] total=${all.length} statuses=${JSON.stringify(statusCounts)}`)
  for (const r of all) {
    if (r.status === 'downloading') {
      db.updateDownload(r.id, { status: 'interrupted', error: 'App was closed during download' })
    }
  }
  processQueue()
}
