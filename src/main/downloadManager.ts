import { v4 as uuidv4 } from 'uuid'
import { BrowserWindow } from 'electron'
import type { ChildProcess } from 'child_process'
import { type BigIntStats, type Dirent } from 'fs'
import * as db from './database'
import * as settings from './settings'
import * as ytdlp from './ytdlp'
import * as ffmpegDownload from './ffmpegDownload'
import { stopBrowserCookieProcesses } from './browserCookies'
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
import { basename, dirname, extname, isAbsolute, join, relative, sep, resolve as resolvePath } from 'path'
import { existsSync } from 'fs'
import { createReadStream } from 'fs'
import { lstat, link, mkdir, open, realpath, stat, readdir, unlink, rm } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { statfs } from 'fs/promises'
import {
  composeDownloadOutputDir,
  renderConcreteBasename,
  resolveWriterOutputName,
  siteLabelFromUrl
} from './outputTemplateModel'
import { extrasFromTaskOverrides, isRemoteJobTask, resolveTaskDownloadOverrides } from './taskOverrides'
import { ytdlpLimitRateArgs } from './ytdlpLimitRate'
import {
  hasNoteBody,
  noteFieldsFromMetadata,
  noteFilePath,
  shouldWriteNote,
  writeNoteMarkdownFile,
  type NoteFileWriteResult,
} from './noteMarkdown'
import { classifyResolverError, mediaTypeForCandidate, sanitizeResolverError } from './mediaResolver'
import { pickPersistedExtras } from './persistedExtras'
import { ensurePoTokenProvider } from './poTokenServer'
import { planQueueAdmissions } from './groupedQueueScheduler'
import { planSessionRecover } from './sessionRecover'
import { transcodeFile } from './transcodeManager'
import { createTranscodeOutputPath, type TranscodePresetId } from './transcodeModel'
import {
  bulkQueueNotice,
  decideQueueAdmission,
  findReusableDownload,
  indexReusableDownloads,
  localizeQueueNotice,
  queueIdentityKey,
  type QueueNotice
} from './mediaIdentity'
import { getUiLanguage } from './uiLanguage'
type DownloadErrorCode = 'ENGINE_MISSING' | 'PO_TOKEN_REQUIRED' | 'AUTH_REQUIRED' | 'BROWSER_REQUIRED' | 'NETWORK_RETRYABLE' | 'STORAGE_UNAVAILABLE' | 'UNSUPPORTED' | 'DRM_PROTECTED'

const MIN_DOUYIN_OUTPUT_BYTES = 512
const MIN_YTDLP_OUTPUT_BYTES = 512
const outputPathReservations = new Map<string, string>()
const outputReservationsByTask = new Map<string, Set<string>>()
const MAX_PERSISTED_PLAYLIST_OUTPUTS = 10_000

type PersistedOutputIdentity = {
  dev: string
  ino: string
  size: string
  birthtimeNs?: string
}

type PersistedOwnedOutput = PersistedOutputIdentity & { path: string }

type NativePlaylistPublishEntry = {
  sourcePath: string
  destinationPath: string
  sourceDev: string
  sourceIno: string
  sourceSize: string
  sourceBirthtimeNs?: string
  destinationDev?: string
  destinationIno?: string
  destinationSize?: string
  destinationBirthtimeNs?: string
}

type OwnedOutputPublishEntry = NativePlaylistPublishEntry

function outputIdentityFromStat(st: BigIntStats): PersistedOutputIdentity {
  return {
    dev: st.dev.toString(),
    ino: st.ino.toString(),
    size: st.size.toString(),
    ...(st.birthtimeNs > 0n ? { birthtimeNs: st.birthtimeNs.toString() } : {}),
  }
}

function outputIdentityMatches(st: BigIntStats, identity: Partial<PersistedOutputIdentity>, requireSize = false): boolean {
  if (st.dev.toString() !== identity.dev || st.ino.toString() !== identity.ino) return false
  if (identity.birthtimeNs && st.birthtimeNs > 0n && st.birthtimeNs.toString() !== identity.birthtimeNs) return false
  if (requireSize && identity.size && st.size.toString() !== identity.size) return false
  return true
}

function sameOutputIdentity(a: Partial<PersistedOutputIdentity>, b: Partial<PersistedOutputIdentity>): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.birthtimeNs === b.birthtimeNs
}

async function removeFileIfIdentityMatches(
  outputDir: string,
  path: string,
  identity: Partial<PersistedOutputIdentity>,
  requireSize = false
): Promise<boolean> {
  if (!isPathInside(outputDir, path)) return false
  try {
    const [st, rootReal, pathReal] = await Promise.all([
      lstat(path, { bigint: true }), realpath(outputDir), realpath(path)
    ])
    if (
      !st.isFile() || st.isSymbolicLink() || !outputIdentityMatches(st, identity, requireSize) ||
      !isPathInside(rootReal, pathReal)
    ) return false
    await unlink(path)
    return true
  } catch {
    return false
  }
}

function isPathInside(parent: string, candidate: string): boolean {
  const rel = relative(resolvePath(parent), resolvePath(candidate))
  return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

function resolveReportedPath(parent: string, reported: string): string | null {
  const candidate = isAbsolute(reported) ? resolvePath(reported) : resolvePath(parent, reported)
  return isPathInside(parent, candidate) ? candidate : null
}

async function collectRegularFiles(directory: string): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const child = join(directory, entry.name)
    if (entry.isFile()) files.push(child)
    else if (entry.isDirectory() && entry.name !== '.temp') files.push(...await collectRegularFiles(child))
  }
  return files
}

async function publishStagedFile(
  stagingDir: string,
  reportedPath: string,
  outputDir: string,
  taskId: string,
  minBytes: number,
  options: {
    destinationPath?: string
    requestedPath?: string
    beforePublish?: (destinationPath: string, sourceIdentity: PersistedOutputIdentity) => Promise<void>
    onDestinationIdentity?: (
      destinationPath: string,
      sourceIdentity: PersistedOutputIdentity,
      destinationIdentity: PersistedOutputIdentity
    ) => Promise<void>
  } = {}
): Promise<{ path: string; size: number; identity: PersistedOutputIdentity } | null> {
  const candidate = resolveReportedPath(stagingDir, reportedPath)
  if (!candidate) return null
  try {
    const [st, sourceRealPath, stagingRealPath] = await Promise.all([
      lstat(candidate, { bigint: true }),
      realpath(candidate),
      realpath(stagingDir),
    ])
    if (!st.isFile() || st.isSymbolicLink() || st.size < BigInt(minBytes) || !isPathInside(stagingRealPath, sourceRealPath)) return null
    const rel = relative(stagingRealPath, sourceRealPath)
    const requestedDestination = options.requestedPath
      ? resolvePath(options.requestedPath)
      : resolvePath(outputDir, rel)
    if (!isPathInside(outputDir, requestedDestination)) return null
    const sourceIdentity = outputIdentityFromStat(st)
    for (let attempt = 0; attempt < 1000; attempt++) {
      const destination = options.destinationPath
        ? resolvePath(outputDir, options.destinationPath)
        : await chooseSafeOutputPath(requestedDestination, taskId)
      if (!isPathInside(outputDir, destination) || destination.length > 4096) return null
      await options.beforePublish?.(relative(outputDir, destination), sourceIdentity)
      await mkdir(dirname(destination), { recursive: true })
      let copied = false
      let copyHandle: Awaited<ReturnType<typeof open>> | null = null
      let copyIdentity: PersistedOutputIdentity | null = null
      try {
        await link(candidate, destination)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'EEXIST') {
          if (options.destinationPath) return null
          releaseOutputPathReservation(destination, taskId)
          continue
        }
        if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EOPNOTSUPP' && code !== 'ENOTSUP' && code !== 'EMLINK') return null
        try {
          copyHandle = await open(destination, 'wx')
          const createdStat = await copyHandle.stat({ bigint: true })
          copyIdentity = {
            ...outputIdentityFromStat(createdStat),
            size: sourceIdentity.size
          }
          await options.onDestinationIdentity?.(relative(outputDir, destination), sourceIdentity, copyIdentity)
          await pipeline(createReadStream(candidate), copyHandle.createWriteStream({ autoClose: false }))
          await copyHandle.sync()
          await copyHandle.close()
          copyHandle = null
          copied = true
        } catch (copyError) {
          if (copyHandle) {
            await copyHandle.close().catch(() => {})
            copyHandle = null
          }
          if (copyIdentity) {
            try {
              const current = await lstat(destination, { bigint: true })
              if (current.isFile() && !current.isSymbolicLink() && outputIdentityMatches(current, copyIdentity)) await unlink(destination)
            } catch { /* already removed */ }
          }
          if ((copyError as NodeJS.ErrnoException).code === 'EEXIST' && !options.destinationPath) {
            releaseOutputPathReservation(destination, taskId)
            continue
          }
          return null
        }
      }
      const publishedStat = await lstat(destination, { bigint: true })
      if (!publishedStat.isFile() || publishedStat.isSymbolicLink()) return null
      const identity = outputIdentityFromStat(publishedStat)
      if (!copied && (identity.dev !== sourceIdentity.dev || identity.ino !== sourceIdentity.ino)) return null
      if (copied && copyIdentity && !outputIdentityMatches(publishedStat, copyIdentity, true)) return null
      await options.onDestinationIdentity?.(relative(outputDir, destination), sourceIdentity, identity)
      try {
        const currentSource = await lstat(candidate, { bigint: true })
        if (outputIdentityMatches(currentSource, sourceIdentity)) await unlink(candidate)
      } catch {
        /* the source disappeared or changed after publication */
      }
      return { path: destination, size: Number(publishedStat.size), identity }
    }
    return null
  } catch {
    return null
  }
}

async function chooseSafeOutputPath(path: string, taskId: string, directory = false): Promise<string> {
  const extension = directory ? '' : extname(path)
  const stem = extension ? path.slice(0, -extension.length) : path
  for (let i = 0; i < 1000; i++) {
    const candidate = i === 0 ? path : `${stem} (${i})${extension}`
    const owner = outputPathReservations.get(candidate)
    if (owner && owner !== taskId) continue
    if (owner === taskId) return candidate
    try {
      await stat(candidate)
      continue
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') continue
    }
    const currentOwner = outputPathReservations.get(candidate)
    if (currentOwner && currentOwner !== taskId) continue
    outputPathReservations.set(candidate, taskId)
    let paths = outputReservationsByTask.get(taskId)
    if (!paths) {
      paths = new Set()
      outputReservationsByTask.set(taskId, paths)
    }
    paths.add(candidate)
    return candidate
  }
  const fallback = `${path}.copy-${taskId.slice(0, 8)}`
  outputPathReservations.set(fallback, taskId)
  let paths = outputReservationsByTask.get(taskId)
  if (!paths) {
    paths = new Set()
    outputReservationsByTask.set(taskId, paths)
  }
  paths.add(fallback)
  return fallback
}

function releaseOutputReservations(taskId: string): void {
  const paths = outputReservationsByTask.get(taskId)
  if (!paths) return
  for (const path of paths) {
    if (outputPathReservations.get(path) === taskId) outputPathReservations.delete(path)
  }
  outputReservationsByTask.delete(taskId)
}

function releaseOutputPathReservation(path: string, taskId: string): void {
  if (outputPathReservations.get(path) === taskId) outputPathReservations.delete(path)
  const paths = outputReservationsByTask.get(taskId)
  paths?.delete(path)
  if (paths?.size === 0) outputReservationsByTask.delete(taskId)
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

function usableYtdlpMediaId(value: unknown): string {
  if (typeof value !== 'string') return ''
  const id = value.trim()
  if (!id || id.length > 256 || /[\\/\u0000-\u001f\u007f]/.test(id)) return ''
  try {
    const protocol = new URL(id).protocol
    if (protocol === 'http:' || protocol === 'https:') return ''
  } catch {
    /* Ordinary media IDs are not URLs. */
  }
  return id
}

async function findYtdlpOutputByIdMarker(
  outDir: string,
  ytdlpId: string,
  outputExtGuess: string,
  recursive = false
): Promise<{ path: string; size: number } | null> {
  const marker = `[${ytdlpId}]`
  const exts = new Set(
    outputExtGuess === 'mp3'
      ? ['mp3', 'm4a', 'opus', 'webm']
      : ['mp4', 'mkv', 'webm', 'm4a']
  )
  try {
    const files = recursive
      ? await collectRegularFiles(outDir)
      : (await readdir(outDir)).map((f) => join(outDir, f))
    for (const p of files) {
      const f = basename(p)
      if (!f.includes(marker)) continue
      const dot = f.lastIndexOf('.')
      if (dot < 1) continue
      if (!exts.has(f.slice(dot + 1).toLowerCase())) continue
      try {
        const st = await lstat(p)
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

  let ytdlpId = usableYtdlpMediaId(taskMeta?.ytdlpId)
  if (!ytdlpId) {
    try {
      const info = await ytdlp.getVideoInfo(
        task.url,
        cookiesPath || undefined,
        ytdlpPath,
        getTaskAbortSignal(task.id)
      )
      const row = info as { id?: string }
      ytdlpId = usableYtdlpMediaId(row?.id)
      if (ytdlpId) {
        const merged = { ...(taskMeta ?? {}), ytdlpId }
        task.metadata = merged
        db.updateDownload(task.id, { extras: serializeTaskExtrasPreservingOwnership(task.id, merged) })
      }
    } catch {
      return false
    }
  }
  if (!ytdlpId) return false

  const hit = await findYtdlpOutputByIdMarker(outDir, ytdlpId, outputExtGuess)
  if (!hit || isTaskAborted(task.id)) return false

  task.filePath = hit.path
  const note = writeTaskNote(task, 'sidecar', hit.path)
  if (note) await persistTaskOutputIdentity(task.id, outDir, 'ownedOutputFiles', note.path, note.identity)
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
    extras: serializeTaskExtrasPreservingOwnership(task.id, task.metadata as Record<string, unknown> | undefined)
  })
  emitProgress(task)
  console.log(`[runTask] adopted existing yt-dlp file id=${task.id.slice(0, 8)} path=${hit.path}`)
  return true
}

function createOutputPublishEntry(
  sourcePath: string,
  destinationPath: string,
  identity: PersistedOutputIdentity
): OwnedOutputPublishEntry {
  return {
    sourcePath,
    destinationPath,
    sourceDev: identity.dev,
    sourceIno: identity.ino,
    sourceSize: identity.size,
    ...(identity.birthtimeNs ? { sourceBirthtimeNs: identity.birthtimeNs } : {}),
    destinationDev: identity.dev,
    destinationIno: identity.ino,
    destinationSize: identity.size,
    ...(identity.birthtimeNs ? { destinationBirthtimeNs: identity.birthtimeNs } : {}),
  }
}

async function tryRecoverOwnedOutputPublish(task: DownloadTask, outputDir: string): Promise<boolean> {
  const record = db.getDownload(task.id)
  if (!record) return false
  const extras = metadataFromRecord(record)
  if (
    extras.nativeYoutubePlaylist === true || extras.remoteResolvedPlaylist === true ||
    Array.isArray(extras.nativePlaylistPublishJournal) || !Array.isArray(extras.ownedOutputPublishJournal)
  ) return false
  let outputRootReal: string
  try { outputRootReal = await realpath(outputDir) } catch { return false }
  for (const value of extras.ownedOutputPublishJournal) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const entry = value as OwnedOutputPublishEntry
    if (!entry.destinationPath || isAbsolute(entry.destinationPath) || !entry.sourceDev || !entry.sourceIno) continue
    const path = resolvePath(outputDir, entry.destinationPath)
    if (!isPathInside(outputDir, path)) continue
    const identity = destinationIdentityForEntry(entry) ?? sourceIdentityForEntry(entry)
    try {
      const [st, pathReal] = await Promise.all([lstat(path, { bigint: true }), realpath(path)])
      if (
        !st.isFile() || st.isSymbolicLink() || !outputIdentityMatches(st, identity) ||
        !isPathInside(outputRootReal, pathReal)
      ) continue
      if (st.size < BigInt(MIN_YTDLP_OUTPUT_BYTES) || !outputIdentityMatches(st, identity, true)) {
        await removeFileIfIdentityMatches(outputDir, path, identity)
        continue
      }
      task.filePath = path
      await persistTaskOutputOwnership(task.id, outputDir, 'ownedOutputFiles', [path])
      const note = writeTaskNote(task, 'sidecar', path)
      if (note) await persistTaskOutputIdentity(task.id, outputDir, 'ownedOutputFiles', note.path, note.identity)
      task.status = 'complete'
      task.progress = 100
      task.error = null
      task.errorCode = null
      task.updatedAt = new Date().toISOString()
      taskExtraMeta.delete(task.id)
      const latest = db.getDownload(task.id)
      db.updateDownload(task.id, {
        status: 'complete',
        progress: 100,
        file_path: path,
        file_size: Number(st.size),
        error: null,
        error_code: null,
        extras: serializeOwnedExtras(latest ? metadataFromRecord(latest) : extras),
      })
      emitProgress(task)
      return true
    } catch {
      /* Stale or foreign replacement; the recorded identity does not own it. */
    }
  }
  return false
}

function templateValuesForTask(task: { id: string; url: string; title: string; metadata?: Record<string, unknown> }): {
  title: string
  id: string
  author: string
  site: string
} {
  const meta = task.metadata ?? {}
  const awemeId = typeof meta.awemeId === 'string' ? meta.awemeId.trim() : ''
  const ytdlpId = usableYtdlpMediaId(meta.ytdlpId)
  const author = typeof meta.channel === 'string' ? meta.channel : ''
  return {
    title: task.title,
    id: awemeId || ytdlpId || task.id,
    author,
    site: siteLabelFromUrl(task.url)
  }
}

function resolveTaskNetworkOverrides(task: DownloadTask, remoteOutputDir = '') {
  const taskMeta = (task.metadata ?? {}) as Record<string, unknown>
  const taskHeaders =
    taskMeta.customHeaders && typeof taskMeta.customHeaders === 'object' && !Array.isArray(taskMeta.customHeaders)
      ? (taskMeta.customHeaders as Record<string, string>)
      : undefined
  return resolveTaskDownloadOverrides({
    remoteJobId: typeof taskMeta.remoteJobId === 'string' ? taskMeta.remoteJobId : '',
    remoteOutputDir,
    taskOutputDir: typeof taskMeta.outputDir === 'string' ? taskMeta.outputDir : '',
    taskProxyUrl: typeof taskMeta.proxyUrl === 'string' ? taskMeta.proxyUrl : '',
    taskHeaders,
    settingsDownloadDir: settings.get('downloadDir'),
    settingsProxyUrl: settings.get('proxyUrl')
  })
}

function resolveTaskOutputDir(task: DownloadTask, remoteOutputDir = ''): string {
  const storedRecord = db.getDownload(task.id)
  const persistedOutputDir = storedRecord
    ? metadataFromRecord(storedRecord).ownedOutputRoot
    : undefined
  if (typeof persistedOutputDir === 'string' && isAbsolute(persistedOutputDir.trim())) {
    return resolvePath(persistedOutputDir.trim())
  }
  const taskMeta = task.metadata as Record<string, unknown> | undefined
  const playlistSubfolder = settings.get('playlistSubfolder')
  const archiveByAuthor = settings.get('archiveByAuthor')
  const isProfilePick = taskMeta?.douyinProfilePick === true
  const sanitizedPlaylistId = task.playlistId?.replace(/[/\\?*:|"<>]/g, '-') ?? null
  const resolved = resolveTaskNetworkOverrides(task, remoteOutputDir)
  return resolvePath(composeDownloadOutputDir({
    downloadDir: isRemoteJobTask(taskMeta) ? settings.get('downloadDir') : resolved.outputDir,
    archiveByAuthor,
    folderNameTemplate: settings.get('folderNameTemplate'),
    playlistSubfolder,
    playlistFolder: sanitizedPlaylistId,
    remoteOutputDir: remoteOutputDir || null,
    skipPlaylistFolder: Boolean(isProfilePick && archiveByAuthor),
    values: templateValuesForTask(task)
  }))
}

function writerOutputNameForTask(task: { id: string; url: string; title: string; metadata?: Record<string, unknown> }, ext: string): string {
  const values = templateValuesForTask(task)
  return resolveWriterOutputName({
    filenameTemplate: settings.get('filenameTemplate'),
    title: values.title,
    id: values.id,
    author: values.author,
    site: values.site,
    ext
  })
}

function writerBasenameForTask(task: { id: string; url: string; title: string; metadata?: Record<string, unknown> }): string {
  return renderConcreteBasename(settings.get('filenameTemplate'), templateValuesForTask(task))
}

function writerOutputRelativePathForTask(task: { id: string; url: string; title: string; metadata?: Record<string, unknown> }): string {
  return writerBasenameForTask(task).replace(/\\/g, '/')
}

async function tryAdoptExistingDouyinOutput(task: DownloadTask, outDir: string): Promise<boolean> {
  if (!isDouyinUrl(task.url)) return false
  const taskMeta = task.metadata as Record<string, unknown> | undefined
  const imageUrls = taskMeta?.douyinImageUrls as string[] | undefined
  if (imageUrls && imageUrls.length > 0) return false

  const outputPath = join(outDir, writerOutputNameForTask(task, 'mp4'))
  try {
    const st = await stat(outputPath)
    if (isTaskAborted(task.id)) return false
    if (!st.isFile() || st.size < MIN_DOUYIN_OUTPUT_BYTES) return false
    task.filePath = outputPath
    const note = writeTaskNote(task, 'sidecar', outputPath)
    if (note) await persistTaskOutputIdentity(task.id, outDir, 'ownedOutputFiles', note.path, note.identity)
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
  proxyUrl?: string
  candidate?: Record<string, unknown>
  /** Skip URL reuse so a remote API job cannot attach to (or cancel) a desktop task. */
  forceNew?: boolean
}

export interface AdmitResult {
  task: DownloadTask
  outcome: 'created' | 'focused' | 'requeued' | 'retried'
  notice?: QueueNotice
}

let activeDownloads = new Map<string, { cancel: () => void; getStderr?: () => string; getDestinations?: () => string[] }>()
const activeTaskRuns = new Map<string, Promise<void>>()
/** Tasks the user removed/cancelled; in-flight runTask loops must exit without touching DB. */
const abortedTaskIds = new Set<string>()
const pendingRetryIds = new Set<string>()
const taskAbortControllers = new Map<string, AbortController>()
const thumbnailAbortControllers = new Map<string, AbortController>()
const pendingThumbnailTasks = new Set<string>()
const thumbnailQueue: Array<{ task: DownloadTask; options: AddTaskOptions; controller: AbortController }> = []
const activeThumbnailRuns = new Map<string, Promise<void>>()
let activeThumbnailExtracts = 0
const MAX_ACTIVE_THUMBNAIL_EXTRACTS = 2
const MAX_QUEUED_THUMBNAIL_EXTRACTS = 64
const taskExtraMeta = new Map<string, { mediaType?: string; referer?: string; customHeaders?: Record<string, string> }>()
const transcodeJobs = new Set<string>()
const transcodeAbortControllers = new Map<string, AbortController>()
const activeTranscodeRuns = new Map<string, Promise<void>>()
const taskSpeedBytes = new Map<string, number>()
const progressEmitLastAt = new Map<string, number>()
const PROGRESS_EMIT_MIN_MS = 400
let lastDockUpdateAt = 0
const DOCK_UPDATE_MIN_MS = 1000
let mainWindow: BrowserWindow | null = null
let stoppingDownloads = false

function shouldPreserveYtdlpStaging(taskId: string): boolean {
  const record = db.getDownload(taskId)
  return Boolean(
    record &&
    (record.status === 'paused' || record.status === 'error' || record.status === 'interrupted' ||
      (stoppingDownloads && record.status === 'downloading'))
  )
}

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
  thumbnailAbortControllers.get(id)?.abort()
}

function clearTaskAborted(id: string): void {
  abortedTaskIds.delete(id)
  disposeTaskAbortController(id)
}

function isTaskAborted(id: string): boolean {
  if (abortedTaskIds.has(id)) return true
  return !db.getDownload(id)
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

function writeTaskNote(
  task: DownloadTask,
  kind: 'gallery' | 'sidecar' | 'text',
  dest: string
): NoteFileWriteResult | null {
  if (!shouldWriteNote(task.metadata as Record<string, unknown> | undefined)) return null
  const fields = noteFieldsFromMetadata(task.metadata, {
    title: task.title,
    url: task.url,
    author: typeof task.metadata?.channel === 'string' ? task.metadata.channel : '',
  })
  if (!hasNoteBody(fields) && !fields.url.trim()) return null
  if (kind === 'text' && !hasNoteBody(fields)) return null
  const path = noteFilePath(kind, dest, fields.title || task.title)
  try {
    return writeNoteMarkdownFile(path, fields)
  } catch (error) {
    console.warn('[downloadManager] could not write note sidecar:', error instanceof Error ? error.message : error)
    return null
  }
}

function setTaskError(task: DownloadTask, message: string, code?: DownloadErrorCode): void {
  task.status = 'error'
  task.error = sanitizeResolverError(message)
  task.errorCode = code ?? classifyDownloadError(task.error, ytdlp.isValidYouTubeUrl(task.url))
  task.updatedAt = new Date().toISOString()
  db.updateDownload(task.id, { status: 'error', error: task.error, error_code: task.errorCode, progress: task.progress })
}

function emitToRenderer(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, data)
  }
}

export function emitInfoResolveResult(data: unknown): void {
  emitToRenderer('info-resolve-result', data)
}

function localizedNotice(notice?: QueueNotice): QueueNotice | undefined {
  return localizeQueueNotice(notice, getUiLanguage())
}

export function emitQueueAdmission(result: AdmitResult): void {
  emitToRenderer('queue-admission', {
    data: result.task,
    outcome: result.outcome,
    notice: localizedNotice(result.notice)
  })
}

const INTERNAL_OUTPUT_OWNERSHIP_FIELDS = [
  'nativePlaylistOwnedPaths',
  'nativePlaylistPublishJournal',
  'ownedOutputPublishJournal',
  'ownedOutputFiles',
  'ownedOutputDirs',
  'ownedOutputRoot'
] as const

function stripOutputOwnershipMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...metadata }
  for (const key of INTERNAL_OUTPUT_OWNERSHIP_FIELDS) delete clean[key]
  return clean
}

function stripUntrustedTaskMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const clean = stripOutputOwnershipMetadata(metadata)
  delete clean.remoteResolvedPlaylist
  return clean
}

function serializeExtras(metadata?: Record<string, unknown>): string | null {
  return serializePersistedExtras(metadata ? stripOutputOwnershipMetadata(metadata) : undefined)
}

function serializeOwnedExtras(metadata?: Record<string, unknown>): string | null {
  return serializePersistedExtras(metadata)
}

function serializeTaskExtrasPreservingOwnership(taskId: string, metadata?: Record<string, unknown>): string | null {
  const current = db.getDownload(taskId)
  const trusted = current ? metadataFromRecord(current) : {}
  const merged = stripOutputOwnershipMetadata(metadata ?? {})
  for (const key of INTERNAL_OUTPUT_OWNERSHIP_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(trusted, key)) merged[key] = trusted[key]
  }
  return serializeOwnedExtras(merged)
}

function serializePersistedExtras(metadata?: Record<string, unknown>): string | null {
  const out = pickPersistedExtras(metadata)
  return Object.keys(out).length ? JSON.stringify(out) : null
}

function hasIdentityOwnershipState(metadata: Record<string, unknown>): boolean {
  return INTERNAL_OUTPUT_OWNERSHIP_FIELDS.some((key) => Object.prototype.hasOwnProperty.call(metadata, key))
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
  delete metadata.nativePlaylistOwnedPaths
  delete metadata.nativePlaylistPublishJournal
  delete metadata.ownedOutputPublishJournal
  delete metadata.ownedOutputFiles
  delete metadata.ownedOutputDirs
  delete metadata.ownedOutputRoot
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
    // Node emits `close` after `error`; resolving on `error` can release the
    // queue slot while inherited pipes or descendants still keep the process alive.
    proc.once('close', (code, signal) => resolve({ code, signal }))
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

  const summary = db.getDownloadProgressSummary()
  const avgProgress = summary.total > 0 ? summary.progress / summary.total : 0
  dockProgress.updateProgress(avgProgress, totalSpeed, summary.active)
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

  let galleryOutputDir: string | null = null
  let claimedVideoPath: string | null = null
  try {
    console.log(
      `[runTask] Douyin direct${options?.profilePick ? ' (profile pick)' : ''} id=${task.id.slice(0, 8)}`
    )
    const requestedVideoPath = join(outDir, `${writerOutputRelativePathForTask(task)}.mp4`)
    let safeVideoPath = await chooseSafeOutputPath(requestedVideoPath, task.id)
    const fetchOpts = {
      signal: getTaskAbortSignal(task.id),
      proxyUrl: resolveTaskNetworkOverrides(task, typeof task.metadata?.remoteOutputDir === 'string' ? task.metadata.remoteOutputDir : '').proxyUrl
    }
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
      galleryOutputDir = await chooseSafeOutputPath(join(dirname(safeVideoPath), basename(safeVideoPath, '.mp4')), task.id, true)
      galleryOutputDir = await claimExclusiveOutputDirectory(galleryOutputDir, task.id, outDir)
      filePath = await downloadDouyinImageGallery(
        douyinInfo.imageUrls,
        dirname(galleryOutputDir),
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
        { ...fetchOpts, outputBasename: basename(galleryOutputDir) }
      )
    } else {
      const videoInfo = await enrichDouyinVideoPlayUrls(douyinInfo, cookiesPath || undefined, fetchOpts)
      if (isTaskAborted(task.id)) return true
      safeVideoPath = await claimExclusiveOutputFile(safeVideoPath, task.id, outDir)
      claimedVideoPath = safeVideoPath
      filePath = await downloadDouyinVideo(
        videoInfo.videoUrl,
        dirname(safeVideoPath),
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
        { ...fetchOpts, outputBasename: basename(safeVideoPath, '.mp4') }
      )
    }

    if (isTaskAborted(task.id)) {
      if (galleryOutputDir) await removeTaskOwnedOutput(task.id, outDir, 'ownedOutputDirs', galleryOutputDir)
      if (claimedVideoPath) await removeTaskOwnedOutput(task.id, outDir, 'ownedOutputFiles', claimedVideoPath)
      return true
    }

    const st = await stat(filePath)
    const isGalleryOutput = isDouyinGallery(douyinInfo)
    if (isGalleryOutput) {
      if (!st.isDirectory()) throw new Error('Douyin gallery output directory is missing')
    } else if (!st.isFile() || st.size < MIN_DOUYIN_OUTPUT_BYTES) {
      throw new Error('Douyin media response produced an empty or incomplete file')
    }
    const fileSize: number | null = st.isFile() ? st.size : null
    task.filePath = filePath
    if (st.isFile()) await persistTaskOutputOwnership(task.id, outDir, 'ownedOutputFiles', [filePath])
    const note = writeTaskNote(task, 'sidecar', filePath)
    if (note) await persistTaskOutputIdentity(task.id, outDir, 'ownedOutputFiles', note.path, note.identity)
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
    if (galleryOutputDir) await removeTaskOwnedOutput(task.id, outDir, 'ownedOutputDirs', galleryOutputDir)
    if (claimedVideoPath) await removeTaskOwnedOutput(task.id, outDir, 'ownedOutputFiles', claimedVideoPath)
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
  if (pendingThumbnailTasks.has(task.id)) return
  if (thumbnailQueue.length >= MAX_QUEUED_THUMBNAIL_EXTRACTS) return
  const controller = new AbortController()
  pendingThumbnailTasks.add(task.id)
  thumbnailAbortControllers.set(task.id, controller)
  thumbnailQueue.push({ task, options, controller })
  pumpThumbnailQueue()
}

function pumpThumbnailQueue(): void {
  while (activeThumbnailExtracts < MAX_ACTIVE_THUMBNAIL_EXTRACTS && thumbnailQueue.length > 0) {
    const job = thumbnailQueue.shift()!
    const id = job.task.id
    const row = db.getDownload(id)
    if (job.controller.signal.aborted || !row || row.status === 'cancelled') {
      pendingThumbnailTasks.delete(id)
      if (thumbnailAbortControllers.get(id) === job.controller) thumbnailAbortControllers.delete(id)
      continue
    }
    activeThumbnailExtracts += 1
    let run!: Promise<void>
    run = (async () => {
      try {
        const dataUrl = await ffmpegDownload.extractStreamThumbnailAsDataUrl({
          url: job.task.url,
          mediaType: job.options.mediaType,
          referer: job.options.referer,
          customHeaders: job.options.customHeaders,
          signal: job.controller.signal
        })
        if (!dataUrl || job.controller.signal.aborted) return
        const current = db.getDownload(id)
        if (!current || current.thumbnail?.trim() || current.status === 'cancelled') return
        db.updateDownload(id, { thumbnail: dataUrl })
        const updated = db.getDownload(id)
        if (updated) emitThumbnailRefresh(taskFromRecord(updated))
      } catch (e) {
        console.warn('[thumbnail] extract failed:', e instanceof Error ? e.message : e)
      } finally {
        activeThumbnailExtracts -= 1
        pendingThumbnailTasks.delete(id)
        if (thumbnailAbortControllers.get(id) === job.controller) thumbnailAbortControllers.delete(id)
        if (activeThumbnailRuns.get(id) === run) activeThumbnailRuns.delete(id)
        pumpThumbnailQueue()
      }
    })()
    activeThumbnailRuns.set(id, run)
  }
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
  const updated = db.getDownload(record.id)
  const task = taskFromRecord(updated ?? { ...record, status: 'queued', progress: 0, file_path: null, file_size: null, error: null })
  emitProgress(task, {}, { force: true })
  processQueue()
  return task
}

function admitExistingTask(url: string, forceNew?: boolean): AdmitResult | null {
  if (forceNew) return null
  const candidate = findReusableDownload(db.getDownloadAdmissionCandidates(), url)
  const reusable = candidate ? db.getDownload(candidate.id) : undefined
  if (!reusable) return null
  const decision = decideQueueAdmission({
    existing: reusable,
    filePresent: outputFilePresent(reusable.file_path)
  })
  if (decision.action === 'create') return null
  if (decision.action === 'requeue') {
    return { task: requeueMissingOutput(reusable), outcome: 'requeued', notice: localizedNotice(decision.notice) }
  }
  if (decision.action === 'retry') {
    const retried = retryTask(reusable.id)
    const updated = db.getDownload(reusable.id)
    return {
      task: taskFromRecord(updated ?? reusable),
      outcome: retried ? 'retried' : 'focused',
      notice: localizedNotice(decision.notice)
    }
  }
  return { task: taskFromRecord(reusable), outcome: 'focused', notice: localizedNotice(decision.notice) }
}

export function addTaskAdmitted(options: AddTaskOptions): AdmitResult {
  const admitted = admitExistingTask(options.url, options.forceNew)
  if (admitted) return admitted
  return { task: insertQueuedTask(options), outcome: 'created' }
}

export function addTask(options: AddTaskOptions): DownloadTask {
  return addTaskAdmitted(options).task
}

/** Add a resolver-confirmed multi-entry page as one yt-dlp playlist task. */
export function addResolvedMultiOutputTask(options: AddTaskOptions): DownloadTask {
  return insertQueuedTask(options, true)
}

function insertQueuedTask(options: AddTaskOptions, resolvedMultiOutput = false): DownloadTask {
  const id = uuidv4()
  const quality = options.quality ?? settings.get('defaultVideoQuality')

  const mergedMetadata: Record<string, unknown> = stripUntrustedTaskMetadata({
    ...(options.metadata ?? {}),
    ...(options.mediaType ? { mediaType: options.mediaType } : {}),
    ...(options.referer ? { referer: options.referer } : {}),
    ...(options.customHeaders ? { customHeaders: options.customHeaders } : {}),
    ...(options.candidate ? { candidate: options.candidate } : {}),
    ...extrasFromTaskOverrides({
      outputDir: options.outputDir,
      proxyUrl: options.proxyUrl,
      customHeaders: options.customHeaders
    })
  })
  if (resolvedMultiOutput) mergedMetadata.remoteResolvedPlaylist = true

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
  forceNew?: boolean
}

export interface PromoteInfoResolveOptions {
  url?: string
  title?: string
  format: string
  quality?: string
  outputDir?: string
  thumbnail?: string
  duration?: number
  metadata?: Record<string, unknown>
  mediaType?: string
  referer?: string
  customHeaders?: Record<string, string>
  proxyUrl?: string
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

async function persistTaskOutputIdentity(
  taskId: string,
  outputDir: string,
  key: 'ownedOutputFiles' | 'ownedOutputDirs',
  path: string,
  identity: PersistedOutputIdentity
): Promise<void> {
  if (!isPathInside(outputDir, path)) return
  const relativePath = relative(outputDir, path)
  if (!relativePath || relativePath.length > 4096) return
  const record = db.getDownload(taskId)
  if (!record) return
  const extras = metadataFromRecord(record)
  extras.ownedOutputRoot = outputDir
  const existing = Array.isArray(extras[key]) ? extras[key] as unknown[] : []
  const entry: PersistedOwnedOutput = { path: relativePath, ...identity }
  const entries = existing.filter((value): value is PersistedOwnedOutput => Boolean(
    value && typeof value === 'object' && !Array.isArray(value) &&
    typeof (value as PersistedOwnedOutput).path === 'string' &&
    typeof (value as PersistedOwnedOutput).dev === 'string' &&
    typeof (value as PersistedOwnedOutput).ino === 'string'
  ))
  extras[key] = [...entries.filter((value) => value.path !== relativePath), entry]
  const serialized = serializeOwnedExtras(extras)
  if (!serialized) throw new Error('Output ownership metadata could not be serialized')
  let normalized: Record<string, unknown>
  try {
    normalized = JSON.parse(serialized) as Record<string, unknown>
  } catch {
    throw new Error('Output ownership metadata could not be verified after serialization')
  }
  const persisted = Array.isArray(normalized[key]) ? normalized[key] as PersistedOwnedOutput[] : []
  if (!persisted.some((value) => (
    value.path === relativePath &&
    value.dev === identity.dev &&
    value.ino === identity.ino &&
    value.birthtimeNs === identity.birthtimeNs &&
    (value.size === undefined ? key === 'ownedOutputDirs' : value.size === identity.size)
  ))) {
    throw new Error('Output ownership metadata exceeded its safe storage limit')
  }
  db.updateDownload(taskId, { extras: serialized })
}

async function persistLegacyRecordFileOwnership(
  record: db.DownloadRecord,
  outputDir: string
): Promise<boolean> {
  const extras = metadataFromRecord(record)
  if (hasIdentityOwnershipState(extras) || !record.file_path || !isAbsolute(record.file_path)) return false
  const path = resolvePath(record.file_path)
  if (!isPathInside(outputDir, path)) return false
  try {
    const st = await lstat(path, { bigint: true })
    if (!st.isFile() || st.isSymbolicLink()) return false
    const identity = outputIdentityFromStat(st)
    await persistTaskOutputIdentity(record.id, outputDir, 'ownedOutputFiles', path, identity)
    const updated = db.getDownload(record.id)
    if (!updated) return false
    const updatedExtras = metadataFromRecord(updated)
    const relativePath = relative(outputDir, path)
    const entries = Array.isArray(updatedExtras.ownedOutputFiles)
      ? updatedExtras.ownedOutputFiles as PersistedOwnedOutput[]
      : []
    return entries.some((entry) => entry.path === relativePath && sameOutputIdentity(entry, identity))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function persistTaskOutputRoot(taskId: string, outputDir: string): void {
  const record = db.getDownload(taskId)
  if (!record || !isAbsolute(outputDir)) return
  const extras = metadataFromRecord(record)
  const current = typeof extras.ownedOutputRoot === 'string' ? extras.ownedOutputRoot : ''
  if (current && resolvePath(current) === resolvePath(outputDir)) return
  extras.ownedOutputRoot = resolvePath(outputDir)
  db.updateDownload(taskId, { extras: serializeOwnedExtras(extras) })
}

async function persistTaskOutputOwnership(
  taskId: string,
  outputDir: string,
  key: 'ownedOutputFiles' | 'ownedOutputDirs',
  paths: string[]
): Promise<void> {
  for (const path of paths) {
    if (!isPathInside(outputDir, path)) continue
    try {
      const st = await lstat(path, { bigint: true })
      if (st.isSymbolicLink()) continue
      if (key === 'ownedOutputFiles' ? !st.isFile() : !st.isDirectory()) continue
      await persistTaskOutputIdentity(taskId, outputDir, key, path, outputIdentityFromStat(st))
    } catch {
      /* an output that was never created is not an owned path */
    }
  }
}

async function removeTaskOwnedOutput(
  taskId: string,
  outputDir: string,
  key: 'ownedOutputFiles' | 'ownedOutputDirs',
  path: string
): Promise<boolean> {
  if (!isPathInside(outputDir, path)) return false
  const relativePath = relative(outputDir, path)
  const record = db.getDownload(taskId)
  if (!relativePath || !record) return false
  const extras = metadataFromRecord(record)
  const entries = Array.isArray(extras[key]) ? extras[key] as PersistedOwnedOutput[] : []
  const owned = entries.find((entry) => entry?.path === relativePath)
  if (!owned?.dev || !owned.ino) return false
  try {
    const [st, rootReal, pathReal] = await Promise.all([
      lstat(path, { bigint: true }),
      realpath(outputDir),
      realpath(path)
    ])
    const expectedTypeMatches = key === 'ownedOutputFiles'
      ? st.isFile()
      : st.isDirectory()
    if (
      !expectedTypeMatches || st.isSymbolicLink() ||
      !outputIdentityMatches(st, owned) || !isPathInside(rootReal, pathReal)
    ) return false
    if (key === 'ownedOutputFiles') await unlink(path)
    else await rm(path, { recursive: true, force: true })
    const latest = db.getDownload(taskId)
    if (latest) {
      const latestExtras = metadataFromRecord(latest)
      const latestEntries = Array.isArray(latestExtras[key]) ? latestExtras[key] as PersistedOwnedOutput[] : []
      latestExtras[key] = latestEntries.filter((entry) => entry.path !== relativePath)
      db.updateDownload(taskId, { extras: serializeOwnedExtras(latestExtras) })
    }
    return true
  } catch {
    return false
  }
}

async function claimExclusiveOutputFile(path: string, taskId: string, outputDir: string): Promise<string> {
  let candidate = path
  for (let attempt = 0; attempt < 1000; attempt++) {
    if (!isPathInside(outputDir, candidate)) throw new Error('Output path escaped its configured directory')
    await mkdir(dirname(candidate), { recursive: true })
    let handle: Awaited<ReturnType<typeof open>> | null = null
    try {
      handle = await open(candidate, 'wx')
      const st = await handle.stat({ bigint: true })
      await handle.close()
      handle = null
      await persistTaskOutputIdentity(taskId, outputDir, 'ownedOutputFiles', candidate, outputIdentityFromStat(st))
      return candidate
    } catch (error) {
      if (handle) await handle.close().catch(() => {})
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      releaseOutputPathReservation(candidate, taskId)
      candidate = await chooseSafeOutputPath(path, taskId)
    }
  }
  throw new Error('Could not reserve a unique output file path')
}

async function claimExclusiveOutputDirectory(path: string, taskId: string, outputDir: string): Promise<string> {
  let candidate = path
  for (let attempt = 0; attempt < 1000; attempt++) {
    if (!isPathInside(outputDir, candidate)) throw new Error('Output directory escaped its configured root')
    await mkdir(dirname(candidate), { recursive: true })
    try {
      await mkdir(candidate)
      const st = await lstat(candidate, { bigint: true })
      if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Output directory is not a regular directory')
      await persistTaskOutputIdentity(taskId, outputDir, 'ownedOutputDirs', candidate, outputIdentityFromStat(st))
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      releaseOutputPathReservation(candidate, taskId)
      candidate = await chooseSafeOutputPath(path, taskId, true)
    }
  }
  throw new Error('Could not reserve a unique output directory')
}

function persistNativePlaylistPublishJournal(
  taskId: string,
  outputDir: string,
  journal: NativePlaylistPublishEntry[]
): boolean {
  const record = db.getDownload(taskId)
  if (!record) return false
  const extras = metadataFromRecord(record)
  if (extras.nativeYoutubePlaylist !== true && extras.remoteResolvedPlaylist !== true) return false
  const existing = Array.isArray(extras.nativePlaylistPublishJournal)
    ? extras.nativePlaylistPublishJournal as NativePlaylistPublishEntry[]
    : []
  if (
    resolvePath(String(extras.ownedOutputRoot ?? outputDir)) === resolvePath(outputDir) &&
    JSON.stringify(existing) === JSON.stringify(journal) &&
    !Object.prototype.hasOwnProperty.call(extras, 'nativePlaylistOwnedPaths')
  ) return true
  extras.ownedOutputRoot = outputDir
  extras.nativePlaylistPublishJournal = journal
  delete extras.nativePlaylistOwnedPaths
  const serialized = serializeOwnedExtras(extras)
  if (!serialized || serialized.length > 4 * 1024 * 1024) return false
  try {
    const normalized = JSON.parse(serialized) as Record<string, unknown>
    if (!Array.isArray(normalized.nativePlaylistPublishJournal) || normalized.nativePlaylistPublishJournal.length !== journal.length) return false
  } catch {
    return false
  }
  db.updateDownload(taskId, { extras: serialized })
  return true
}

function persistOwnedOutputPublishJournal(
  taskId: string,
  outputDir: string,
  entry: OwnedOutputPublishEntry
): boolean {
  const record = db.getDownload(taskId)
  if (!record) return false
  const extras = metadataFromRecord(record)
  extras.ownedOutputRoot = outputDir
  const existing = Array.isArray(extras.ownedOutputPublishJournal)
    ? extras.ownedOutputPublishJournal as OwnedOutputPublishEntry[]
    : []
  const prior = existing.find((value) => value.sourcePath === entry.sourcePath)
  if (
    resolvePath(String(extras.ownedOutputRoot ?? outputDir)) === resolvePath(outputDir) &&
    prior && JSON.stringify(prior) === JSON.stringify(entry)
  ) return true
  const ownedFiles = Array.isArray(extras.ownedOutputFiles) ? extras.ownedOutputFiles as PersistedOwnedOutput[] : []
  const retained = existing.filter((value) => {
    if (value.sourcePath === entry.sourcePath) return false
    return !ownedFiles.some((owned) =>
      owned.path === value.destinationPath &&
      owned.dev === (value.destinationDev ?? value.sourceDev) &&
      owned.ino === (value.destinationIno ?? value.sourceIno)
    )
  })
  if (retained.length >= 8) return false
  extras.ownedOutputPublishJournal = [...retained, entry]
  const serialized = serializeOwnedExtras(extras)
  if (!serialized || serialized.length > 32 * 1024) return false
  try {
    const normalized = JSON.parse(serialized) as Record<string, unknown>
    if (!Array.isArray(normalized.ownedOutputPublishJournal) || !normalized.ownedOutputPublishJournal.some((value) =>
      Boolean(value && typeof value === 'object' && (value as Record<string, unknown>).sourcePath === entry.sourcePath)
    )) return false
  } catch {
    return false
  }
  db.updateDownload(taskId, { extras: serialized })
  return true
}

function withDestinationIdentity(
  entry: NativePlaylistPublishEntry,
  identity: PersistedOutputIdentity
): NativePlaylistPublishEntry {
  return {
    ...entry,
    destinationDev: identity.dev,
    destinationIno: identity.ino,
    destinationSize: identity.size,
    ...(identity.birthtimeNs ? { destinationBirthtimeNs: identity.birthtimeNs } : {}),
  }
}

function sourceIdentityForEntry(entry: NativePlaylistPublishEntry): PersistedOutputIdentity {
  return {
    dev: entry.sourceDev,
    ino: entry.sourceIno,
    size: entry.sourceSize,
    ...(entry.sourceBirthtimeNs ? { birthtimeNs: entry.sourceBirthtimeNs } : {}),
  }
}

function destinationIdentityForEntry(entry: NativePlaylistPublishEntry): PersistedOutputIdentity | null {
  if (entry.destinationDev && entry.destinationIno && entry.destinationSize) {
    return {
      dev: entry.destinationDev,
      ino: entry.destinationIno,
      size: entry.destinationSize,
      ...(entry.destinationBirthtimeNs ? { birthtimeNs: entry.destinationBirthtimeNs } : {}),
    }
  }
  return null
}

function persistOutputPublishEntry(
  taskId: string,
  outputDir: string,
  sourcePath: string,
  destinationPath: string,
  sourceIdentity: PersistedOutputIdentity,
  destinationIdentity: PersistedOutputIdentity = sourceIdentity
): boolean {
  if (
    !sourcePath || !destinationPath || isAbsolute(sourcePath) || isAbsolute(destinationPath) ||
    !isPathInside(outputDir, resolvePath(outputDir, sourcePath)) ||
    !isPathInside(outputDir, resolvePath(outputDir, destinationPath))
  ) return false
  const entry = withDestinationIdentity(
    createOutputPublishEntry(sourcePath, destinationPath, sourceIdentity),
    destinationIdentity
  )
  return persistOwnedOutputPublishJournal(taskId, outputDir, entry)
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
  const record = db.getDownload(id)
  return Boolean(record && isInfoResolveTaskRecord(record))
}

/** Clone a completed (or any) row into a new download, skipping adopt of the original file. */
export function downloadAgainFromId(id: string): AdmitResult | { error: string } {
  const record = db.getDownload(id)
  if (!record) return { error: 'Download not found' }

  const metadata: Record<string, unknown> = stripOutputOwnershipMetadata({
    ...metadataFromRecord(record),
    skipAdoptExisting: true
  })
  delete metadata.infoResolve
  delete metadata.resolveAutoStart
  delete metadata.resolveTitle
  delete metadata.remoteJobId
  delete metadata.remoteOutputDir
  delete metadata.remoteResolvedPlaylist

  const mediaType = typeof metadata.mediaType === 'string' ? metadata.mediaType : undefined
  const referer = typeof metadata.referer === 'string' ? metadata.referer : undefined
  const customHeaders =
    metadata.customHeaders && typeof metadata.customHeaders === 'object' && !Array.isArray(metadata.customHeaders)
      ? metadata.customHeaders as Record<string, string>
      : undefined
  const outputDir = typeof metadata.outputDir === 'string' ? metadata.outputDir : undefined
  const proxyUrl = typeof metadata.proxyUrl === 'string' ? metadata.proxyUrl : undefined

  if (mediaType) {
    return addTaskAdmitted({
      url: record.url,
      title: record.title,
      format: record.format,
      quality: record.quality,
      thumbnail: record.thumbnail ?? undefined,
      duration: record.duration ?? undefined,
      mediaType,
      referer,
      customHeaders,
      outputDir,
      proxyUrl,
      forceNew: true,
      metadata
    })
  }

  return createInfoResolveTask({
    url: record.url,
    title: record.title,
    format: record.format,
    quality: record.quality,
    thumbnail: record.thumbnail ?? undefined,
    duration: record.duration ?? undefined,
    referer,
    customHeaders,
    forceNew: true,
    metadata
  })
}

/** Create the durable placeholder shown while the main-process resolver works. */
export function createInfoResolveTask(options: InfoResolveTaskOptions): AdmitResult {
  const admitted = admitExistingTask(options.url, options.forceNew)
  if (admitted) return admitted

  const id = uuidv4()
  const now = new Date().toISOString()
  const quality = options.quality ?? settings.get('defaultVideoQuality')
  const metadata: Record<string, unknown> = stripUntrustedTaskMetadata({
    ...(options.metadata ?? {}),
    infoResolve: true,
    ...(options.title?.trim() ? { resolveTitle: options.title.trim() } : {}),
    ...(options.referer ? { referer: options.referer } : {}),
    ...(options.customHeaders ? { customHeaders: options.customHeaders } : {})
  })
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
  return { task, outcome: 'created' }
}

export function markInfoResolveResolving(id: string): DownloadTask | null {
  const record = db.getDownload(id)
  if (!record || !isInfoResolveTaskRecord(record) || record.status === 'cancelled') return null
  db.updateDownload(id, { status: 'resolving', progress: 0, error: null, error_code: null })
  const updated = db.getDownload(id)
  if (!updated) return null
  const task = taskFromRecord(updated)
  emitProgress(task, {}, { force: true })
  return task
}

export function markInfoResolveReady(
  id: string,
  patch: { title?: string; thumbnail?: string | null; duration?: number | null; channel?: string | null } = {}
): DownloadTask | null {
  const record = db.getDownload(id)
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
  const updated = db.getDownload(id)
  if (!updated) return null
  const task = taskFromRecord(updated)
  emitProgress(task, {}, { force: true })
  return task
}

export function failInfoResolveTask(id: string, message: string): DownloadTask | null {
  const record = db.getDownload(id)
  if (!record || !isInfoResolveTaskRecord(record) || record.status === 'cancelled') return null
  const error = sanitizeResolverError(message)
  const errorCode = classifyDownloadError(error, ytdlp.isValidYouTubeUrl(record.url))
  db.updateDownload(id, { status: 'error', error, error_code: errorCode })
  const updated = db.getDownload(id)
  if (!updated) return null
  const task = taskFromRecord(updated)
  emitProgress(task, {}, { force: true })
  return task
}

/** Transition a resolver placeholder into the normal download queue without creating a second row. */
export function promoteInfoResolveTask(id: string, options: PromoteInfoResolveOptions): DownloadTask | null {
  const record = db.getDownload(id)
  if (!record || !isInfoResolveTaskRecord(record) || record.status === 'cancelled') return null

  const previous = metadataFromRecord(record)
  const metadata: Record<string, unknown> = {
    ...previous,
    ...(options.metadata ?? {}),
    ...(options.mediaType ? { mediaType: options.mediaType } : {}),
    ...(options.referer ? { referer: options.referer } : {}),
    ...(options.customHeaders ? { customHeaders: options.customHeaders } : {}),
    ...extrasFromTaskOverrides({
      outputDir: options.outputDir,
      proxyUrl: options.proxyUrl,
      customHeaders: options.customHeaders
    })
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
    extras: serializeTaskExtrasPreservingOwnership(id, metadata)
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
  const updated = db.getDownload(id)
  if (!updated) return null
  const task = taskFromRecord(updated)
  emitProgress(task, {}, { force: true })
  processQueue()
  return task
}

/** Used by the resolver manager after it has cancelled the in-flight worker. */
export function cancelInfoResolveTask(id: string): boolean {
  const record = db.getDownload(id)
  if (!record || !isInfoResolveTaskRecord(record)) return false
  db.updateDownload(id, { status: 'cancelled', error: 'Cancelled by user', error_code: null })
  const updated = db.getDownload(id)
  if (updated) emitProgress(taskFromRecord(updated), {}, { force: true })
  return true
}

/** Max tasks per bulk enqueue (matches profile picker load-all cap). */
export const MAX_BULK_TASKS = 2000

function buildTaskFromOptions(options: AddTaskOptions, id: string): DownloadTask {
  const quality = options.quality ?? settings.get('defaultVideoQuality')
  const mergedMetadata: Record<string, unknown> = stripUntrustedTaskMetadata({
    ...(options.metadata ?? {}),
    ...(options.mediaType ? { mediaType: options.mediaType } : {}),
    ...(options.referer ? { referer: options.referer } : {}),
    ...(options.customHeaders ? { customHeaders: options.customHeaders } : {}),
    ...(options.playlistTitle ? { playlistTitle: options.playlistTitle } : {}),
    ...extrasFromTaskOverrides({
      outputDir: options.outputDir,
      proxyUrl: options.proxyUrl,
      customHeaders: options.customHeaders
    })
  })
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
export function addTasksBulk(optionsList: AddTaskOptions[]): {
  count: number
  ids: string[]
  skipped: number
  notice?: QueueNotice
} {
  if (optionsList.length === 0) return { count: 0, ids: [], skipped: 0 }
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
  const retryRecords: db.DownloadRecord[] = []
  const seenKeys = new Set<string>()
  const existingByKey = indexReusableDownloads(db.getDownloadAdmissionCandidates())
  let skipped = 0

  for (const options of optionsList) {
    const key = queueIdentityKey(options.url)
    if (key && seenKeys.has(key)) {
      skipped += 1
      continue
    }
    const candidate = options.forceNew ? undefined : existingByKey.get(key)
    const reusable = candidate ? db.getDownload(candidate.id) : undefined
    if (reusable) {
      const decision = decideQueueAdmission({
        existing: reusable,
        filePresent: outputFilePresent(reusable.file_path)
      })
      if (decision.action === 'requeue') staleComplete.push(reusable)
      else if (decision.action === 'retry') retryRecords.push(reusable)
      else skipped += 1
      if (key) seenKeys.add(key)
      continue
    }
    if (key) seenKeys.add(key)
    acceptedOptions.push(options)
    const id = uuidv4()
    ids.push(id)
    const metadata: Record<string, unknown> = {
      ...stripUntrustedTaskMetadata(options.metadata ?? {}),
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

  if (records.length === 0 && staleComplete.length === 0 && retryRecords.length === 0) {
    return { count: 0, ids: [], skipped, notice: localizedNotice(bulkQueueNotice(skipped)) }
  }

  if (records.length > 0) {
    db.insertDownloadsBulk(records)
  }

  for (let i = 0; i < tasks.length; i++) {
    scheduleDirectMediaThumbnailIfNeeded(tasks[i]!, acceptedOptions[i]!)
  }

  const requeued = staleComplete.map((record) => requeueMissingOutput(record))
  const retried = retryRecords
    .map((record) => (retryTask(record.id) ? record.id : null))
    .filter((id): id is string => Boolean(id))
  worklog('bulk_enqueued', {
    count: tasks.length,
    profileBatch: isProfileBatch,
    requeued: requeued.length,
    retried: retried.length,
    skipped
  })
  if (tasks.length > 0) {
    emitToRenderer('download-progress', { bulkAdded: tasks.length })
  }
  processQueue()
  return {
    count: tasks.length + requeued.length + retried.length,
    ids: [...ids, ...requeued.map((task) => task.id), ...retried],
    skipped,
    notice: localizedNotice(bulkQueueNotice(skipped))
  }
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
    releaseOutputReservations(task.id)
    taskSpeedBytes.delete(task.id)
    progressEmitLastAt.delete(task.id)
    disposeTaskAbortController(task.id)
    updateDockProgress(true)
  }

  const stopIfAborted = (): boolean => {
    if (!isTaskAborted(task.id)) return false
    releaseSlot()
    if (!stoppingDownloads) processQueue()
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
  const taskMeta = task.metadata as Record<string, unknown> | undefined

  const qualityNum = parseInt(task.quality, 10) || 1080
  const remoteOutputDir = typeof taskMeta?.remoteOutputDir === 'string' ? taskMeta.remoteOutputDir.trim() : ''
  const outDir = resolveTaskOutputDir(task, remoteOutputDir)
  const taskStagingDir = stagingDirectoryForTask(outDir, task.id)
  persistTaskOutputRoot(task.id, outDir)
  if (await tryRecoverOwnedOutputPublish(task, outDir)) {
    await rm(taskStagingDir, { recursive: true, force: true }).catch(() => {})
    if (stopIfAborted()) return
    releaseSlot()
    processQueue()
    return
  }
  const cached = taskExtraMeta.get(task.id)
  const candidate = (taskMeta?.candidate && typeof taskMeta.candidate === 'object' ? taskMeta.candidate : null) as { url?: string; type?: string; protocol?: 'http' | 'https' | 'hls' | 'dash' | 'file' | 'unknown'; container?: string; mimeType?: string } | null
  const effectiveUrl = candidate?.url || task.url
  const mediaType = cached?.mediaType || (candidate ? mediaTypeForCandidate(candidate) : '') || (taskMeta?.mediaType as string) || undefined
  const referer = cached?.referer || (taskMeta?.referer as string) || undefined
  const resolvedNetwork = resolveTaskDownloadOverrides({
    remoteJobId: typeof taskMeta?.remoteJobId === 'string' ? taskMeta.remoteJobId : '',
    remoteOutputDir,
    taskOutputDir: typeof taskMeta?.outputDir === 'string' ? taskMeta.outputDir : '',
    taskProxyUrl: typeof taskMeta?.proxyUrl === 'string' ? taskMeta.proxyUrl : '',
    taskHeaders: cached?.customHeaders || (taskMeta?.customHeaders as Record<string, string> | undefined),
    settingsDownloadDir: settings.get('downloadDir'),
    settingsProxyUrl: settings.get('proxyUrl')
  })
  const customHeaders = resolvedNetwork.customHeaders
  const taskProxyUrl = resolvedNetwork.proxyUrl

  const skipAdoptExisting = taskMeta?.skipAdoptExisting === true

  if (!skipAdoptExisting && await tryAdoptExistingDouyinOutput(task, outDir)) {
    if (stopIfAborted()) return
    releaseSlot()
    processQueue()
    return
  }
  if (stopIfAborted()) return

  const douyinImageUrls = taskMeta?.douyinImageUrls as string[] | undefined
  const xhsImageUrls = taskMeta?.xhsImageUrls as string[] | undefined
  const galleryFetchOpts = {
    signal: getTaskAbortSignal(task.id),
    proxyUrl: taskProxyUrl
  }
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
    const galleryBase = writerOutputRelativePathForTask(task)
    const requestedGalleryDir = join(outDir, galleryBase)
    const reservedGalleryDir = await chooseSafeOutputPath(requestedGalleryDir, task.id, true)
    const galleryDir = await claimExclusiveOutputDirectory(reservedGalleryDir, task.id, outDir)
    try {
      const dir = await galleryDownloader(
        galleryImageUrls,
        dirname(galleryDir),
        task.title,
        cookiesPath || undefined,
        (pct) => {
          if (isTaskAborted(task.id)) return
          task.progress = pct
          task.updatedAt = new Date().toISOString()
          db.updateDownload(task.id, { status: 'downloading', progress: pct })
          updateDockProgress()
          emitProgress(task, {
            speed: '',
            eta: '',
            totalSize: null,
            phase: 'video',
          })
        },
        { ...galleryFetchOpts, outputBasename: basename(galleryDir) }
      )
      if (isTaskAborted(task.id)) {
        await removeTaskOwnedOutput(task.id, outDir, 'ownedOutputDirs', galleryDir)
        stopIfAborted()
        return
      }
      let fileSize: number | null = null
      try {
        const st = await stat(dir)
        if (st.isDirectory()) fileSize = null
      } catch {
        /* ignore */
      }
      const note = writeTaskNote(task, 'gallery', dir)
      if (note) await persistTaskOutputIdentity(task.id, outDir, 'ownedOutputFiles', note.path, note.identity)
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
      await removeTaskOwnedOutput(task.id, outDir, 'ownedOutputDirs', galleryDir)
      if (stopIfAborted() || isDouyinAbortError(e) || isXhsAbortError(e)) return
      task.progress = 0
      taskExtraMeta.delete(task.id)
      setTaskError(task, e instanceof Error ? e.message : String(e))
      emitProgress(task)
    }
    releaseSlot()
    processQueue()
    return
  }

  if (taskMeta?.noteOnly === true) {
    task.status = 'downloading'
    task.updatedAt = new Date().toISOString()
    db.updateDownload(task.id, { status: 'downloading', progress: 1 })
    emitProgress(task)
    if (!shouldWriteNote(taskMeta)) {
      setTaskError(task, 'This post has no video or images to download')
      emitProgress(task)
      releaseSlot()
      processQueue()
      return
    }
    const note = writeTaskNote(task, 'text', outDir)
    if (!note) {
      setTaskError(task, 'This post has no title or text to save')
      emitProgress(task)
      releaseSlot()
      processQueue()
      return
    }
    await persistTaskOutputIdentity(task.id, outDir, 'ownedOutputFiles', note.path, note.identity)
    task.filePath = note.path
    task.status = 'complete'
    task.progress = 100
    task.error = null
    task.errorCode = null
    task.updatedAt = new Date().toISOString()
    taskExtraMeta.delete(task.id)
    db.updateDownload(task.id, {
      status: 'complete',
      progress: 100,
      file_path: note.path,
      file_size: null,
      error: null,
      error_code: null
    })
    emitProgress(task)
    releaseSlot()
    processQueue()
    return
  }

  const nativeYoutube = taskMeta?.nativeYoutubePlaylist === true
  const useNativePlaylist =
    nativeYoutube && Boolean(task.playlistId) && ytdlp.isPlaylistUrl(task.url)
  const useResolvedRemotePlaylist =
    taskMeta?.remoteResolvedPlaylist === true && Boolean(task.playlistId) &&
    task.playlistId === taskMeta.remoteJobId
  const useMultiOutputPlaylist = useNativePlaylist || useResolvedRemotePlaylist
  const playlistSleep = useNativePlaylist ? settings.get('youtubePlaylistSleepRequests') : 0
  const playlistMax = useNativePlaylist ? settings.get('youtubePlaylistMaxDownloads') : 0

  const outputExtGuess =
    task.format === 'audio' || task.format === 'mp3' || mediaType === 'mp3'
      ? 'mp3'
      : mediaType === 'jpeg'
        ? 'jpg'
        : 'mp4'
  const expectedPath = join(outDir, writerOutputNameForTask(task, outputExtGuess))
  const finalPath = await chooseSafeOutputPath(expectedPath, task.id)
  if (stopIfAborted()) return
  const hasSpace = await hasWorkingDiskSpace(outDir)
  if (stopIfAborted()) return
  if (!hasSpace) {
    task.progress = 0
    setTaskError(task, 'Not enough free disk space to start download.', 'STORAGE_UNAVAILABLE')
    releaseSlot()
    processQueue()
    return
  }

  if (!skipAdoptExisting && !mediaType && !useMultiOutputPlaylist) {
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
    await mkdir(taskStagingDir, { recursive: true })
    const stagedRelativePath = relative(outDir, finalPath)
    const stagedPartPath = join(taskStagingDir, `${stagedRelativePath}.part`)
    await mkdir(dirname(stagedPartPath), { recursive: true })
    const fdp = ffmpegDownload.downloadDirectMediaWithFfmpeg({
      url: effectiveUrl,
      outputPath: stagedPartPath,
      mediaType,
      format: task.format,
      referer,
      customHeaders,
      proxyUrl: taskProxyUrl,
      durationSec: task.duration
    })
    workerCancel = fdp.cancel
    activeDownloads.set(task.id, {
      cancel: fdp.cancel,
      getStderr: fdp.getStderr,
      getDestinations: fdp.getDestinations
    })
    fdp.onProgress((progress) => {
      if (isTaskAborted(task.id)) return
      const pct = mergeMonotonicProgress(task, progress.percent)
      task.progress = pct
      task.status = 'downloading'
      task.updatedAt = new Date().toISOString()
      db.updateDownload(task.id, { status: 'downloading', progress: pct })

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
    if (fdp.waitForCleanup && !(await fdp.waitForCleanup())) {
      console.warn(`[runTask] ffmpeg process group still visible after cancellation id=${task.id.slice(0, 8)}`)
    }
    if (isTaskAborted(task.id)) {
      await unlink(stagedPartPath).catch(() => {})
      stopIfAborted()
      return
    }

    const isStale =
      !activeDownloads.has(task.id) || activeDownloads.get(task.id)?.cancel !== fdp.cancel

    if (isStale) {
      await unlink(stagedPartPath).catch(() => {})
      releaseSlot()
      processQueue()
      return
    }

    const current = db.getDownload(task.id)

    if (signal === 'SIGTERM' || signal === 'SIGKILL') {
      await unlink(stagedPartPath).catch(() => {})
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
      const updated = db.getDownload(task.id)
      if (updated) emitProgress(taskFromRecord(updated))
      releaseSlot()
      processQueue()
      return
    }

    let ffmpegOutputValidationError = ''
    if (code === 0 && current?.status !== 'paused') {
      const MIN_OUTPUT_BYTES = 512
      try {
        const st = await stat(stagedPartPath)
        if (st.isFile() && st.size >= MIN_OUTPUT_BYTES) {
          const validation = await fdp.validateOutput(
            stagedPartPath,
            { format: task.format, mediaType },
            getTaskAbortSignal(task.id)
          )
          if (fdp.waitForCleanup && !(await fdp.waitForCleanup())) {
            console.warn(`[runTask] ffprobe process group still visible after cancellation id=${task.id.slice(0, 8)}`)
          }
          if (validation.cancelled || isTaskAborted(task.id)) {
            await unlink(stagedPartPath).catch(() => {})
            stopIfAborted()
            return
          }
          if (!validation.valid) {
            ffmpegOutputValidationError = validation.error || 'FFmpeg output failed integrity validation'
          } else {
            let publishSourceIdentity: PersistedOutputIdentity | null = null
            const published = await publishStagedFile(
              taskStagingDir,
              stagedPartPath,
              outDir,
              task.id,
              MIN_OUTPUT_BYTES,
              {
                requestedPath: finalPath,
                beforePublish: async (destinationPath, sourceIdentity) => {
                  publishSourceIdentity = sourceIdentity
                  if (!persistOutputPublishEntry(
                    task.id,
                    outDir,
                    relative(outDir, stagedPartPath),
                    destinationPath,
                    sourceIdentity
                  )) throw new Error('Output ownership journal could not be persisted')
                },
                onDestinationIdentity: async (destinationPath, sourceIdentity, destinationIdentity) => {
                  if (!persistOutputPublishEntry(
                    task.id,
                    outDir,
                    relative(outDir, stagedPartPath),
                    destinationPath,
                    sourceIdentity,
                    destinationIdentity
                  )) throw new Error('Output ownership journal could not be persisted')
                }
              }
            )
            if (!published) throw new Error('Could not safely publish the FFmpeg output')
            const actualFinalPath = published.path
            await persistTaskOutputIdentity(task.id, outDir, 'ownedOutputFiles', actualFinalPath, published.identity)
            if (!persistOutputPublishEntry(
              task.id,
              outDir,
              relative(outDir, stagedPartPath),
              relative(outDir, actualFinalPath),
              publishSourceIdentity ?? published.identity,
              published.identity
            )) throw new Error('Output ownership journal could not be persisted')
            if (stopIfAborted()) {
              await removeTaskOwnedOutput(task.id, outDir, 'ownedOutputFiles', actualFinalPath)
              return
            }
            if (isTaskAborted(task.id)) {
              await removeTaskOwnedOutput(task.id, outDir, 'ownedOutputFiles', actualFinalPath)
              releaseSlot()
              if (!stoppingDownloads) processQueue()
              return
            }
            task.filePath = actualFinalPath
            const note = writeTaskNote(task, 'sidecar', actualFinalPath)
            if (note) await persistTaskOutputIdentity(task.id, outDir, 'ownedOutputFiles', note.path, note.identity)
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
        }
      } catch (error) {
        ffmpegOutputValidationError = error instanceof Error ? error.message : String(error)
      }
      await unlink(stagedPartPath).catch(() => {})
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
      const failure = ffmpegOutputValidationError
        ? `FFmpeg output validation failed: ${ffmpegOutputValidationError}`
        : stderrTail || (code !== 0 ? `ffmpeg exited with code ${code}` : 'ffmpeg produced no output file')
      setTaskError(task, failure)
      emitProgress(task)
      await unlink(stagedPartPath).catch(() => {})
      releaseSlot()
      processQueue()
      return
    }

    if (ffmpegOutputValidationError) {
      console.warn(`[runTask] ffmpeg output validation failed (fallback to yt-dlp): ${sanitizeResolverError(ffmpegOutputValidationError)}`)
    } else if (stderrTail) {
      console.warn(`[runTask] ffmpeg stderr tail (fallback to yt-dlp):\n${sanitizeResolverError(stderrTail)}`)
    } else {
      console.warn(`[runTask] ffmpeg failed (code=${code}); falling back to yt-dlp`)
    }
    await unlink(stagedPartPath).catch(() => {})
  }

  const externalDl = settings.get('ytdlpExternalDownloader')
  const retrySleeps = ytdlpRetrySleepsForSpeedMode(speedMode)

  const isProfilePick = taskMeta?.douyinProfilePick === true
  if (isProfilePick && isDouyinUrl(task.url)) {
    await runDouyinDirectDownload(task, outDir, cookiesPath || undefined, { profilePick: true })
    releaseSlot()
    processQueue()
    return
  }

  const poToken = ytdlp.isValidYouTubeUrl(effectiveUrl) && !mediaType
    ? await ensurePoTokenProvider()
    : { status: 'unavailable' as const }
  if (stopIfAborted()) return
  await mkdir(outDir, { recursive: true })
  const ytdlpStagingDir = taskStagingDir
  await mkdir(ytdlpStagingDir, { recursive: true })
  const ytdlpTempDir = join(ytdlpStagingDir, '.temp')
  if (stopIfAborted()) {
    if (!shouldPreserveYtdlpStaging(task.id)) await rm(ytdlpStagingDir, { recursive: true, force: true }).catch(() => {})
    return
  }
  let dp: ReturnType<typeof ytdlp.download>
  try {
    dp = ytdlp.download(
    {
      url: effectiveUrl,
      format: task.format,
      quality: qualityNum,
      outputDir: ytdlpStagingDir,
      tempDir: ytdlpTempDir,
      cookiesPath: cookiesPath || undefined,
      sleepInterval,
      isPlaylist: useMultiOutputPlaylist,
      youtubeNativePlaylist: useNativePlaylist,
      downloadWholePlaylist: useResolvedRemotePlaylist,
      playlistTitle: useMultiOutputPlaylist ? (task.playlistId ?? undefined) : undefined,
      playlistSleepRequests: playlistSleep,
      playlistMaxDownloads: playlistMax,
      referer,
      customHeaders,
      outputTitle: mediaType || skipAdoptExisting ? basename(finalPath, extname(finalPath)) : undefined,
      mediaType,
      concurrentFragments: concFragments > 1 ? concFragments : undefined,
      externalDownloader: externalDl || undefined,
      retrySleeps,
      extractorArgs: poToken.provider?.extractorArgs,
      pluginDir: poToken.provider?.pluginDir,
      proxyUrl: taskProxyUrl,
      filenameTemplate: settings.get('filenameTemplate'),
      limitRate: ytdlpLimitRateArgs(speedMode)[1]
    },
      ytdlpPath
    )
  } catch (error) {
    if (!shouldPreserveYtdlpStaging(task.id)) await rm(ytdlpStagingDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }

  workerCancel = dp.cancel
  activeDownloads.set(task.id, { cancel: dp.cancel, getStderr: dp.getStderr, getDestinations: dp.getDestinations })
  dp.onProgress((progress) => {
    if (isTaskAborted(task.id)) return
    const pct = mergeMonotonicProgress(task, progress.percent)
    task.progress = pct
    task.status = 'downloading'
    task.updatedAt = new Date().toISOString()
    db.updateDownload(task.id, { status: 'downloading', progress: pct })

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

  let stagingCleanup: Promise<void> | null = null
  const cleanupStaging = (): Promise<void> => {
    if (!stagingCleanup) {
      stagingCleanup = shouldPreserveYtdlpStaging(task.id)
        ? Promise.resolve()
        : rm(ytdlpStagingDir, { recursive: true, force: true }).catch(() => {})
    }
    return stagingCleanup
  }

  return new Promise<void>((resolvePromise) => {
    const resolve = (): void => {
      void cleanupStaging().finally(resolvePromise)
    }
    let processError: Error | null = null
    const handleClose = async (code: number | null, signal: NodeJS.Signals | null): Promise<void> => {
      try {
      if (dp.waitForCleanup && !(await dp.waitForCleanup())) {
        console.warn(`[runTask] yt-dlp process group still visible after cancellation id=${task.id.slice(0, 8)}`)
      }
      if (isTaskAborted(task.id)) {
        releaseSlot()
        resolve()
        if (!stoppingDownloads) processQueue()
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

      const current = db.getDownload(task.id)
      console.log(`[close] id=${task.id.slice(0,8)} dbStatus=${current?.status}`)

      if (processError) {
        setTaskError(task, processError.message)
        emitProgress(task)
        releaseSlot()
        resolve()
        if (!stoppingDownloads) processQueue()
        return
      }

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
        const updated = db.getDownload(task.id)
        if (updated) emitProgress(taskFromRecord(updated))
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
        if (isTaskAborted(task.id)) {
          releaseSlot()
          resolve()
          if (!stoppingDownloads) processQueue()
          return
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

      if (useMultiOutputPlaylist) {
        let totalBytes = 0
        let outputCount = 0
        const finalPaths = dp.getFinalDestinations?.() ?? []
        const reportedOutputs = finalPaths.length > 0
          ? finalPaths
          : (dp.getDestinations?.() ?? []).filter((reportedPath) => !/\.f\d+\.[^/\\]+$/i.test(reportedPath))
        // yt-dlp's output-path collection is intentionally bounded. When it
        // reaches that boundary, more entries may have been omitted, so retain
        // staging and report an error instead of claiming a partial success.
        let publishFailed = reportedOutputs.length >= MAX_PERSISTED_PLAYLIST_OUTPUTS ||
          dp.hasIncompleteOutputPathMetadata?.() === true
        const storedRecord = db.getDownload(task.id)
        const storedExtras = storedRecord ? metadataFromRecord(storedRecord) : {}
        const journal: NativePlaylistPublishEntry[] = Array.isArray(storedExtras.nativePlaylistPublishJournal)
          ? (storedExtras.nativePlaylistPublishJournal as NativePlaylistPublishEntry[])
              .filter((entry) => entry && typeof entry.sourcePath === 'string' && typeof entry.destinationPath === 'string' &&
                typeof entry.sourceDev === 'string' && typeof entry.sourceIno === 'string' && typeof entry.sourceSize === 'string')
          : []
        const journalBySource = new Map<string, NativePlaylistPublishEntry[]>()
        for (const entry of journal) {
          const entries = journalBySource.get(entry.sourcePath) ?? []
          entries.push(entry)
          journalBySource.set(entry.sourcePath, entries)
        }
        const planned: Array<{ sourcePath: string; sourceRelative: string; entry: NativePlaylistPublishEntry }> = []
        const seenReportedPaths = new Set<string>()
        for (const reportedPath of reportedOutputs) {
          const outputPath = resolveReportedPath(ytdlpStagingDir, reportedPath)
          if (!outputPath || seenReportedPaths.has(outputPath)) continue
          seenReportedPaths.add(outputPath)
          const sourceRelative = relative(resolvePath(ytdlpStagingDir), resolvePath(outputPath))
          if (!sourceRelative || sourceRelative.startsWith('..') || isAbsolute(sourceRelative)) {
            publishFailed = true
            continue
          }
          const journaledEntries = journalBySource.get(sourceRelative) ?? []
          let alreadyPublished = false
          for (const prior of [...journaledEntries].reverse()) {
            if (isAbsolute(prior.destinationPath) || !isPathInside(outDir, resolvePath(outDir, prior.destinationPath))) continue
            const identity = destinationIdentityForEntry(prior) ?? sourceIdentityForEntry(prior)
            try {
              const destination = resolvePath(outDir, prior.destinationPath)
              const [st, pathReal, rootReal] = await Promise.all([
                lstat(destination, { bigint: true }), realpath(destination), realpath(outDir)
              ])
              if (
                st.isFile() && !st.isSymbolicLink() && st.size >= BigInt(MIN_YTDLP_OUTPUT_BYTES) &&
                outputIdentityMatches(st, identity, true) && isPathInside(rootReal, pathReal)
              ) {
                outputCount += 1
                totalBytes += Number(st.size)
                alreadyPublished = true
                break
              }
            } catch {
              /* a journaled destination may be missing after an interrupted publish */
            }
          }
          if (alreadyPublished) continue

          let sourceStat: BigIntStats | null = null
          try { sourceStat = await lstat(outputPath, { bigint: true }) } catch { sourceStat = null }
          if (!sourceStat?.isFile() || sourceStat.isSymbolicLink() || sourceStat.size < BigInt(MIN_YTDLP_OUTPUT_BYTES)) {
            publishFailed = true
            continue
          }

          const sourceIdentity = outputIdentityFromStat(sourceStat)
          let journalEntry = journaledEntries.find((entry) =>
            outputIdentityMatches(sourceStat!, sourceIdentityForEntry(entry), true)
          )
          const requestedPath = resolvePath(outDir, sourceRelative)
          if (!isPathInside(outDir, requestedPath)) {
            publishFailed = true
            continue
          }
          if (!journalEntry) {
            if (journal.length >= MAX_PERSISTED_PLAYLIST_OUTPUTS) {
              publishFailed = true
              continue
            }
            const selectedPath = await chooseSafeOutputPath(requestedPath, task.id)
            const destinationPath = relative(outDir, selectedPath)
            if (!destinationPath || isAbsolute(destinationPath) || !isPathInside(outDir, resolvePath(outDir, destinationPath))) {
              publishFailed = true
              continue
            }
            journalEntry = {
              sourcePath: sourceRelative,
              destinationPath,
              sourceDev: sourceIdentity.dev,
              sourceIno: sourceIdentity.ino,
              sourceSize: sourceIdentity.size,
              ...(sourceIdentity.birthtimeNs ? { sourceBirthtimeNs: sourceIdentity.birthtimeNs } : {}),
              destinationDev: sourceIdentity.dev,
              destinationIno: sourceIdentity.ino,
              destinationSize: sourceIdentity.size,
              ...(sourceIdentity.birthtimeNs ? { destinationBirthtimeNs: sourceIdentity.birthtimeNs } : {}),
            }
            journal.push(journalEntry)
            journaledEntries.push(journalEntry)
            journalBySource.set(sourceRelative, journaledEntries)
          } else {
            const existingDestination = resolvePath(outDir, journalEntry.destinationPath)
            let destinationMatches = false
            try {
              const [st, pathReal, rootReal] = await Promise.all([
                lstat(existingDestination, { bigint: true }), realpath(existingDestination), realpath(outDir)
              ])
              destinationMatches = st.isFile() && !st.isSymbolicLink() &&
                outputIdentityMatches(st, destinationIdentityForEntry(journalEntry) ?? sourceIdentityForEntry(journalEntry), true) &&
                isPathInside(rootReal, pathReal)
            } catch {
              /* retry the same intent when its destination is absent */
            }
            if (destinationMatches) {
              outputCount += 1
              totalBytes += Number(sourceStat.size)
              continue
            }
            await removeFileIfIdentityMatches(
              outDir,
              existingDestination,
              destinationIdentityForEntry(journalEntry) ?? sourceIdentityForEntry(journalEntry)
            )
            releaseOutputPathReservation(existingDestination, task.id)
            const selectedPath = await chooseSafeOutputPath(requestedPath, task.id)
            const replacement = withDestinationIdentity({
              ...journalEntry,
              destinationPath: relative(outDir, selectedPath),
            }, sourceIdentity)
            Object.assign(journalEntry, replacement)
            persistNativePlaylistPublishJournal(task.id, outDir, journal)
          }
          planned.push({ sourcePath: outputPath, sourceRelative, entry: journalEntry })
        }

        // Persist source identity and the expected no-clobber destination identity
        // before publication. A crash can then recover only the exact file inode.
        if (!persistNativePlaylistPublishJournal(task.id, outDir, journal)) {
          task.progress = 0
          setTaskError(task, 'Playlist ownership metadata exceeds the safe storage limit.', 'STORAGE_UNAVAILABLE')
          emitProgress(task)
          releaseSlot()
          resolve()
          if (!stoppingDownloads) processQueue()
          return
        }
        for (const item of planned) {
          try {
            const publish = async () => await publishStagedFile(
              ytdlpStagingDir,
              item.sourcePath,
              outDir,
              task.id,
              MIN_YTDLP_OUTPUT_BYTES,
              {
                destinationPath: item.entry.destinationPath,
                beforePublish: async (destinationPath, sourceIdentity) => {
                  const unchanged =
                    item.entry.destinationPath === destinationPath &&
                    sameOutputIdentity(sourceIdentityForEntry(item.entry), sourceIdentity) &&
                    sameOutputIdentity(destinationIdentityForEntry(item.entry) ?? {}, sourceIdentity)
                  if (unchanged) return
                  item.entry.destinationPath = destinationPath
                  item.entry.sourceDev = sourceIdentity.dev
                  item.entry.sourceIno = sourceIdentity.ino
                  item.entry.sourceSize = sourceIdentity.size
                  item.entry.sourceBirthtimeNs = sourceIdentity.birthtimeNs
                  item.entry.destinationDev = sourceIdentity.dev
                  item.entry.destinationIno = sourceIdentity.ino
                  item.entry.destinationSize = sourceIdentity.size
                  item.entry.destinationBirthtimeNs = sourceIdentity.birthtimeNs
                  if (!persistNativePlaylistPublishJournal(task.id, outDir, journal)) {
                    throw new Error('Playlist ownership journal exceeds its safe storage limit')
                  }
                },
                onDestinationIdentity: async (destinationPath, sourceIdentity, destinationIdentity) => {
                  const priorDestination = destinationIdentityForEntry(item.entry)
                  if (
                    item.entry.destinationPath === destinationPath && priorDestination &&
                    sameOutputIdentity(priorDestination, destinationIdentity)
                  ) return
                  item.entry.destinationPath = destinationPath
                  Object.assign(item.entry, withDestinationIdentity(item.entry, destinationIdentity))
                  if (!persistNativePlaylistPublishJournal(task.id, outDir, journal)) {
                    throw new Error('Playlist ownership journal exceeds its safe storage limit')
                  }
                }
              }
            )
            let published = await publish()
            if (!published) {
              const previousDestination = resolvePath(outDir, item.entry.destinationPath)
              releaseOutputPathReservation(previousDestination, task.id)
              const alternate = await chooseSafeOutputPath(resolvePath(outDir, item.sourceRelative), task.id)
              const alternateRelative = relative(outDir, alternate)
              if (!alternateRelative || isAbsolute(alternateRelative) || !isPathInside(outDir, alternate)) {
                publishFailed = true
                continue
              }
              item.entry.destinationPath = alternateRelative
              if (!persistNativePlaylistPublishJournal(task.id, outDir, journal)) {
                publishFailed = true
                continue
              }
              published = await publish()
              if (!published) {
                publishFailed = true
                continue
              }
            }
            const updatedEntry = withDestinationIdentity(item.entry, published.identity)
            if (!sameOutputIdentity(destinationIdentityForEntry(item.entry) ?? {}, published.identity)) {
              Object.assign(item.entry, updatedEntry)
              if (!persistNativePlaylistPublishJournal(task.id, outDir, journal)) {
                throw new Error('Playlist ownership journal exceeds its safe storage limit')
              }
            }
            outputCount += 1
            totalBytes += published.size
          } catch {
            publishFailed = true
          }
        }
        if (isTaskAborted(task.id)) {
          releaseSlot()
          resolve()
          if (!stoppingDownloads) processQueue()
          return
        }
        if (publishFailed) {
          task.progress = 0
          setTaskError(task, 'Some playlist files could not be safely published. Retry to resume the remaining files.', 'STORAGE_UNAVAILABLE')
          emitProgress(task)
          releaseSlot()
          resolve()
          if (!stoppingDownloads) processQueue()
          return
        }
        if (outputCount === 0) {
          task.progress = 0
          setTaskError(task, 'yt-dlp reported success but no playlist output files were found.', 'STORAGE_UNAVAILABLE')
          db.updateDownload(task.id, { file_path: null, file_size: null })
          emitProgress(task)
          releaseSlot()
          resolve()
          if (!stoppingDownloads) processQueue()
          return
        }
        task.filePath = outDir
        task.metadata = {
          ...(task.metadata ?? {}),
          nativePlaylistOwnedPaths: journal.map((entry) => entry.destinationPath),
          nativePlaylistPublishJournal: journal
        }
        const note = writeTaskNote(task, 'gallery', outDir)
        if (note) await persistTaskOutputIdentity(task.id, outDir, 'ownedOutputFiles', note.path, note.identity)
        task.status = 'complete'
        task.progress = 100
        task.error = null
        task.errorCode = null
        task.updatedAt = new Date().toISOString()
        taskExtraMeta.delete(task.id)
        if (!persistNativePlaylistPublishJournal(task.id, outDir, journal)) {
          throw new Error('Playlist ownership journal exceeds its safe storage limit')
        }
        const persistedRecord = db.getDownload(task.id)
        const persistedExtras = persistedRecord ? serializeOwnedExtras(metadataFromRecord(persistedRecord)) : serializeOwnedExtras(task.metadata)
        if (task.metadata) delete task.metadata.nativePlaylistOwnedPaths
        if (task.metadata) delete task.metadata.nativePlaylistPublishJournal
        db.updateDownload(task.id, {
          status: 'complete',
          progress: 100,
          file_path: outDir,
          file_size: totalBytes > 0 ? totalBytes : null,
          extras: persistedExtras,
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
      const expectedName = writerOutputNameForTask(task, outputExtGuess)
      const expectedPath = join(ytdlpStagingDir, expectedName)
      const expectedPathAlt =
        mediaType === 'jpeg' ? join(ytdlpStagingDir, writerOutputNameForTask(task, 'jpeg')) : null
      const stagedReservedPath = mediaType || skipAdoptExisting
        ? join(ytdlpStagingDir, basename(finalPath))
        : expectedPath

      const MIN_OUTPUT_BYTES = MIN_YTDLP_OUTPUT_BYTES
      const ytdlpOutput = dp.getOutput?.() ?? dp.getStderr()
      const ytdlpId = usableYtdlpMediaId(taskMeta?.ytdlpId) ||
        usableYtdlpMediaId(ytdlpMediaIdFromOutput(ytdlpOutput))
      const idMarker = ytdlpId ? `[${ytdlpId}]` : ''
      if (ytdlpId && !taskMeta?.ytdlpId) {
        const merged = { ...(taskMeta ?? {}), ytdlpId }
        task.metadata = merged
        db.updateDownload(task.id, { extras: serializeTaskExtrasPreservingOwnership(task.id, merged) })
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

      // A normal task publishes one output. If yt-dlp resolved the page to a
      // collection after the earlier resolver pass, do not pick the last file
      // and let cleanup erase the other completed entries.
      const finalizedPaths = new Set<string>()
      for (const reportedPath of dp.getFinalDestinations?.() ?? []) {
        const resolved = resolveReportedPath(ytdlpStagingDir, reportedPath)
        if (!resolved || finalizedPaths.has(resolved)) continue
        const hit = await tryStat(resolved)
        if (hit) finalizedPaths.add(hit.path)
      }
      if (dp.hasIncompleteOutputPathMetadata?.() === true) {
        task.progress = 0
        setTaskError(
          task,
          'yt-dlp output paths exceeded the safe capture limit. The outputs were kept in the task\'s temporary folder; retry with a shorter collection or download each item separately.'
        )
        db.updateDownload(task.id, { file_path: null, file_size: null })
        emitProgress(task)
        releaseSlot()
        resolve()
        if (!stoppingDownloads) processQueue()
        return
      }
      if (finalizedPaths.size > 1) {
        task.progress = 0
        setTaskError(
          task,
          `yt-dlp produced ${finalizedPaths.size} files for a single download. The outputs were kept in the task's temporary folder; submit this page as a playlist or download each item separately.`
        )
        db.updateDownload(task.id, { file_path: null, file_size: null })
        emitProgress(task)
        releaseSlot()
        resolve()
        if (!stoppingDownloads) processQueue()
        return
      }

      // 1) Paths yt-dlp reported on stdout (authoritative when present)
      const finalDestinations = dp.getFinalDestinations?.() ?? []
      const dests = (finalDestinations.length > 0 ? finalDestinations : (dp.getDestinations?.() ?? []))
        .filter(destinationMatchesTask)
      for (let i = dests.length - 1; i >= 0; i--) {
        const stagedPath = resolveReportedPath(ytdlpStagingDir, dests[i]!)
        const hit = stagedPath ? await tryStat(stagedPath) : null
        if (hit) {
          filePath = hit.path
          fileSize = hit.size
          break
        }
      }

      // 2) Filename contains yt-dlp video id (matches our default -o template)
      if (!filePath && ytdlpId) {
        const hit = await findYtdlpOutputByIdMarker(ytdlpStagingDir, ytdlpId, outputExtGuess, true)
        if (hit) {
          filePath = hit.path
          fileSize = hit.size
        }
      }

      // 3) Reserved unique path from start-of-task (never the leftover file the user just deleted)
      if (!filePath) {
        const hit = await tryStat(stagedReservedPath)
        if (hit) {
          filePath = hit.path
          fileSize = hit.size
        } else if (expectedPathAlt && stagedReservedPath === expectedPath) {
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
          const files = await collectRegularFiles(ytdlpStagingDir)
          const exts = new Set(
            outputExtGuess === 'mp3'
              ? ['mp3', 'm4a', 'opus', 'webm']
              : mediaType === 'jpeg'
                ? ['jpg', 'jpeg', 'png', 'webp']
                : ['mp4', 'mkv', 'webm', 'm4a']
          )
          const outputBase = basename(finalPath, extname(finalPath))
          let newest: { path: string; mtime: number; size: number } | null = null
          for (const p of files) {
            const f = basename(p)
            const dot = f.lastIndexOf('.')
            if (dot < 1) continue
            const ext = f.slice(dot + 1).toLowerCase()
            if (!exts.has(ext)) continue
            if (!f.startsWith(outputBase)) continue
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

      if (filePath) {
        const stagedSourcePath = filePath
        let publishSourceIdentity: PersistedOutputIdentity | null = null
        const published = await publishStagedFile(
          ytdlpStagingDir,
          filePath,
          outDir,
          task.id,
          MIN_OUTPUT_BYTES,
          {
            beforePublish: async (destinationPath, sourceIdentity) => {
              publishSourceIdentity = sourceIdentity
              const sourceRelative = relative(outDir, stagedSourcePath)
              if (!persistOutputPublishEntry(task.id, outDir, sourceRelative, destinationPath, sourceIdentity)) {
                throw new Error('Output ownership journal could not be persisted')
              }
            },
            onDestinationIdentity: async (destinationPath, sourceIdentity, destinationIdentity) => {
              if (!persistOutputPublishEntry(
                task.id,
                outDir,
                relative(outDir, stagedSourcePath),
                destinationPath,
                sourceIdentity,
                destinationIdentity
              )) throw new Error('Output ownership journal could not be persisted')
            }
          }
        )
        if (published) {
          filePath = published.path
          fileSize = published.size
          await persistTaskOutputIdentity(task.id, outDir, 'ownedOutputFiles', filePath, published.identity)
          const sourceRelative = relative(outDir, stagedSourcePath)
          const destinationRelative = relative(outDir, filePath)
          if (!persistOutputPublishEntry(task.id, outDir, sourceRelative, destinationRelative, {
            ...(publishSourceIdentity ?? published.identity),
          }, published.identity)) throw new Error('Output ownership journal could not be persisted')
        } else {
          filePath = null
          fileSize = null
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

      if (isTaskAborted(task.id)) {
        await removeTaskOwnedOutput(task.id, outDir, 'ownedOutputFiles', filePath)
        releaseSlot()
        resolve()
        if (!stoppingDownloads) processQueue()
        return
      }

      task.filePath = filePath
      const note = writeTaskNote(task, 'sidecar', filePath)
      if (note) await persistTaskOutputIdentity(task.id, outDir, 'ownedOutputFiles', note.path, note.identity)
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
      if (!stoppingDownloads) processQueue()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const latest = db.getDownload(task.id)
        if (!isTaskAborted(task.id) && latest?.status === 'downloading') {
          setTaskError(task, message)
          emitProgress(task)
        }
        releaseSlot()
        resolve()
        if (!stoppingDownloads) processQueue()
      } finally {
        await cleanupStaging()
      }
    }

    dp.process.on('close', (code, signal) => {
      void handleClose(code, signal)
    })

    dp.process.on('error', (err) => {
      console.error(`[runTask] id=${task.id.slice(0,8)} process error: ${sanitizeResolverError(err.message)}`)
      processError = err
    })
  })
}

let pendingQueue = false
function processQueue(): void {
  if (pendingQueue || stoppingDownloads) return
  pendingQueue = true

  queueMicrotask(() => {
    pendingQueue = false
    if (stoppingDownloads) return

    // Heal zombie rows left from older builds: DB says downloading but no in-process slot.
    for (const r of db.getDownloadsByStatus('downloading')) {
      if (abortedTaskIds.has(r.id)) continue
      if (r.status === 'downloading' && !activeDownloads.has(r.id)) {
        console.warn(`[processQueue] re-queue zombie downloading id=${r.id.slice(0, 8)}`)
        db.updateDownload(r.id, { status: 'queued', error: r.error })
      }
    }

    const activeIds = [...activeDownloads.keys()]
    const activeRows = new Map(db.getDownloadsByIds(activeIds).map((row) => [row.id, row]))
    const active = activeIds.map((id) => {
      const row = activeRows.get(id)
      return {
        id,
        playlistId: row?.playlist_id ?? null,
        playlistIndex: row?.playlist_index ?? null,
        status: 'downloading' as const,
      }
    })
    const mode = settings.get('downloadSpeedMode')
    const queued = db.getDownloadsByStatus('queued')
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

    const queuedById = new Map(queued.map((row) => [row.id, row]))
    for (const id of toStart) {
      if (stoppingDownloads) return
      const queuedRow = queuedById.get(id)
      if (!queuedRow || activeDownloads.has(id)) continue
      const row = db.getDownload(id)
      if (!row || row.status !== 'queued') continue
      db.updateDownload(id, { status: 'downloading' })
      const task = taskFromRecord({ ...row, status: 'downloading' })
      task.status = 'downloading'
      emitProgress(task)
      let trackedRun!: Promise<void>
      trackedRun = runTask(task)
        .catch((error) => {
          const latest = db.getDownload(id)
          if (!isTaskAborted(id) && latest?.status === 'downloading') {
            setTaskError(task, error instanceof Error ? error.message : String(error))
            emitProgress(task)
          }
        })
        .finally(() => {
          if (activeTaskRuns.get(id) === trackedRun) activeTaskRuns.delete(id)
          releaseOutputReservations(id)
          if (activeDownloads.has(id)) {
            activeDownloads.delete(id)
            taskSpeedBytes.delete(id)
            progressEmitLastAt.delete(id)
            disposeTaskAbortController(id)
          }
          updateDockProgress(true)
          if (pendingRetryIds.delete(id) && !stoppingDownloads) {
            retryTask(id)
            return
          }
          if (!stoppingDownloads) processQueue()
        })
      activeTaskRuns.set(id, trackedRun)
    }
  })
}

export function cancelTask(id: string): boolean {
  markTaskAborted(id)
  const active = activeDownloads.get(id)
  if (active) {
    active.cancel()
  }

  const record = db.getDownload(id)
  if (record && isInfoResolveTaskRecord(record) && (record.status === 'resolving' || record.status === 'ready' || record.status === 'error')) {
    infoResolveHooks.onCancel?.(id)
    return cancelInfoResolveTask(id)
  }
  if (record && (record.status === 'queued' || record.status === 'downloading')) {
    db.updateDownload(id, { status: 'cancelled', error: 'Cancelled by user', error_code: null })
    const updated = db.getDownload(id)
    if (updated) {
      emitProgress(taskFromRecord(updated))
    }
    processQueue()
    return true
  }
  return false
}

export function pauseTask(id: string): boolean {
  const record = db.getDownload(id)
  if (record && (record.status === 'queued' || record.status === 'downloading')) {
    markTaskAborted(id)
    db.updateDownload(id, { status: 'paused', error: null, error_code: null })

    const active = activeDownloads.get(id)
    if (active) {
      active.cancel()
    }
    const updated = db.getDownload(id)
    if (updated) {
      emitProgress(taskFromRecord(updated))
    }
    processQueue()
    return true
  }
  return false
}

export function retryTask(id: string): boolean {
  const record = db.getDownload(id)
  console.log(`[retryTask] id=${id.slice(0,8)} status=${record?.status ?? 'NOT_FOUND'}`)
  if (record && isInfoResolveTaskRecord(record) && (record.status === 'error' || record.status === 'cancelled')) {
    clearTaskAborted(id)
    db.updateDownload(id, { status: 'resolving', progress: 0, error: null, error_code: null })
    const updated = db.getDownload(id)
    if (updated) emitProgress(taskFromRecord(updated), {}, { force: true })
    infoResolveHooks.onRetry?.(id)
    return true
  }
  if (record && (record.status === 'error' || record.status === 'interrupted' || record.status === 'cancelled' || record.status === 'paused')) {
    if (activeTaskRuns.has(id)) {
      pendingRetryIds.add(id)
      return true
    }
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
    const updated = db.getDownload(id)
    if (updated) {
      emitProgress(taskFromRecord(updated))
    }
    processQueue()
    return true
  }
  return false
}

export async function deleteTask(id: string): Promise<void> {
  const record = db.getDownload(id)
  markTaskAborted(id)
  cancelTask(id)
  pendingRetryIds.delete(id)
  const activeRun = activeTaskRuns.get(id)
  transcodeAbortControllers.get(id)?.abort()
  const transcodeRun = activeTranscodeRuns.get(id)
  await Promise.allSettled([activeRun, transcodeRun].filter((run): run is Promise<void> => Boolean(run)))
  const latestRecord = db.getDownload(id) ?? record
  if (latestRecord) {
    const extras = metadataFromRecord(latestRecord)
    await rm(stagingDirectoryForTask(outputDirForRecord(latestRecord, extras), latestRecord.id), { recursive: true, force: true }).catch(() => {})
  }
  taskExtraMeta.delete(id)
  db.deleteDownload(id)
  clearTaskAborted(id)
}

type OutputDeleteCandidate = { path: string; identity: PersistedOutputIdentity; root?: string }

async function removeOwnedFileForDelete(
  outputRoot: string,
  candidate: OutputDeleteCandidate
): Promise<string | null> {
  let st: BigIntStats
  try {
    st = await lstat(candidate.path, { bigint: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    return `Could not inspect ${candidate.path}: ${error instanceof Error ? error.message : String(error)}`
  }
  if (!st.isFile() || st.isSymbolicLink() || !outputIdentityMatches(st, candidate.identity)) {
    return `Ownership could not be verified; the file was kept at ${candidate.path}`
  }
  try {
    const [rootReal, pathReal] = await Promise.all([realpath(candidate.root ?? outputRoot), realpath(candidate.path)])
    if (!isPathInside(rootReal, pathReal)) {
      return `The file resolves outside its task output folder and was kept at ${candidate.path}`
    }
    await unlink(candidate.path)
    return null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    return `Could not remove ${candidate.path}: ${error instanceof Error ? error.message : String(error)}`
  }
}

async function removeOwnedDirectoryForDelete(
  outputRoot: string,
  candidate: OutputDeleteCandidate
): Promise<string | null> {
  let st: BigIntStats
  try {
    st = await lstat(candidate.path, { bigint: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    return `Could not inspect ${candidate.path}: ${error instanceof Error ? error.message : String(error)}`
  }
  if (!st.isDirectory() || st.isSymbolicLink() || !outputIdentityMatches(st, candidate.identity)) {
    return `Ownership could not be verified; the folder was kept at ${candidate.path}`
  }
  try {
    const [rootReal, pathReal] = await Promise.all([realpath(candidate.root ?? outputRoot), realpath(candidate.path)])
    if (!isPathInside(rootReal, pathReal)) {
      return `The folder resolves outside its task output folder and was kept at ${candidate.path}`
    }
    await rm(candidate.path, { recursive: true, force: false })
    return null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    return `Could not remove ${candidate.path}: ${error instanceof Error ? error.message : String(error)}`
  }
}

function throwOutputDeleteProblems(problems: string[]): void {
  if (problems.length === 0) return
  const details = problems.slice(0, 4).join('; ')
  const rest = problems.length > 4 ? `; and ${problems.length - 4} other path(s)` : ''
  throw new Error(`Some files were kept and the task record remains available. ${details}${rest}. Open the folder or use Remove from list to keep the files.`)
}

async function deleteTaskFilesForRecord(record: db.DownloadRecord): Promise<void> {
  const extras = metadataFromRecord(record)
  const outputRoot = outputDirForRecord(record, extras)
  const stagingDir = stagingDirectoryForTask(outputRoot, record.id)
  const problems: string[] = []

  if (
    extras.nativeYoutubePlaylist === true || extras.remoteResolvedPlaylist === true ||
    Array.isArray(extras.nativePlaylistPublishJournal)
  ) {
    let root = outputRoot
    if (!extras.ownedOutputRoot && record.file_path) {
      try {
        const st = await lstat(record.file_path)
        if (st.isDirectory() && !st.isSymbolicLink()) root = resolvePath(record.file_path)
      } catch {
        /* use the task output root */
      }
    }
    const playlistStagingDir = stagingDirectoryForTask(root, record.id)
    const candidates = new Map<string, OutputDeleteCandidate>()
    const conflictedPaths = new Set<string>()
    const addCandidate = (path: string, identity: PersistedOutputIdentity, candidateRoot = root): void => {
      if (conflictedPaths.has(path)) return
      const prior = candidates.get(path)
      if (prior && !sameOutputIdentity(prior.identity, identity)) {
        problems.push(`Conflicting ownership records were found for ${path}; it was kept`)
        candidates.delete(path)
        conflictedPaths.add(path)
        return
      }
      candidates.set(path, { path, identity, root: candidateRoot })
    }

    const journal = Array.isArray(extras.nativePlaylistPublishJournal)
      ? extras.nativePlaylistPublishJournal as NativePlaylistPublishEntry[]
      : []
    for (const entry of journal) {
      const identity = destinationIdentityForEntry(entry) ?? sourceIdentityForEntry(entry)
      const relativePath = entry?.destinationPath
      if (!relativePath || isAbsolute(relativePath) || !identity?.dev || !identity.ino) {
        problems.push('A playlist output has no verifiable ownership record')
        continue
      }
      const path = resolvePath(root, relativePath)
      if (!isPathInside(root, path)) {
        problems.push(`A playlist output path escaped its task folder and was kept: ${relativePath}`)
        continue
      }
      addCandidate(path, identity)
    }
    if (Array.isArray(extras.ownedOutputFiles)) {
      for (const value of extras.ownedOutputFiles) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue
        const entry = value as PersistedOwnedOutput
        if (!entry.path || isAbsolute(entry.path) || !entry.dev || !entry.ino) {
          problems.push('A playlist note has no verifiable ownership record')
          continue
        }
        const path = resolvePath(root, entry.path)
        if (!isPathInside(root, path)) problems.push(`A playlist note escaped its task folder and was kept: ${entry.path}`)
        else addCandidate(path, entry)
      }
    }
    const legacyPaths = Array.isArray(extras.nativePlaylistOwnedPaths) ? extras.nativePlaylistOwnedPaths : []
    if (legacyPaths.length > 0 && journal.length === 0) {
      problems.push('This older playlist has no file identities, so its files were kept')
    }
    if (journal.length === 0 && legacyPaths.length === 0 && record.status === 'complete' && record.file_path) {
      try {
        const st = await lstat(record.file_path)
        if (st.isDirectory() && !st.isSymbolicLink()) {
          problems.push(`This older playlist folder has no file identities, so its contents were kept at ${record.file_path}`)
        }
      } catch {
        /* an already-removed playlist folder needs no cleanup */
      }
    }

    for (const candidate of candidates.values()) {
      const problem = await removeOwnedFileForDelete(root, candidate)
      if (problem) problems.push(problem)
    }
    try {
      await rm(playlistStagingDir, { recursive: true, force: true })
    } catch (error) {
      problems.push(`Could not remove temporary output ${playlistStagingDir}: ${error instanceof Error ? error.message : String(error)}`)
    }
    throwOutputDeleteProblems(problems)
    return
  }

  const files = new Map<string, OutputDeleteCandidate>()
  const dirs = new Map<string, OutputDeleteCandidate>()
  const conflictedFiles = new Set<string>()
  const conflictedDirs = new Set<string>()
  const addCandidate = (
    map: Map<string, OutputDeleteCandidate>,
    conflicted: Set<string>,
    path: string,
    identity: PersistedOutputIdentity,
    candidateRoot = outputRoot
  ): void => {
    if (conflicted.has(path)) return
    const prior = map.get(path)
    if (prior && !sameOutputIdentity(prior.identity, identity)) {
      problems.push(`Conflicting ownership records were found for ${path}; it was kept`)
      map.delete(path)
      conflicted.add(path)
      return
    }
    map.set(path, { path, identity, root: candidateRoot })
  }
  const readEntries = (key: 'ownedOutputFiles' | 'ownedOutputDirs', map: Map<string, OutputDeleteCandidate>): void => {
    const entries = Array.isArray(extras[key]) ? extras[key] as PersistedOwnedOutput[] : []
    for (const entry of entries) {
      if (!entry?.path || entry.path.length > 4096 || isAbsolute(entry.path) || !entry.dev || !entry.ino) {
        problems.push(`A task output entry in ${key} has invalid ownership metadata`)
        continue
      }
      const path = resolvePath(outputRoot, entry.path)
      if (!isPathInside(outputRoot, path)) {
        problems.push(`A task output path escaped its output folder and was kept: ${entry.path}`)
        continue
      }
      addCandidate(map, map === files ? conflictedFiles : conflictedDirs, path, entry)
    }
  }
  readEntries('ownedOutputFiles', files)
  readEntries('ownedOutputDirs', dirs)

  const publishJournal = Array.isArray(extras.ownedOutputPublishJournal)
    ? extras.ownedOutputPublishJournal as OwnedOutputPublishEntry[]
    : []
  for (const entry of publishJournal) {
    const identity = destinationIdentityForEntry(entry) ?? sourceIdentityForEntry(entry)
    if (!entry?.destinationPath || isAbsolute(entry.destinationPath) || !identity?.dev || !identity.ino) {
      problems.push('A published output has no verifiable ownership record')
      continue
    }
    const path = resolvePath(outputRoot, entry.destinationPath)
    if (!isPathInside(outputRoot, path)) {
      problems.push(`A published output path escaped its task folder and was kept: ${entry.destinationPath}`)
      continue
    }
    addCandidate(files, conflictedFiles, path, identity)
  }

  const hasOwnershipState = hasIdentityOwnershipState(extras)
  if (!hasOwnershipState && record.file_path && isAbsolute(record.file_path)) {
    try {
      const legacyPath = resolvePath(record.file_path)
      const st = await lstat(legacyPath, { bigint: true })
      if (st.isFile() && !st.isSymbolicLink()) {
        addCandidate(files, conflictedFiles, legacyPath, outputIdentityFromStat(st), dirname(legacyPath))
      } else if (st.isDirectory() && !st.isSymbolicLink()) {
        problems.push(`This older task folder has no file identities, so its contents were kept at ${legacyPath}`)
      } else {
        problems.push(`Ownership could not be verified; the recorded output was kept at ${legacyPath}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        problems.push(`Could not inspect the recorded output ${record.file_path}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } else if (record.file_path && isAbsolute(record.file_path)) {
    const recordPath = resolvePath(record.file_path)
    const isRecordedFile = [...files.values()].some((candidate) => candidate.path === recordPath)
    const isRecordedDir = [...dirs.values()].some((candidate) => candidate.path === recordPath)
    if (!isRecordedFile && !isRecordedDir) {
      try {
        const st = await lstat(recordPath)
        if (st.isFile() || st.isDirectory()) {
          problems.push(`The task's recorded output has no matching ownership identity and was kept at ${recordPath}`)
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          problems.push(`Could not inspect the recorded output ${recordPath}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  }

  const failedDirectories = new Set<string>()
  for (const candidate of files.values()) {
    const problem = await removeOwnedFileForDelete(outputRoot, candidate)
    if (problem) {
      problems.push(problem)
      for (const directory of dirs.keys()) if (isPathInside(directory, candidate.path)) failedDirectories.add(directory)
    }
  }
  for (const candidate of dirs.values()) {
    if (failedDirectories.has(candidate.path)) continue
    const problem = await removeOwnedDirectoryForDelete(outputRoot, candidate)
    if (problem) problems.push(problem)
  }
  try {
    await rm(stagingDir, { recursive: true, force: true })
  } catch (error) {
    problems.push(`Could not remove temporary output ${stagingDir}: ${error instanceof Error ? error.message : String(error)}`)
  }
  throwOutputDeleteProblems(problems)
}

export async function deleteTaskWithFiles(id: string): Promise<void> {
  const record = db.getDownload(id)

  markTaskAborted(id)
  cancelTask(id)
  pendingRetryIds.delete(id)
  const activeRun = activeTaskRuns.get(id)
  transcodeAbortControllers.get(id)?.abort()
  const transcodeRun = activeTranscodeRuns.get(id)
  await Promise.allSettled([activeRun, transcodeRun].filter((run): run is Promise<void> => Boolean(run)))

  try {
    if (record) {
      await deleteTaskFilesForRecord(db.getDownload(id) ?? record)
    }
  } catch (error) {
    clearTaskAborted(id)
    processQueue()
    throw error
  }

  taskExtraMeta.delete(id)
  db.deleteDownload(id)
  clearTaskAborted(id)
}

export async function deleteTasksWithFiles(ids: string[]): Promise<{ removed: number }> {
  const uniqueIds = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))]
  if (uniqueIds.length === 0) return { removed: 0 }

  const records = new Map<string, db.DownloadRecord>()
  for (const id of uniqueIds) {
    const record = db.getDownload(id)
    if (record) records.set(id, record)
    markTaskAborted(id)
    cancelTask(id)
    pendingRetryIds.delete(id)
    transcodeAbortControllers.get(id)?.abort()
    taskExtraMeta.delete(id)
  }

  await Promise.allSettled(
    uniqueIds
      .flatMap((id) => [activeTaskRuns.get(id), activeTranscodeRuns.get(id)])
      .filter((run): run is Promise<void> => Boolean(run))
  )

  let removed = 0
  const failures: string[] = []
  for (const [id, record] of records) {
    try {
      await deleteTaskFilesForRecord(db.getDownload(id) ?? record)
      db.deleteDownload(id)
      removed += 1
    } catch (error) {
      failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      clearTaskAborted(id)
    }
  }

  if (removed > 0) emitToRenderer('download-progress', { bulkRemoved: removed })
  processQueue()
  if (failures.length > 0) {
    const detail = failures.slice(0, 3).join(' | ')
    const rest = failures.length > 3 ? ` | and ${failures.length - 3} more task(s)` : ''
    throw new Error(`Removed ${removed} task(s); kept ${failures.length} task record(s) because some files could not be safely removed. ${detail}${rest}`)
  }
  return { removed }
}

export async function deleteTasks(ids: string[]): Promise<{ removed: number }> {
  const uniqueIds = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))]
  if (uniqueIds.length === 0) return { removed: 0 }

  let removed = 0
  for (const id of uniqueIds) {
    if (db.getDownload(id)) removed++
    await deleteTask(id)
  }

  emitToRenderer('download-progress', { bulkRemoved: removed })
  processQueue()
  return { removed }
}

export function isTranscoding(id: string): boolean {
  return transcodeJobs.has(id)
}

export async function transcodeTask(id: string, preset: TranscodePresetId): Promise<DownloadTask> {
  if (stoppingDownloads) throw new Error('The app is shutting down')
  if (transcodeJobs.has(id)) throw new Error('This file is already being transcoded')

  const record = db.getDownload(id)
  if (!record || record.status !== 'complete' || !record.file_path) {
    throw new Error('Only completed downloads with an available file can be transcoded')
  }

  transcodeJobs.add(id)
  const abortController = new AbortController()
  transcodeAbortControllers.set(id, abortController)
  let resolveRun!: () => void
  const activeRun = new Promise<void>((resolve) => { resolveRun = resolve })
  activeTranscodeRuns.set(id, activeRun)
  let transcodeStagingDir = ''
  try {
    emitToRenderer('transcode-progress', { id, preset, status: 'started', percent: 0 })
    const task = taskFromRecord(record)
    const recordExtras = metadataFromRecord(record)
    const storedRoot = typeof recordExtras.ownedOutputRoot === 'string' && isAbsolute(recordExtras.ownedOutputRoot)
      ? resolvePath(recordExtras.ownedOutputRoot)
      : dirname(resolvePath(record.file_path))
    const outputRoot = storedRoot
    if (!hasIdentityOwnershipState(recordExtras)) {
      const legacyFileRecorded = await persistLegacyRecordFileOwnership(record, outputRoot)
      if (!legacyFileRecorded) {
        throw new Error('The original file could not be safely claimed for transcoding; no output ownership was changed')
      }
    }
    persistTaskOutputRoot(id, outputRoot)
    const reservedOutputPath = await chooseSafeOutputPath(createTranscodeOutputPath(record.file_path, preset), id)
    const relativeOutputPath = relative(outputRoot, reservedOutputPath)
    if (!relativeOutputPath || isAbsolute(relativeOutputPath) || !isPathInside(outputRoot, reservedOutputPath)) {
      throw new Error('Transcode output escaped the download directory')
    }
    transcodeStagingDir = stagingDirectoryForTask(outputRoot, id)
    const stagedOutputPath = join(transcodeStagingDir, relativeOutputPath)
    await mkdir(dirname(stagedOutputPath), { recursive: true })
    const stagedResult = await transcodeFile({
      inputPath: record.file_path,
      preset,
      outputPath: stagedOutputPath,
      durationSec: task.duration,
      signal: abortController.signal,
      onProgress: (progress) => {
        emitToRenderer('transcode-progress', { id, preset, status: 'progress', ...progress })
      },
    })

    const latest = db.getDownload(id)
    if (!latest || abortController.signal.aborted) {
      throw new Error('The download was removed or transcoding was cancelled')
    }
    let publishSourceIdentity: PersistedOutputIdentity | null = null
    const published = await publishStagedFile(
      transcodeStagingDir,
      stagedResult.outputPath,
      outputRoot,
      id,
      1,
      {
        requestedPath: reservedOutputPath,
        beforePublish: async (destinationPath, sourceIdentity) => {
          publishSourceIdentity = sourceIdentity
          if (!persistOutputPublishEntry(
            id,
            outputRoot,
            relative(outputRoot, stagedResult.outputPath),
            destinationPath,
            sourceIdentity
          )) throw new Error('Output ownership journal could not be persisted')
        },
        onDestinationIdentity: async (destinationPath, sourceIdentity, destinationIdentity) => {
          if (!persistOutputPublishEntry(
            id,
            outputRoot,
            relative(outputRoot, stagedResult.outputPath),
            destinationPath,
            sourceIdentity,
            destinationIdentity
          )) throw new Error('Output ownership journal could not be persisted')
        }
      }
    )
    if (!published) throw new Error('Could not safely publish the transcoded output')
    const outputPath = published.path
    await persistTaskOutputIdentity(id, outputRoot, 'ownedOutputFiles', outputPath, published.identity)
    if (!persistOutputPublishEntry(
      id,
      outputRoot,
      relative(outputRoot, stagedResult.outputPath),
      relative(outputRoot, outputPath),
      publishSourceIdentity ?? published.identity,
      published.identity
    )) throw new Error('Output ownership journal could not be persisted')

    if (abortController.signal.aborted || !db.getDownload(id)) {
      await removeTaskOwnedOutput(id, outputRoot, 'ownedOutputFiles', outputPath)
      throw new Error('The download was removed or transcoding was cancelled')
    }

    const metadata = { ...task.metadata, transcodePreset: preset }
    db.updateDownload(id, {
      file_path: outputPath,
      file_size: published.size,
      extras: serializeTaskExtrasPreservingOwnership(id, metadata),
      error: null,
      error_code: null,
    })
    const updated = taskFromRecord(db.getDownload(id) ?? latest)
    emitProgress(updated, { phase: 'complete' }, { force: true })
    emitToRenderer('transcode-progress', {
      id,
      preset,
      status: 'complete',
      percent: 100,
      filePath: outputPath,
    })
    return updated
  } catch (error) {
    if (!abortController.signal.aborted) {
      emitToRenderer('transcode-progress', {
        id,
        preset,
        status: 'error',
        percent: 0,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    throw error
  } finally {
    if (transcodeStagingDir) await rm(transcodeStagingDir, { recursive: true, force: true }).catch(() => {})
    releaseOutputReservations(id)
    transcodeJobs.delete(id)
    if (transcodeAbortControllers.get(id) === abortController) transcodeAbortControllers.delete(id)
    if (activeTranscodeRuns.get(id) === activeRun) activeTranscodeRuns.delete(id)
    resolveRun()
  }
}

export function getAll(): DownloadTask[] {
  return db.getDownloads().map(taskFromRecord)
}

/** Return one queue task without reading the entire download history. */
export function getById(id: string): DownloadTask | undefined {
  const record = db.getDownload(id)
  return record ? taskFromRecord(record) : undefined
}

export function getByStatus(...statuses: string[]): DownloadTask[] {
  return db.getDownloadsByStatus(...statuses).map(taskFromRecord)
}

function stagingTaskSegment(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96) || uuidv4()
}

function stagingDirectoryForTask(outputDir: string, taskId: string): string {
  return join(outputDir, '.vdl-staging', stagingTaskSegment(taskId))
}

function outputDirForRecord(record: db.DownloadRecord, extras: Record<string, unknown>): string {
  const persistedOutputDir = typeof extras.ownedOutputRoot === 'string' ? extras.ownedOutputRoot.trim() : ''
  if (persistedOutputDir) return persistedOutputDir
  return composeDownloadOutputDir({
    downloadDir: settings.get('downloadDir'),
    archiveByAuthor: settings.get('archiveByAuthor'),
    folderNameTemplate: settings.get('folderNameTemplate'),
    playlistSubfolder: settings.get('playlistSubfolder'),
    playlistFolder: record.playlist_id?.replace(/[/\\?*:|"<>]/g, '-') ?? null,
    remoteOutputDir: typeof extras.remoteOutputDir === 'string' ? extras.remoteOutputDir : null,
    skipPlaylistFolder: extras.douyinProfilePick === true && settings.get('archiveByAuthor'),
    values: templateValuesForTask({
      id: record.id,
      url: record.url,
      title: record.title,
      metadata: extras
    })
  })
}

/** Stop queue admission and wait until all active downloader processes finish cleanup. */
export async function stopActiveDownloads(): Promise<void> {
  stoppingDownloads = true
  const ids = new Set([...activeTaskRuns.keys(), ...activeDownloads.keys()])
  for (const id of ids) {
    markTaskAborted(id)
    activeDownloads.get(id)?.cancel()
  }
  for (const controller of transcodeAbortControllers.values()) controller.abort()
  for (const controller of thumbnailAbortControllers.values()) controller.abort()
  thumbnailQueue.length = 0
  pendingThumbnailTasks.clear()
  await stopBrowserCookieProcesses()
  await Promise.allSettled([
    ...activeTaskRuns.values(),
    ...activeTranscodeRuns.values(),
    ...activeThumbnailRuns.values()
  ])
}

export function clearCompleted(): void {
  for (const row of db.getDownloadsByStatus('complete')) thumbnailAbortControllers.get(row.id)?.abort()
  for (const controller of transcodeAbortControllers.values()) controller.abort()
  db.clearCompleted()
  emitToRenderer('download-progress', { cleared: true })
}

export function clearAll(): void {
  for (const controller of thumbnailAbortControllers.values()) controller.abort()
  thumbnailQueue.length = 0
  pendingThumbnailTasks.clear()
  for (const controller of transcodeAbortControllers.values()) controller.abort()
  pendingRetryIds.clear()
  for (const r of db.getDownloadsByStatus('resolving', 'ready', 'queued', 'downloading')) {
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
  const all = db.getDownloadsByStatus('downloading', 'queued')
  for (const r of all) {
    if (r.status === 'downloading' || r.status === 'queued') {
      pauseTask(r.id)
    }
  }
}

export function resumeAll(): void {
  const all = db.getDownloadsByStatus('paused', 'interrupted', 'error')
  for (const r of all) {
    // Do not bulk-resume user-cancelled items; per-row Retry still works for those.
    retryTask(r.id)
  }
}

export function loadFromDbAndRecover(): { recoveredIds: string[] } {
  const downloading = db.getDownloadsByStatus('downloading')
  const { recoveredIds } = planSessionRecover(downloading)
  console.log(`[recover] interrupted=${recoveredIds.length}`)
  for (const id of recoveredIds) {
    db.updateDownload(id, { status: 'interrupted', error: 'App was closed during download' })
  }
  processQueue()
  return { recoveredIds }
}
