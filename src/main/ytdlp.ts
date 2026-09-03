import { spawn, ChildProcess, execFileSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import * as settings from './settings'
import { resolvedCookiesBrowser } from './cookiesBrowser'
import type { DownloadProgress, DownloadProcess } from './downloadTypes'
import { classifyResolverError } from './mediaResolver'
import { resolveMediaCandidates, type ResolverCandidate } from './mediaResolver'
import { normalizeProxyUrl } from './settingsModel'
import { getNativeCookieFileForUrl } from './nativeAuth'
import { hintDirectMediaUrl } from './mediaIdentity'

export type { DownloadProgress, DownloadProcess } from './downloadTypes'

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
  onProgress?: (progress: DownloadProgress) => void
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

export function getYtdlpPath(customPath?: string): string {
  const names = process.platform === 'win32' ? ['yt-dlp.exe'] : ['yt-dlp']
  if (customPath && existsSync(customPath)) return customPath
  const roots = [process.resourcesPath, join(process.cwd(), 'resources')].filter((p): p is string => Boolean(p))
  for (const root of roots) { const bundled = join(root, 'engines', `${process.platform}-${process.arch}`, names[0]); if (existsSync(bundled)) return bundled }
  try {
    // The binary name is a fixed internal constant; use argv rather than a shell string.
    const result = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['yt-dlp'], { encoding: 'utf-8' }).trim().split(/\r?\n/)[0]
    return result
  } catch {
    return ''
  }
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
  const path = getYtdlpPath(ytdlpPath)
  const args: string[] = ['--dump-json', '--no-download', '--no-warnings', '--no-check-certificate']
  addYtdlpCookieArgs(pageUrl, args, cookiesPath)
  appendDouyinYtdlpArgs(pageUrl, args)
  args.push(pageUrl)

  return new Promise((resolve) => {
    const proc = spawn(path, args, { stdio: ['ignore', 'pipe', 'pipe'], env: spawnEnv() })
    let stdout = ''
    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.on('close', () => {
      try {
        const line = stdout.trim().split('\n').filter(Boolean).pop()
        if (!line) {
          resolve('')
          return
        }
        const json = JSON.parse(line) as Record<string, unknown>
        const thumbnails = json.thumbnails as Array<{ url: string }> | undefined
        const raw = thumbnails?.[0]?.url ?? (json.thumbnail as string) ?? ''
        resolve(normalizeThumbnailUrl(String(raw)))
      } catch {
        resolve('')
      }
    })
    proc.on('error', () => resolve(''))
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
  proxyUrl?: string
): Promise<VideoInfo | { entries: VideoInfo[]; playlist_title?: string; playlist_channel?: string; playlist_count?: number }> {
  const path = getYtdlpPath(ytdlpPath)
  const isPlaylist = isPlaylistUrl(url)

  const args: string[] = [
    '--dump-json',
    '--no-download',
    '--no-warnings',
    '--no-check-certificate'
  ]

  addYtdlpCookieArgs(url, args, cookiesPath)
  const resolvedProxy = normalizeProxyUrl(proxyUrl)
  if (resolvedProxy) args.push('--proxy', resolvedProxy)

  if (isPlaylist) {
    args.push('--flat-playlist')
  }

  appendDouyinYtdlpArgs(url, args)

  args.push(url)

  return new Promise((resolve, reject) => {
    const proc = spawn(path, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv()
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const cleanupAbort = () => signal?.removeEventListener('abort', onAbort)
    const resolveOnce = (value: VideoInfo | { entries: VideoInfo[]; playlist_title?: string; playlist_channel?: string; playlist_count?: number }) => {
      if (settled) return
      settled = true
      cleanupAbort()
      resolve(value)
    }
    const rejectOnce = (error: Error) => {
      if (settled) return
      settled = true
      cleanupAbort()
      reject(error)
    }
    const onAbort = () => {
      try { proc.kill('SIGTERM') } catch { /* process may already be closed */ }
      rejectOnce(new DOMException('yt-dlp info resolution aborted', 'AbortError'))
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('close', (code) => {
      if (settled) return
      if (code !== 0 && code !== null) {
        rejectOnce(new YtdlpInfoError(`yt-dlp exited with code ${code}: ${stderr || stdout}`, stdout, stderr))
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
      rejectOnce(err)
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
    onProgress: progressCb
  } = options

  let onProgress: (progress: DownloadProgress) => void = progressCb ?? (() => {})

  // Relative -o is required: yt-dlp ignores --paths temp when -o is absolute (fragments land in outputDir).
  let outputFilenameTemplate: string
  if (isPlaylist && playlistTitle) {
    outputFilenameTemplate = '%(playlist_index)03d - %(title)s.%(ext)s'
  } else if (outputTitle) {
    const sanitized = outputTitle.replace(/[/\\?*:|"<>]/g, '-')
    outputFilenameTemplate = `${sanitized}.%(ext)s`
  } else {
    // [%(id)s] avoids collisions when different videos share the same title (common on X/Twitter).
    outputFilenameTemplate = '%(title).200B [%(id)s].%(ext)s'
  }

  /** Direct CDN / sniffed URLs from the browser extension — not multi-format player pages. */
  const isDirectMedia = Boolean(mediaType)

  let formatStr: string
  let mergeOutputMp4 = false
  if (isDirectMedia) {
    if (mediaType === 'mp3') {
      formatStr = 'bestaudio/best'
    } else if (mediaType === 'jpeg') {
      formatStr = 'best'
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
    '--paths', `temp:${getYtdlpTempDir()}`,
    '-o', outputFilenameTemplate,
    '--no-warnings',
    '--no-check-certificate'
  ]

  addYtdlpCookieArgs(url, args, cookiesPath)
  const resolvedProxy = normalizeProxyUrl(proxyUrl)
  if (resolvedProxy) args.push('--proxy', resolvedProxy)

  if (extractorArgs && isValidYouTubeUrl(url)) args.push('--extractor-args', extractorArgs)
  if (pluginDir && isValidYouTubeUrl(url)) args.push('--plugin-dirs', pluginDir)

  if (sleepInterval > 0 && !mediaType) {
    args.push('--sleep-interval', String(sleepInterval))
  }

  if (playlistSleepRequests > 0 && !mediaType) {
    args.push('--sleep-requests', String(playlistSleepRequests))
  }

  if (playlistMaxDownloads > 0 && !mediaType) {
    args.push('--max-downloads', String(playlistMaxDownloads))
  }

  if (isPlaylist && youtubeNativePlaylist && !mediaType) {
    args.push('--yes-playlist')
  }

  if (concurrentFragments && concurrentFragments > 1) {
    args.push('--concurrent-fragments', String(concurrentFragments))
  }

  const extDl = externalDownloader?.trim()
  if (extDl) {
    args.push('--downloader', extDl)
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

  const proc = spawn(path, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: spawnEnv()
  })

  let currentPhase = ''
  let stdoutBuf = ''
  let stderrBuf = ''
  let durationSec = 0
  const destinations: string[] = []

  const parseLine = (line: string) => {
    const plain = stripAnsi(line).replace(/\r$/, '')
    for (const dest of extractDestinationsFromOutput(plain)) {
      destinations.push(dest)
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

  proc.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    stdoutBuf += text
    for (const line of text.split(/\r\n|\n|\r/)) {
      parseLine(line)
    }
  })

  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    stderrBuf += text
    for (const line of text.split(/\r\n|\n|\r/)) {
      parseLine(line)
    }
  })

  const downloadProcess: DownloadProcess = {
    process: proc,
    onProgress: (cb: (progress: DownloadProgress) => void) => {
      onProgress = cb
    },
    cancel: () => {
      try {
        proc.kill('SIGTERM')
      } catch {
        proc.kill('SIGKILL')
      }
    },
    getStderr: () => stderrBuf,
    getOutput: () => `${stdoutBuf}\n${stderrBuf}`,
    getDestinations: () => {
      const fromBuffers = extractDestinationsFromOutput(`${stdoutBuf}\n${stderrBuf}`)
      return [...new Set([...destinations, ...fromBuffers])]
    }
  }

  return downloadProcess
}
