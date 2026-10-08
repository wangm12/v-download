import { ChildProcess, execFileSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { StringDecoder } from 'node:string_decoder'
import * as settings from './settings'
import { resolvedCookiesBrowser } from './cookiesBrowser'
import { terminateDownloadProcess, type DownloadProgress, type DownloadProcess } from './downloadTypes'
import { classifyResolverError } from './mediaResolver'
import { resolveMediaCandidates, type ResolverCandidate } from './mediaResolver'
import { normalizeProxyUrl } from './settingsModel'
import { getNativeCookieFileForUrl } from './nativeAuth'
import { hintDirectMediaUrl } from './mediaIdentity'
import { DEFAULT_FILENAME_TEMPLATE, renderYtdlpFilenameTemplate } from './outputTemplateModel'
import { selectPreferredEnginePath } from './engineManagerModel'
import { ensurePoTokenProvider } from './poTokenServer'
import { isManagedChildShutdownRequested, spawnManagedProcess } from './managedChildProcesses'

export type { DownloadProgress, DownloadProcess } from './downloadTypes'

const YTDLP_INFO_TIMEOUT_MS = 70_000
const YTDLP_INFO_STDOUT_MAX_BYTES = 32 * 1024 * 1024
const YTDLP_INFO_STDERR_MAX_BYTES = 2 * 1024 * 1024
const YTDLP_THUMBNAIL_TIMEOUT_MS = 20_000
const YTDLP_THUMBNAIL_STDOUT_MAX_BYTES = 4 * 1024 * 1024
const YTDLP_DOWNLOAD_LOG_MAX_CHARS = 512 * 1024
const YTDLP_DESTINATION_MAX_COUNT = 10_000
const YTDLP_OUTPUT_LINE_MAX_CHARS = 16 * 1024
const FINAL_OUTPUT_MARKER = '__V_DOWNLOAD_FINAL_PATH__:'

function appendBoundedText(
  current: string,
  currentBytes: number,
  chunk: Buffer,
  maxBytes: number
): { value: string; bytes: number; overflow: boolean } {
  const remaining = maxBytes - currentBytes
  if (remaining <= 0) return { value: current, bytes: currentBytes, overflow: chunk.length > 0 }
  if (chunk.length <= remaining) {
    return { value: current + chunk.toString(), bytes: currentBytes + chunk.length, overflow: false }
  }
  const accepted = chunk.subarray(0, remaining)
  return { value: current + accepted.toString(), bytes: currentBytes + accepted.length, overflow: true }
}

const EXTRA_PATH_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
  join(process.env.HOME ?? '', '.local/bin'),
  join(process.env.HOME ?? '', '.deno/bin')
]

function spawnEnv(): Record<string, string> {
  const existing = process.env.PATH ?? ''
  const dirs = new Set(existing.split(':').concat(EXTRA_PATH_DIRS))

  const ffmpegPath = settings.get('ffmpegPath')
  if (ffmpegPath) {
    const ffmpegDir = ffmpegPath.replace(/\/[^/]+$/, '')
    dirs.add(ffmpegDir)
  }

  return { ...process.env as Record<string, string>, PATH: [...dirs].join(':') }
}

export interface VideoInfo {
  id: string
  title: string
  thumbnail: string
  duration: number
  channel: string
  view_count: number
  formats: FormatInfo[]
  playlist_title?: string
  playlist_count?: number
  entries?: VideoInfo[]
  _type?: string
  webpage_url: string
  description?: string
  candidates?: ResolverCandidate[]
}

export class YtdlpInfoError extends Error {
  readonly stdout: string
  readonly stderr: string
  constructor(message: string, stdout: string, stderr: string) {
    super(message)
    this.name = 'YtdlpInfoError'
    this.stdout = stdout
    this.stderr = stderr
  }
}

export function isYtdlpNoFormatsError(message: string): boolean {
  return /No video formats found/i.test(message)
}

export interface FormatInfo {
  format_id: string
  ext: string
  height?: number
  filesize?: number
  acodec?: string
  vcodec?: string
  protocol?: string
  mimeType?: string
  container?: string
  width?: number
  bitrate?: number
  filesize_approx?: number
  approximateSize?: number
  id?: string
  formatId?: string
  hasAudio?: boolean
  hasVideo?: boolean
  url?: string
  webpage_url?: string
  confidence?: number
}

export interface DownloadOptions {
  url: string
  format: string
  quality?: number
  outputDir: string
  cookiesPath?: string
  sleepInterval?: number
  isPlaylist?: boolean
  /** When true with isPlaylist, pass --yes-playlist (single job for whole list). */
  youtubeNativePlaylist?: boolean
  /** When true with isPlaylist, force all entries from a resolver-confirmed remote collection. */
  downloadWholePlaylist?: boolean
  playlistTitle?: string
  /** Seconds between HTTP requests (yt-dlp --sleep-requests). */
  playlistSleepRequests?: number
  /** Max number of playlist items (yt-dlp --max-downloads). 0 = unlimited. */
  playlistMaxDownloads?: number
  referer?: string
  customHeaders?: Record<string, string>
  outputTitle?: string
  mediaType?: string
  concurrentFragments?: number
  /** yt-dlp `--downloader` (e.g. aria2c). Empty = default built-in. */
  externalDownloader?: string
  /** Each string is passed as `--retry-sleep` (e.g. `fragment:linear=2::5`). */
  retrySleeps?: string[]
  /** Optional local PO-token provider args; absent means normal yt-dlp flow. */
  extractorArgs?: string
  pluginDir?: string
  /** Optional proxy URL applied to yt-dlp network requests. */
  proxyUrl?: string
  /** Chip-token filename template; rendered to a single relative `-o`. */
  filenameTemplate?: string
  /** Per-download scratch directory; keeps fragments and temp conversions isolated. */
  tempDir?: string
  /** Gentle preset: yt-dlp `--limit-rate` (e.g. `2M`). */
  limitRate?: string
  onProgress?: (progress: DownloadProgress) => void
}

export function resolveYtdlpOutputFilename(options: {
  filenameTemplate?: string
  isPlaylist?: boolean
  playlistTitle?: string
  outputTitle?: string
}): string {
  const filenameTemplate = options.filenameTemplate?.trim() || DEFAULT_FILENAME_TEMPLATE
  if (options.isPlaylist && options.playlistTitle) {
    return `%(playlist_index)03d - ${renderYtdlpFilenameTemplate(filenameTemplate)}`
  }
  if (options.outputTitle) {
    const sanitized = options.outputTitle.replace(/[/\\?*:|"<>]/g, '-')
    return `${sanitized}.%(ext)s`
  }
  return renderYtdlpFilenameTemplate(filenameTemplate)
}

const YOUTUBE_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+/
const PLAYLIST_REGEX = /[?&]list=/
const CHANNEL_REGEX = /youtube\.com\/(@[\w-]+|channel\/[\w-]+|c\/[\w-]+|user\/[\w-]+)(\/|$)/
export const DEFAULT_DIRECT_MEDIA_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

function getYtdlpTempDir(): string {
  // Keep partial artifacts (.part/.ytdl/fragments) out of user-visible download folders.
  const dir = join(tmpdir(), 'v-download', 'yt-dlp-temp')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function isValidYouTubeUrl(url: string): boolean {
  return YOUTUBE_REGEX.test(url) && url.trim().length > 0
}

const MEDIA_URL_REGEX = /\.(m3u8|mpd|mp4|webm|flv|mkv|mp3|m4a|aac|opus|ogg)(\?|#|$)/i

export function isMediaUrl(url: string): boolean {
  return MEDIA_URL_REGEX.test(url)
}

export function isValidDownloadUrl(url: string): boolean {
  return isValidYouTubeUrl(url) || isMediaUrl(url) || /^https?:\/\/.+/i.test(url)
}

export { classifyResolverError }

export function isPlaylistUrl(url: string): boolean {
  return PLAYLIST_REGEX.test(url) || CHANNEL_REGEX.test(url)
}

/** Logged-in YouTube defaults to tv_downgraded, which currently returns UNPLAYABLE for many sessions. */
export const YOUTUBE_COOKIE_PLAYER_CLIENT_ARGS = 'youtube:player_client=default,web_embedded'

export function isYoutubePageReloadError(message: string): boolean {
  return /\[youtube\].*The page needs to be reloaded/i.test(message)
}

export function appendYoutubeYtdlpArgs(
  url: string,
  args: string[],
  options?: { extractorArgs?: string; pluginDir?: string }
): void {
  if (!isValidYouTubeUrl(url)) return
  const extractorArgs = options?.extractorArgs
  const pluginDir = options?.pluginDir
  if (extractorArgs && isValidYouTubeUrl(url)) args.push('--extractor-args', extractorArgs)
  const cookiesAttached = args.includes('--cookies') || args.includes('--cookies-from-browser')
  if (cookiesAttached) args.push('--extractor-args', YOUTUBE_COOKIE_PLAYER_CLIENT_ARGS)
  if (pluginDir && isValidYouTubeUrl(url)) args.push('--plugin-dirs', pluginDir)
}

const ytdlpVersionCache = new Map<string, string | null>()

export function clearYtdlpVersionCache(path?: string): void {
  if (path) ytdlpVersionCache.delete(path)
  else ytdlpVersionCache.clear()
}

function bundledYtdlpPath(): string {
  const names = process.platform === 'win32' ? ['yt-dlp.exe'] : ['yt-dlp']
  const roots = [process.resourcesPath, join(process.cwd(), 'resources')].filter((p): p is string => Boolean(p))
  for (const root of roots) {
    const bundled = join(root, 'engines', `${process.platform}-${process.arch}`, names[0])
    if (existsSync(bundled)) return bundled
  }
  return ''
}

function ytdlpVersionFor(path: string): string | null {
  if (!path) return null
  if (ytdlpVersionCache.has(path)) return ytdlpVersionCache.get(path) ?? null
  try {
    const version = execFileSync(path, ['--version'], { encoding: 'utf-8', timeout: 8000 }).trim().split(/\s+/)[0] || null
    ytdlpVersionCache.set(path, version)
    return version
  } catch {
    ytdlpVersionCache.set(path, null)
    return null
  }
}

export function getYtdlpPath(customPath?: string): string {
  const bundled = bundledYtdlpPath()
  const requested = customPath && existsSync(customPath) ? customPath : ''
  const selected = selectPreferredEnginePath({
    requestedPath: requested,
    requestedExists: Boolean(requested),
    requestedVersion: requested ? ytdlpVersionFor(requested) : null,
    bundledPath: bundled,
    bundledExists: Boolean(bundled),
    bundledVersion: bundled ? ytdlpVersionFor(bundled) : null
  })
  if (selected) return selected
  try {
    // The binary name is a fixed internal constant; use argv rather than a shell string.
    return execFileSync(process.platform === 'win32' ? 'where' : 'which', ['yt-dlp'], { encoding: 'utf-8' }).trim().split(/\r?\n/)[0]
  } catch {
    return ''
  }
}

export function reconcileYtdlpPathSetting(): string {
  const requested = settings.get('ytdlpPath')
  const resolved = getYtdlpPath(requested)
  if (resolved && resolved !== requested) {
    try {
      settings.set('ytdlpPath', resolved)
    } catch (error) {
      console.error('Could not persist the reconciled yt-dlp path:', error)
    }
  }
  return resolved
}

export async function youtubeProviderOptions(url: string): Promise<{ extractorArgs?: string; pluginDir?: string }> {
  if (!isValidYouTubeUrl(url)) return {}
  const result = await ensurePoTokenProvider()
  return { extractorArgs: result.provider?.extractorArgs, pluginDir: result.provider?.pluginDir }
}

function isDouyinUrl(url: string): boolean {
  return /douyin\.com/i.test(url)
}

function isBilibiliUrl(url: string): boolean {
  return /bilibili\.com|b23\.tv/i.test(url)
}

/** Douyin extractor often needs main-site client hints in addition to cookies. */
function appendDouyinYtdlpArgs(url: string, args: string[], explicitReferer?: string): void {
  if (!isDouyinUrl(url)) return
  const flat = args.join('\n')
  if (!explicitReferer && !/--referer\b/.test(flat)) {
    args.push('--referer', 'https://www.douyin.com/')
  }
  if (!flat.includes('Origin:https://www.douyin.com')) {
    args.push('--add-header', 'Origin:https://www.douyin.com')
  }
}

/**
 * Douyin: live browser cookies only — merging a Netscape export often leaves stale douyin.com
 * entries and yt-dlp still reports “Fresh cookies needed”.
 * Other sites: extension-synced cookies.txt when present.
 */
export function addYtdlpCookieArgs(url: string, args: string[], cookiesPath?: string): void {
  const nativeCookiePath = getNativeCookieFileForUrl(url)
  if (nativeCookiePath) {
    args.push('--cookies', nativeCookiePath)
    return
  }
  if (isDouyinUrl(url)) {
    args.push('--cookies-from-browser', resolvedCookiesBrowser())
    return
  }
  if (isBilibiliUrl(url)) {
    if (cookiesPath && existsSync(cookiesPath)) {
      args.push('--cookies', cookiesPath)
    } else {
      args.push('--cookies-from-browser', resolvedCookiesBrowser())
    }
    return
  }
  if (cookiesPath && existsSync(cookiesPath)) {
    args.push('--cookies', cookiesPath)
  }
}

/** Single-page yt-dlp info — used when flat-playlist rows lack thumbnails (Bilibili). */
export async function fetchThumbnailForPageUrl(
  pageUrl: string,
  cookiesPath?: string,
  ytdlpPath?: string
): Promise<string> {
  if (isManagedChildShutdownRequested()) return ''
  const path = getYtdlpPath(ytdlpPath)
  const args: string[] = ['--dump-json', '--no-download', '--no-warnings', '--no-check-certificate']
  addYtdlpCookieArgs(pageUrl, args, cookiesPath)
  appendYoutubeYtdlpArgs(pageUrl, args, await youtubeProviderOptions(pageUrl))
  appendDouyinYtdlpArgs(pageUrl, args)
  args.push(pageUrl)

  return new Promise((resolve) => {
    const proc = spawnManagedProcess(path, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv(),
      detached: process.platform !== 'win32'
    })
    let stdout = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let cleanupPromise: Promise<boolean> | null = null
    let settled = false
    let timedOut = false
    const stopProcess = (): Promise<boolean> => {
      if (!cleanupPromise) cleanupPromise = terminateDownloadProcess(proc, true)
      return cleanupPromise
    }
    const finish = (value: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(value)
    }
    const timeout = setTimeout(() => {
      timedOut = true
      void stopProcess()
    }, YTDLP_THUMBNAIL_TIMEOUT_MS)
    proc.stdout?.on('data', (chunk: Buffer) => {
      const next = appendBoundedText(stdout, stdoutBytes, chunk, YTDLP_THUMBNAIL_STDOUT_MAX_BYTES)
      stdout = next.value
      stdoutBytes = next.bytes
      if (next.overflow) {
        timedOut = true
        void stopProcess()
      }
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > YTDLP_INFO_STDERR_MAX_BYTES) {
        timedOut = true
        void stopProcess()
      }
    })
    proc.on('close', async () => {
      if (cleanupPromise && !(await cleanupPromise)) {
        console.warn('[yt-dlp] thumbnail process group still visible after cancellation')
      }
      if (timedOut) {
        finish('')
        return
      }
      try {
        const line = stdout.trim().split('\n').filter(Boolean).pop()
        if (!line) {
          finish('')
          return
        }
        const json = JSON.parse(line) as Record<string, unknown>
        const thumbnails = json.thumbnails as Array<{ url: string }> | undefined
        const raw = thumbnails?.[0]?.url ?? (json.thumbnail as string) ?? ''
        finish(normalizeThumbnailUrl(String(raw)))
      } catch {
        finish('')
      }
    })
    proc.on('error', () => { void stopProcess() })
  })
}

/** Renderer CSP allows https images only; yt-dlp often returns http:// CDN URLs (e.g. Bilibili). */
export function normalizeThumbnailUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('http://')) return `https://${trimmed.slice('http://'.length)}`
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  return trimmed
}

export function collectPlaylistMetaFromJson(
  json: Record<string, unknown>,
  state: { playlistTitle?: string; playlistChannel?: string; playlistCount: number }
): void {
  if (!state.playlistTitle && json.playlist_title) {
    state.playlistTitle = String(json.playlist_title)
  }
  if (!state.playlistChannel && (json.playlist_channel || json.playlist_uploader)) {
    state.playlistChannel = String(json.playlist_channel ?? json.playlist_uploader)
  }
  if (!state.playlistCount && typeof json.playlist_count === 'number') {
    state.playlistCount = json.playlist_count
  }
}

function parseVideoInfoFromJson(json: Record<string, unknown>): VideoInfo {
  const positiveNumber = (value: unknown): number | undefined => {
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) && n > 0 ? n : undefined
  }
  const thumbnails = json.thumbnails as Array<{ url: string }> | undefined
  const rawThumbnail = thumbnails?.[0]?.url ?? (json.thumbnail as string) ?? ''
  const thumbnail = normalizeThumbnailUrl(rawThumbnail)
  const formats = (json.formats as Array<Record<string, unknown>>) ?? []
  const formatInfos: FormatInfo[] = formats
    .filter((f) => f.format_id && f.ext)
    .map((f) => ({
      format_id: String(f.format_id),
      ext: String(f.ext),
      height: positiveNumber(f.height),
      filesize: positiveNumber(f.filesize),
      filesize_approx: positiveNumber(f.filesize_approx),
      approximateSize: positiveNumber(f.filesize_approx),
      id: String(f.format_id),
      formatId: String(f.format_id),
      acodec: f.acodec as string | undefined,
      vcodec: f.vcodec as string | undefined,
      protocol: typeof f.protocol === 'string' ? f.protocol : undefined,
      mimeType: typeof f.mimetype === 'string' ? f.mimetype : undefined,
      container: typeof f.container === 'string' ? f.container : String(f.ext),
      width: positiveNumber(f.width),
      bitrate: positiveNumber(f.tbr),
      hasAudio: Boolean(f.acodec && f.acodec !== 'none'),
      hasVideo: Boolean(f.vcodec && f.vcodec !== 'none'),
      url: typeof f.url === 'string' ? f.url : undefined,
      webpage_url: typeof f.webpage_url === 'string' ? f.webpage_url : undefined,
      confidence: 0.9
    }))

  return {
    id: String(json.id ?? ''),
    title: String(json.title ?? 'Unknown'),
    thumbnail,
    duration: typeof json.duration === 'number' ? json.duration : 0,
    channel: String(json.channel ?? json.uploader ?? ''),
    view_count: typeof json.view_count === 'number' ? json.view_count : 0,
    formats: formatInfos,
    playlist_title: json.playlist_title as string | undefined,
    playlist_count: typeof json.playlist_count === 'number' ? json.playlist_count : undefined,
    webpage_url: String(json.webpage_url ?? json.url ?? ''),
    _type: json._type as string | undefined,
    description: typeof json.description === 'string' ? json.description : '',
    candidates: resolveMediaCandidates(formatInfos.filter((f) => f.url).map((f) => ({ ...f, url: f.url! } as ResolverCandidate)), { pageUrl: String(json.webpage_url ?? ''), source: 'yt-dlp' })
  }
}

export function textInfoFromYtdlpDump(stdout: string): VideoInfo | null {
  const lines = stdout.trim().split('\n').filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const json = JSON.parse(lines[i]!) as Record<string, unknown>
      const info = parseVideoInfoFromJson(json)
      const description = info.description?.trim() ?? ''
      const titled = info.title.trim() && info.title !== 'Unknown'
      if (!titled && !description) continue
      return { ...info, _type: 'text', formats: [], candidates: [] }
    } catch {
      /* next line */
    }
  }
  return null
}

export async function getVideoInfo(
  url: string,
  cookiesPath?: string,
  ytdlpPath?: string,
  signal?: AbortSignal,
  proxyUrl?: string,
  extras?: { omitCookies?: boolean }
): Promise<VideoInfo | { entries: VideoInfo[]; playlist_title?: string; playlist_channel?: string; playlist_count?: number }> {
  if (isManagedChildShutdownRequested()) {
    throw new DOMException('Application is shutting down', 'AbortError')
  }
  const path = getYtdlpPath(ytdlpPath)
  const isPlaylist = isPlaylistUrl(url)

  const args: string[] = [
    '--dump-json',
    '--no-download',
    '--no-warnings',
    '--no-check-certificate'
  ]

  if (!extras?.omitCookies) addYtdlpCookieArgs(url, args, cookiesPath)
  appendYoutubeYtdlpArgs(url, args, await youtubeProviderOptions(url))
  const resolvedProxy = normalizeProxyUrl(proxyUrl)
  if (resolvedProxy) args.push('--proxy', resolvedProxy)

  if (isPlaylist) {
    args.push('--flat-playlist')
  }

  appendDouyinYtdlpArgs(url, args)

  args.push(url)

  return new Promise((resolve, reject) => {
    const proc = spawnManagedProcess(path, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv(),
      detached: process.platform !== 'win32'
    })

    let stdout = ''
    let stdoutBytes = 0
    let stderr = ''
    let stderrBytes = 0
    let settled = false
    let stopError: Error | null = null
    let timeout: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      if (timeout) clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    }
    const resolveOnce = (value: VideoInfo | { entries: VideoInfo[]; playlist_title?: string; playlist_channel?: string; playlist_count?: number }) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const rejectOnce = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    let terminationPromise: Promise<boolean> | null = null
    const requestStop = (error: Error): void => {
      if (settled || stopError) return
      stopError = error
      terminationPromise = terminateDownloadProcess(proc, true)
    }
    const onAbort = () => requestStop(new DOMException('yt-dlp info resolution aborted', 'AbortError'))
    timeout = setTimeout(
      () => requestStop(new Error(`yt-dlp info timed out after ${Math.round(YTDLP_INFO_TIMEOUT_MS / 1000)} seconds`)),
      YTDLP_INFO_TIMEOUT_MS
    )
    timeout.unref?.()
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (stopError) return
      const next = appendBoundedText(stdout, stdoutBytes, chunk, YTDLP_INFO_STDOUT_MAX_BYTES)
      stdout = next.value
      stdoutBytes = next.bytes
      if (next.overflow) requestStop(new Error('yt-dlp info output exceeded the 32 MiB limit'))
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      if (stopError) return
      const next = appendBoundedText(stderr, stderrBytes, chunk, YTDLP_INFO_STDERR_MAX_BYTES)
      stderr = next.value
      stderrBytes = next.bytes
      if (next.overflow) requestStop(new Error('yt-dlp info error output exceeded the 2 MiB limit'))
    })

    proc.on('close', async (code) => {
      if (settled) return
      if (stopError) {
        if (terminationPromise && !(await terminationPromise)) {
          console.warn('[yt-dlp] info-resolution process group still visible after cancellation')
        }
        rejectOnce(stopError)
        return
      }
      if (code !== 0 && code !== null) {
        const message = `yt-dlp exited with code ${code}: ${stderr || stdout}`
        if (!extras?.omitCookies && isValidYouTubeUrl(url) && isYoutubePageReloadError(message)) {
          cleanup()
          void getVideoInfo(url, cookiesPath, ytdlpPath, signal, proxyUrl, { omitCookies: true }).then(resolveOnce, rejectOnce)
          return
        }
        rejectOnce(new YtdlpInfoError(message, stdout, stderr))
        return
      }

      try {
        const lines = stdout.trim().split('\n').filter(Boolean)
        const entries: VideoInfo[] = []
        const playlistMeta = { playlistTitle: undefined as string | undefined, playlistChannel: undefined as string | undefined, playlistCount: 0 }

        for (const line of lines) {
          const json = JSON.parse(line) as Record<string, unknown>
          if (isPlaylist && json._type === 'playlist') {
            playlistMeta.playlistTitle = String(json.title ?? '')
            playlistMeta.playlistCount = (json.n_entries as number) ?? 0
            continue
          }
          if (json._type === 'video' || json._type === 'url' || json.id) {
            collectPlaylistMetaFromJson(json, playlistMeta)
            entries.push(parseVideoInfoFromJson(json))
          }
        }

        if (entries.length > 1 || (isPlaylist && entries.length > 0)) {
          resolveOnce({
            entries,
            playlist_title: playlistMeta.playlistTitle,
            playlist_channel: playlistMeta.playlistChannel,
            playlist_count: playlistMeta.playlistCount || entries.length
          })
        } else if (entries.length === 1) {
          resolveOnce(entries[0]!)
        } else if (lines.length > 0) {
          resolveOnce(parseVideoInfoFromJson(JSON.parse(lines[0]!) as Record<string, unknown>))
        } else {
          rejectOnce(new Error('yt-dlp returned no video info'))
        }
      } catch (err) {
        rejectOnce(err instanceof Error ? err : new Error(String(err)))
      }
    })

    proc.on('error', (err) => {
      requestStop(err)
    })
  })
}

const DEST_REGEX = /\[download\]\s+Destination:\s+(.+)/
const MERGER_REGEX = /\[Merger\]/i

/** Strip ANSI SGR sequences so progress regexes match colored yt-dlp output. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

const DEST_LINE_RE = /^\[download\]\s+Destination:\s+(.+)$/
const MERGE_LINE_RE = /^\[Merger\]\s+Merging formats into "(.+)"$/
const ALREADY_LINE_RE = /^\[download\]\s+(.+?)\s+has already been downloaded$/

function extractDestinationsFromOutput(text: string): string[] {
  const found: string[] = []
  for (const rawLine of text.split('\n')) {
    const line = stripAnsi(rawLine).replace(/\r$/, '').trim()
    if (!line) continue
    const destMatch = DEST_LINE_RE.exec(line)
    if (destMatch) found.push(destMatch[1].trim())
    const mergeMatch = MERGE_LINE_RE.exec(line)
    if (mergeMatch) found.push(mergeMatch[1].trim())
    const alreadyMatch = ALREADY_LINE_RE.exec(line)
    if (alreadyMatch) found.push(alreadyMatch[1].trim())
  }
  return found
}

function extractFinalDestinationsFromOutput(text: string): string[] {
  const found: string[] = []
  for (const rawLine of text.split('\n')) {
    const line = stripAnsi(rawLine).replace(/\r$/, '').trim()
    if (!line.startsWith(FINAL_OUTPUT_MARKER)) continue
    const path = line.slice(FINAL_OUTPUT_MARKER.length).trim()
    if (path) found.push(path)
  }
  return found
}

/**
 * Parse yt-dlp `[download] ...` progress lines.
 *
 * yt-dlp uses several templates (see `yt_dlp/downloader/common.py` `report_progress`):
 * - With known total: `12.3% of  50.00MiB at  1.00MiB/s ETA 00:05`
 * - With estimate: `12.3% of ~  50.00MiB at  Unknown B/s ETA Unknown` (speed has spaces → old `(\S+)` failed)
 * - Without total (common for HLS): `12.3% at  1.00MiB/s ETA 00:05`
 * - Finished: `100% of  942.51KiB in 00:00:01 at 674.91KiB/s`
 */
function clockToSeconds(hours: string, minutes: string, seconds: string): number | null {
  const h = parseInt(hours, 10)
  const m = parseInt(minutes, 10)
  const s = parseFloat(seconds)
  if (![h, m, s].every(Number.isFinite)) return null
  return h * 3600 + m * 60 + s
}

function formatClock(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec))
  const hours = Math.floor(sec / 3600)
  const minutes = Math.floor((sec % 3600) / 60)
  const seconds = sec % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function ffmpegTimeToSeconds(line: string): number | null {
  const timeM = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!timeM) return null
  return clockToSeconds(timeM[1], timeM[2], timeM[3])
}

export function parseMediaDurationSeconds(line: string): number | null {
  const plain = stripAnsi(line)
  if (/Duration:\s*N\/A/i.test(plain)) return null
  const match = plain.match(/(?:^|\s|\[info\]\s+)Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i)
  if (!match) return null
  const sec = clockToSeconds(match[1], match[2], match[3])
  return sec != null && sec > 0 ? sec : null
}

function bitrateToSpeed(line: string): string {
  const brK = line.match(/bitrate=\s*([\d.]+)\s*kbits\/s/i)
  if (brK) {
    const kbits = parseFloat(brK[1])
    if (Number.isFinite(kbits) && kbits > 0) {
      const bytesPerSec = (kbits * 1000) / 8
      if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(2)}MiB/s`
      if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(1)}KiB/s`
    }
  }
  return ''
}

export function parseYtdlpProgressLine(
  line: string,
  currentPhase: string,
  durationSec?: number
): { progress: DownloadProgress | null; phase?: string } {
  const plain = stripAnsi(line).replace(/\r$/, '')

  if (MERGER_REGEX.test(plain)) {
    return { progress: null, phase: 'merging' }
  }

  const destMatch = plain.match(DEST_REGEX)
  if (destMatch) {
    const dest = destMatch[1]
    const isAudio = /\.m4a|\.mp3|\.opus|\.ogg|\.webm.*audio/i.test(dest) || /\.f\d+\.m4a/.test(dest)
    return { progress: null, phase: isAudio ? 'audio' : 'video' }
  }

  const phase = (currentPhase as DownloadProgress['phase']) || ''

  const normalizeSpeedEta = (rawSpeed: string, rawEta: string) => {
    const speedTrim = rawSpeed.trim()
    const etaTrim = rawEta.trim()
    const speed =
      !speedTrim ||
      /^unknown(\s+b\/s)?$/i.test(speedTrim) ||
      speedTrim === 'UnknownB/s'
        ? ''
        : speedTrim
    const eta = !etaTrim || etaTrim === 'Unknown' ? '' : etaTrim
    return { speed, eta }
  }

  // 1) `X% of ... at ... ETA ...` (known or estimated total)
  const withTotal = plain.match(
    /^\[download\]\s+(\d+\.?\d*)%\s+of\s+(.+?)\s+at\s+(.+?)\s+ETA\s+(\S+)/i
  )
  if (withTotal) {
    const percent = parseFloat(withTotal[1]) || 0
    const total = withTotal[2]?.trim() ?? ''
    const { speed, eta } = normalizeSpeedEta(withTotal[3], withTotal[4])
    return {
      progress: { percent, speed, eta, downloaded: '', total, phase }
    }
  }

  // 2) `X% at ... ETA ...` (no total — typical HLS / indeterminate size)
  const noTotal = plain.match(/^\[download\]\s+(\d+\.?\d*)%\s+at\s+(.+?)\s+ETA\s+(\S+)/i)
  if (noTotal) {
    const percent = parseFloat(noTotal[1]) || 0
    const { speed, eta } = normalizeSpeedEta(noTotal[2], noTotal[3])
    return {
      progress: { percent, speed, eta, downloaded: '', total: '', phase }
    }
  }

  // 3) Finished: `100% of SIZE in ELAPSED at SPEED` (no ETA segment)
  const finished = plain.match(
    /^\[download\]\s+(\d+\.?\d*)%\s+of\s+(.+?)\s+in\s+(\S+)(?:\s+at\s+(.+))?/i
  )
  if (finished) {
    const percent = parseFloat(finished[1]) || 0
    const total = finished[2]?.trim() ?? ''
    const elapsed = finished[3]?.trim() ?? ''
    const rawSpeed = finished[4]?.trim() ?? ''
    const { speed } = normalizeSpeedEta(rawSpeed, '')
    return {
      progress: {
        percent,
        speed,
        eta: elapsed,
        downloaded: '',
        total,
        phase
      }
    }
  }

  // 4) Fragment counter suffix: `… (frag 10/64)` on a line that already had % — handled above.
  //    Standalone fragment lines (rare): `10 of 64 fragments`
  const frag = plain.match(/^\[download\]\s+(\d+)\s+of\s+(\d+)\s+fragments/i)
  if (frag) {
    const cur = parseInt(frag[1], 10)
    const totalN = Math.max(parseInt(frag[2], 10), 1)
    const percent = Math.min(99, Math.max(0, (100 * cur) / totalN))
    return {
      progress: {
        percent,
        speed: '',
        eta: '',
        downloaded: '',
        total: `${cur}/${totalN} fragments`,
        phase
      }
    }
  }

  // yt-dlp's default HLS path shells out to ffmpeg. Those ticks use \r + time=,
  // not `[download] 12%`. Map muxed time onto the real duration when we have it;
  // never use the old (t+2)/(t+90) curve — it hits ~90% at 12 minutes on a 2h VOD.
  if (/time=\d+:\d+:\d+/.test(plain) && /frame=|fps=|bitrate=|speed=/.test(plain)) {
    const sec = ffmpegTimeToSeconds(plain)
    if (sec != null && sec >= 0) {
      const knownDuration = durationSec != null && durationSec > 1 ? durationSec : 0
      const percent = knownDuration
        ? Math.min(99, Math.max(0, (100 * sec) / knownDuration))
        : 1
      let eta = ''
      const rateMatch = plain.match(/speed=\s*([\d.]+)x/i)
      if (knownDuration && rateMatch) {
        const rate = parseFloat(rateMatch[1])
        const remain = knownDuration - sec
        if (rate > 0 && remain > 0) eta = formatClock(remain / rate)
      }
      return {
        progress: {
          percent,
          speed: bitrateToSpeed(plain),
          eta,
          downloaded: '',
          total: knownDuration ? `${formatClock(sec)} / ${formatClock(knownDuration)}` : `${formatClock(sec)} muxed`,
          phase: phase || 'video'
        },
        phase: phase || 'video'
      }
    }
  }

  return { progress: null }
}

export function download(
  options: DownloadOptions,
  ytdlpPath?: string
): DownloadProcess {
  const path = getYtdlpPath(ytdlpPath)
  const {
    url,
    format,
    quality = 1080,
    outputDir,
    cookiesPath,
    sleepInterval = 3,
    isPlaylist = false,
    youtubeNativePlaylist = false,
    downloadWholePlaylist = false,
    playlistTitle,
    playlistSleepRequests = 0,
    playlistMaxDownloads = 0,
    referer,
    customHeaders,
    outputTitle,
    mediaType,
    concurrentFragments,
    externalDownloader,
    retrySleeps,
    extractorArgs,
    pluginDir,
    proxyUrl,
    filenameTemplate,
    tempDir,
    limitRate,
    onProgress: progressCb
  } = options

  if (tempDir) mkdirSync(tempDir, { recursive: true })

  let onProgress: (progress: DownloadProgress) => void = progressCb ?? (() => {})

  // Relative -o is required: yt-dlp ignores --paths temp when -o is absolute (fragments land in outputDir).
  const outputFilenameTemplate = resolveYtdlpOutputFilename({
    filenameTemplate: filenameTemplate || settings.get('filenameTemplate'),
    isPlaylist,
    playlistTitle,
    outputTitle
  })

  /** Direct CDN / sniffed URLs from the browser extension — not multi-format player pages. */
  const isDirectMedia = Boolean(mediaType)

  let formatStr: string
  let mergeOutputMp4 = false
  if (isDirectMedia) {
    if (format === 'audio' || format === 'mp3' || mediaType === 'mp3') {
      formatStr = 'bestaudio/best'
      mergeOutputMp4 = false
    } else if (mediaType === 'jpeg') {
      formatStr = 'best'
    } else if (mediaType === 'dash' || mediaType === 'mpd') {
      // DASH manifests often expose separate video-only and audio-only
      // representations, so `best` alone can find no combined format.
      formatStr = 'bestvideo+bestaudio/best'
      mergeOutputMp4 = true
    } else {
      // Single progressive / CDN URL from extension — avoid bv+ba picking a mismatched pair
      formatStr = 'best'
      mergeOutputMp4 = false
    }
  } else if (format === 'audio' || format === 'mp3') {
    formatStr = 'bestaudio/best'
    mergeOutputMp4 = true
  } else {
    formatStr = `bv[height<=${quality}][ext=mp4]+ba[ext=m4a]/bv[height<=${quality}]+ba/best[height<=${quality}]/bestvideo+bestaudio/best`
    mergeOutputMp4 = true
  }

  const args: string[] = [
    '--newline',
    '--continue',
    ...(mergeOutputMp4 ? (['--merge-output-format', 'mp4'] as const) : []),
    '-f', formatStr,
    '--paths', outputDir,
    '--paths', `temp:${tempDir || getYtdlpTempDir()}`,
    '-o', outputFilenameTemplate,
    '--print', `after_move:${FINAL_OUTPUT_MARKER}%(filepath)s`,
    // --print options can make yt-dlp default to quiet mode. Keep the existing
    // destination/log lines and progress stream consumed by the UI parser.
    '--no-quiet',
    '--progress',
    '--no-warnings',
    '--no-check-certificate'
  ]

  addYtdlpCookieArgs(url, args, cookiesPath)
  const resolvedProxy = normalizeProxyUrl(proxyUrl)
  if (resolvedProxy) args.push('--proxy', resolvedProxy)

  appendYoutubeYtdlpArgs(url, args, { extractorArgs, pluginDir })

  if (sleepInterval > 0 && !mediaType) {
    args.push('--sleep-interval', String(sleepInterval))
  }

  if (playlistSleepRequests > 0 && !mediaType) {
    args.push('--sleep-requests', String(playlistSleepRequests))
  }

  if (playlistMaxDownloads > 0 && !mediaType) {
    args.push('--max-downloads', String(playlistMaxDownloads))
  }

  if (isPlaylist && (youtubeNativePlaylist || downloadWholePlaylist) && !mediaType) {
    args.push('--yes-playlist')
  }

  if (concurrentFragments && concurrentFragments > 1) {
    args.push('--concurrent-fragments', String(concurrentFragments))
  }

  const extDl = externalDownloader?.trim()
  if (extDl) {
    args.push('--downloader', extDl)
  }

  if (limitRate) {
    args.push('--limit-rate', limitRate)
  }

  if (retrySleeps && retrySleeps.length > 0) {
    for (const expr of retrySleeps) {
      const s = expr.trim()
      if (s) args.push('--retry-sleep', s)
    }
  }

  if (format === 'audio' || format === 'mp3' || mediaType === 'mp3') {
    args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0')
  }

  if (referer) {
    args.push('--referer', referer)
  }

  const effectiveHeaders: Record<string, string> = { ...(customHeaders || {}) }
  // Direct media URLs (especially HLS sniffed from players) commonly require UA/Origin.
  if (isDirectMedia) {
    if (!effectiveHeaders['User-Agent']) {
      effectiveHeaders['User-Agent'] = DEFAULT_DIRECT_MEDIA_UA
    }
    if (referer && !effectiveHeaders['Origin']) {
      try {
        effectiveHeaders['Origin'] = new URL(referer).origin
      } catch {
        // ignore malformed referer
      }
    }
  }

  if (Object.keys(effectiveHeaders).length > 0) {
    for (const [key, value] of Object.entries(effectiveHeaders)) {
      args.push('--add-header', `${key}: ${value}`)
    }
  }

  appendDouyinYtdlpArgs(url, args, referer)

  args.push(hintDirectMediaUrl(url, mediaType))

  const proc = spawnManagedProcess(path, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: spawnEnv(),
    detached: process.platform !== 'win32'
  })

  let currentPhase = ''
  let stdoutBuf = ''
  let stderrBuf = ''
  let mediaId = ''
  let durationSec = 0
  const destinations: string[] = []
  const finalDestinations: string[] = []
  let incompleteOutputPathMetadata = false

  const parseLine = (line: string) => {
    const plain = stripAnsi(line).replace(/\r$/, '')
    if (plain.trim().startsWith(FINAL_OUTPUT_MARKER)) {
      const finalPath = plain.trim().slice(FINAL_OUTPUT_MARKER.length).trim()
      if (finalPath) {
        if (finalDestinations.length < YTDLP_DESTINATION_MAX_COUNT) finalDestinations.push(finalPath)
        else incompleteOutputPathMetadata = true
      }
    }
    const idMatch = plain.match(/^\[info\]\s+(\d+):\s+Downloading/i)
    if (idMatch) mediaId = idMatch[1]!
    for (const dest of extractDestinationsFromOutput(plain)) {
      if (destinations.length < YTDLP_DESTINATION_MAX_COUNT) destinations.push(dest)
      else incompleteOutputPathMetadata = true
    }

    const parsedDuration = parseMediaDurationSeconds(plain)
    if (parsedDuration && parsedDuration > durationSec) durationSec = parsedDuration

    const result = parseYtdlpProgressLine(line, currentPhase, durationSec || undefined)
    if (result.phase) {
      currentPhase = result.phase
    }
    if (result.progress) {
      onProgress(result.progress)
    }
  }

  type OutputLineState = {
    decoder: StringDecoder
    pending: string
    skipLeadingLf: boolean
    discardingLongLine: boolean
    flushed: boolean
  }
  const makeOutputLineState = (): OutputLineState => ({
    decoder: new StringDecoder('utf8'),
    pending: '',
    skipLeadingLf: false,
    discardingLongLine: false,
    flushed: false,
  })
  const stdoutLines = makeOutputLineState()
  const stderrLines = makeOutputLineState()

  const appendLineFragment = (state: OutputLineState, fragment: string): void => {
    if (state.discardingLongLine || fragment.length === 0) return
    if (state.pending.length + fragment.length <= YTDLP_OUTPUT_LINE_MAX_CHARS) {
      state.pending += fragment
      return
    }

    const prefix = stripAnsi(`${state.pending}${fragment.slice(0, Math.max(0, 128 - state.pending.length))}`).trimStart()
    if (
      prefix.startsWith(FINAL_OUTPUT_MARKER) ||
      prefix.startsWith('[download] Destination:') ||
      prefix.startsWith('[Merger]')
    ) incompleteOutputPathMetadata = true
    state.pending = ''
    state.discardingLongLine = true
  }

  const finishOutputLine = (state: OutputLineState): void => {
    if (!state.discardingLongLine) parseLine(state.pending)
    state.pending = ''
    state.discardingLongLine = false
  }

  const consumeDecodedText = (state: OutputLineState, text: string): void => {
    let offset = 0
    if (state.skipLeadingLf) {
      state.skipLeadingLf = false
      if (text.startsWith('\n')) offset = 1
    }

    while (offset < text.length) {
      const cr = text.indexOf('\r', offset)
      const lf = text.indexOf('\n', offset)
      const delimiter = cr < 0 ? lf : lf < 0 ? cr : Math.min(cr, lf)
      if (delimiter < 0) {
        appendLineFragment(state, text.slice(offset))
        return
      }

      appendLineFragment(state, text.slice(offset, delimiter))
      finishOutputLine(state)
      const isCr = text[delimiter] === '\r'
      if (isCr && text[delimiter + 1] === '\n') {
        offset = delimiter + 2
      } else {
        // Carry only a CR at the end of this chunk: a following LF may be
        // the second half of CRLF. A later character in this same chunk is
        // already the next line and must not inherit that state.
        state.skipLeadingLf = isCr && delimiter === text.length - 1
        offset = delimiter + 1
      }
    }
  }

  const consumeOutputChunk = (state: OutputLineState, chunk: Buffer): string => {
    const text = state.decoder.write(chunk)
    consumeDecodedText(state, text)
    return text
  }

  const flushOutputLines = (state: OutputLineState): void => {
    if (state.flushed) return
    state.flushed = true
    consumeDecodedText(state, state.decoder.end())
    // yt-dlp normally ends output lines with a newline, but process close is
    // also a valid boundary for the final unterminated destination line.
    finishOutputLine(state)
    state.skipLeadingLf = false
  }

  proc.stdout?.on('data', (chunk: Buffer) => {
    const text = consumeOutputChunk(stdoutLines, chunk)
    stdoutBuf = `${stdoutBuf}${text}`.slice(-YTDLP_DOWNLOAD_LOG_MAX_CHARS)
  })

  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = consumeOutputChunk(stderrLines, chunk)
    stderrBuf = `${stderrBuf}${text}`.slice(-YTDLP_DOWNLOAD_LOG_MAX_CHARS)
  })

  proc.once('close', () => {
    flushOutputLines(stdoutLines)
    flushOutputLines(stderrLines)
  })

  let termination: Promise<boolean> | null = null
  const stopProcess = (): Promise<boolean> => {
    if (!termination) termination = terminateDownloadProcess(proc, true)
    return termination
  }
  const downloadProcess: DownloadProcess = {
    process: proc,
    onProgress: (cb: (progress: DownloadProgress) => void) => {
      onProgress = cb
    },
    cancel: () => {
      void stopProcess()
    },
    waitForCleanup: () => termination ?? Promise.resolve(true),
    getStderr: () => stderrBuf,
    getOutput: () => `${mediaId ? `[info] ${mediaId}: Downloading\n` : ''}${stdoutBuf}\n${stderrBuf}`,
    getFinalDestinations: () => [...new Set([
      ...finalDestinations,
      ...extractFinalDestinationsFromOutput(`${stdoutBuf}\n${stderrBuf}`)
    ])],
    hasIncompleteOutputPathMetadata: () => incompleteOutputPathMetadata,
    getDestinations: () => {
      const fromBuffers = extractDestinationsFromOutput(`${stdoutBuf}\n${stderrBuf}`)
      return [...new Set([...destinations, ...fromBuffers])]
    }
  }

  return downloadProcess
}
