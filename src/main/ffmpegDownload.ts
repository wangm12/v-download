import type { DownloadSelection } from '@v-download/shared'
import type { ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { mkdirSync, existsSync } from 'fs'
import { readFile, unlink } from 'fs/promises'
import { dirname, extname, join } from 'path'
import { tmpdir } from 'os'
import * as settings from './settings'
import { terminateDownloadProcess, type DownloadProcess, type DownloadProgress } from './downloadTypes'
import { DEFAULT_DIRECT_MEDIA_UA, parseMediaDurationSeconds } from './ytdlp'
import { spawnManagedProcess } from './managedChildProcesses'
import { isAdaptiveMediaInput } from './mediaResolver'
import { selectAdaptiveVideoStreams, type DownloadQuality } from './downloadQuality'
import { probeMediaMetadata } from './ffprobe'

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

function buildSpawnEnv(): Record<string, string> {
  const existing = process.env.PATH ?? ''
  const dirs = new Set(existing.split(':').concat(EXTRA_PATH_DIRS))
  const ffmpegPath = settings.get('ffmpegPath')
  if (ffmpegPath) {
    const dir = ffmpegPath.replace(/[/\\][^/\\]+$/, '')
    dirs.add(dir)
  }
  return { ...process.env as Record<string, string>, PATH: [...dirs].join(':') }
}

export function directMediaHeaders(
  referer: string | undefined,
  customHeaders: Record<string, string> | undefined
): Record<string, string> {
  const h: Record<string, string> = { ...(customHeaders || {}) }
  const hasHeader = (name: string) =>
    Object.keys(h).some((key) => key.toLowerCase() === name.toLowerCase())

  if (!hasHeader('User-Agent')) {
    h['User-Agent'] = DEFAULT_DIRECT_MEDIA_UA
  }
  if (referer && !hasHeader('Referer')) {
    h['Referer'] = referer
  }
  if (referer && !hasHeader('Origin')) {
    try {
      h['Origin'] = new URL(referer).origin
    } catch {
      /* ignore */
    }
  }
  return h
}

/** Netscape-style header block for ffmpeg `-headers`. */
function headersToFfmpegArg(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\r\n')
    .concat('\r\n')
}

export function isFfmpegDirectMediaEligible(mediaType: string | undefined, url: string): boolean {
  if (!mediaType) return false
  const mt = mediaType.toLowerCase()
  if (mt === 'jpeg') return false
  if (['hls', 'dash', 'mpd', 'mp4', 'webm', 'flv', 'mkv', 'mp3', 'm4a'].includes(mt)) return true
  if (/\.m3u8(\?|#|$)/i.test(url)) return true
  if (/\.mpd(\?|#|$)/i.test(url)) return true
  return false
}

function parseFfmpegProgressLine(line: string): {
  sec: number
  speedToken: string
  bitrateKbits: number | null
} | null {
  const timeM = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!timeM) return null
  const h = parseInt(timeM[1], 10)
  const m = parseInt(timeM[2], 10)
  const s = parseFloat(timeM[3])
  const sec = h * 3600 + m * 60 + s
  const spM = line.match(/speed=\s*(\S+)/)
  const speedToken = spM ? spM[1].trim() : ''

  let bitrateKbits: number | null = null
  const brK = line.match(/bitrate=\s*([\d.]+)\s*kbits\/s/i)
  if (brK) {
    const v = parseFloat(brK[1])
    if (Number.isFinite(v) && v > 0) bitrateKbits = v
  }
  const brM = line.match(/bitrate=\s*([\d.]+)\s*Mbits\/s/i)
  if (brM) {
    const v = parseFloat(brM[1])
    if (Number.isFinite(v) && v > 0) bitrateKbits = v * 1000
  }

  return { sec, speedToken, bitrateKbits }
}

/** ffmpeg `speed=4.2x` is relative to realtime, not link throughput. */
function isRelativeRealtimeSpeed(token: string): boolean {
  return /^[\d.]+\s*x$/i.test(token) || /^[\d.]+x$/i.test(token)
}

/** Turn output bitrate into a yt-dlp-style rate string for the UI / dock parser. */
function formatBitrateAsDataRate(kbitsPerSec: number): string {
  if (!Number.isFinite(kbitsPerSec) || kbitsPerSec <= 0) return ''
  const bytesPerSec = (kbitsPerSec * 1000) / 8
  const mib = 1024 * 1024
  const kib = 1024
  if (bytesPerSec >= mib) return `${(bytesPerSec / mib).toFixed(2)} MiB/s`
  if (bytesPerSec >= kib) return `${(bytesPerSec / kib).toFixed(1)} KiB/s`
  return `${Math.round(bytesPerSec)} B/s`
}

function displaySpeedForUi(speedToken: string, bitrateKbits: number | null): string {
  if (speedToken && isRelativeRealtimeSpeed(speedToken)) {
    if (bitrateKbits != null && bitrateKbits > 0) {
      return formatBitrateAsDataRate(bitrateKbits)
    }
    return ''
  }
  if (speedToken) return speedToken
  if (bitrateKbits != null && bitrateKbits > 0) return formatBitrateAsDataRate(bitrateKbits)
  return ''
}

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export interface FfmpegDirectDownloadOptions {
  url: string
  /** Full output file path (including extension). */
  outputPath: string
  mediaType?: string
  /** Explicit input stream indices selected from an adaptive manifest. */
  streamMaps?: number[]
  selection?: DownloadSelection
  /** Task format: `audio` / `mp3` / `video` etc. */
  format: string
  referer?: string
  customHeaders?: Record<string, string>
  proxyUrl?: string
  /** Known duration in seconds (for percent / ETA). */
  durationSec?: number | null
  onProgress?: (progress: DownloadProgress) => void
}

export interface FfmpegOutputValidationResult {
  valid: boolean
  cancelled?: boolean
  error?: string
}

export interface FfmpegDirectDownloadProcess extends DownloadProcess {
  /** Check container readability and expected stream presence before publishing. */
  validateOutput: (
    path: string,
    expectation: { format: string; mediaType?: string },
    signal?: AbortSignal
  ) => Promise<FfmpegOutputValidationResult>
}

const HTTP_READ_IDLE_TIMEOUT_US = 45_000_000
const HTTP_RECONNECT_MAX_RETRIES = 2

function isHttpUrl(value: string): boolean {
  try {
    return /^https?:$/.test(new URL(value).protocol)
  } catch {
    return false
  }
}

function isProgressiveHttpInput(mediaType: string | undefined, url: string): boolean {
  return isHttpUrl(url) && !isAdaptiveMediaInput(mediaType, url)
}

function expectedStreamClass(format: string, mediaType: string | undefined): 'audio' | 'video' {
  const type = (mediaType ?? '').toLowerCase()
  if (['audio','mp3','m4a','opus'].includes(format) || /^audio(?:\/|$)/.test(type) || /^(?:mp3|m4a|aac|opus|ogg|oga|wav|flac)$/.test(type)) {
    return 'audio'
  }
  return 'video'
}

export function ffprobeExecutable(ffmpegPath: string): string {
  const executable = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  const sibling = join(dirname(ffmpegPath), executable)
  return existsSync(sibling) ? sibling : executable
}

/** Respect a height limit without overriding a caller's FFmpeg engine choice. */
export async function probeAdaptiveVideoStreams(options: {
  url: string; quality: DownloadQuality; referer?: string; customHeaders?: Record<string, string>
  proxyUrl?: string; signal?: AbortSignal; selection?: DownloadSelection
}): Promise<ReturnType<typeof selectAdaptiveVideoStreams>> {
  const args = ['-v', 'error', '-rw_timeout', String(HTTP_READ_IDLE_TIMEOUT_US),
    '-headers', headersToFfmpegArg(directMediaHeaders(options.referer, options.customHeaders))]
  if (options.proxyUrl?.trim()) args.push('-http_proxy', options.proxyUrl.trim())
  args.push('-show_entries', 'stream=index,codec_type,codec_name,height,bit_rate,avg_frame_rate,r_frame_rate,color_transfer:stream_tags=language:program=program_id:program_stream=index,codec_type,codec_name,height,bit_rate,avg_frame_rate,r_frame_rate,color_transfer', '-of', 'json', options.url)
  const probe = await probeMediaMetadata(ffprobeExecutable(settings.get('ffmpegPath')), args, {
    stdio: ['ignore', 'pipe', 'pipe'], env: buildSpawnEnv(), detached: process.platform !== 'win32'
  }, options.signal)
  return probe.ok ? selectAdaptiveVideoStreams(probe.metadata, options.quality, options.selection) : { ok: false, error: probe.error }
}

/**
 * Download a single direct media URL with ffmpeg (remux or mp3 encode).
 * Caller is responsible for routing (e.g. auto-fallback to yt-dlp on failure).
 */
export function downloadDirectMediaWithFfmpeg(options: FfmpegDirectDownloadOptions): FfmpegDirectDownloadProcess {
  const ffmpegPath = settings.get('ffmpegPath')
  const {
    url,
    outputPath,
    mediaType,
    format,
    referer,
    customHeaders,
    proxyUrl,
    durationSec,
    onProgress: progressCb
  } = options

  let onProgress: (progress: DownloadProgress) => void = progressCb ?? (() => {})

  const wantsMp3 =
    options.selection?.target === 'audio' || format === 'audio' || format === 'mp3' || mediaType === 'mp3'
  const muxerInputPath = outputPath.replace(/\.part$/i, '')
  const outExt = extname(muxerInputPath).slice(1).toLowerCase() || 'mp4'
  const outputMuxer = ({ mp3: 'mp3', mp4: 'mp4', m4a: 'ipod', opus: 'opus', mka: 'matroska' } as Record<string,string>)[outExt] ?? ''

  const isHls = mediaType === 'hls' || /\.m3u8(\?|#|$)/i.test(url)

  const headerMap = directMediaHeaders(referer, customHeaders)
  const headersArg = headersToFfmpegArg(headerMap)

  const args: string[] = ['-hide_banner', '-loglevel', 'info', '-y']
  const progressiveHttp = isProgressiveHttpInput(mediaType, url)

  /** This is an HLS demuxer option; ordinary HTTP/DASH inputs do not accept it. */
  if (isHls) {
    args.push('-http_persistent', '1')
  }

  if (isHls) {
    args.push('-protocol_whitelist', 'file,http,https,tcp,tls,crypto,udp')
  }

  const resolvedProxy = (proxyUrl ?? '').trim()
  if (resolvedProxy) {
    args.push('-http_proxy', resolvedProxy)
  }

  args.push(
    '-headers',
    headersArg
  )

  if (isHttpUrl(url)) {
    // Bound a server that accepts a connection and then stops sending bytes.
    // A retry budget keeps repeated read timeouts from holding a queue slot forever.
    args.push(
      '-rw_timeout',
      String(HTTP_READ_IDLE_TIMEOUT_US),
      '-reconnect',
      '1',
      '-reconnect_streamed',
      '1',
      '-reconnect_delay_max',
      '5',
      '-reconnect_max_retries',
      String(HTTP_RECONNECT_MAX_RETRIES)
    )
  }

  if (progressiveHttp) {
    // Non-manifest HTTP files are finite progressive downloads. Stop on a
    // demux/input error so Auto can fall back instead of publishing a partial
    // remux. HLS/DASH live inputs retain FFmpeg's existing tolerant behavior.
    args.push('-xerror')
  }

  args.push('-i', url)

  if (options.selection?.target === 'audio') {
    for (const index of options.streamMaps ?? []) args.push('-map', `0:${index}`)
    const codec = { mp3: 'libmp3lame', m4a: 'aac', opus: 'libopus', original: 'copy', mp4: 'aac' }[options.selection.output]
    args.push('-vn', '-c:a', codec)
    if (options.selection.audioBitrate && codec !== 'copy') args.push('-b:a', `${options.selection.audioBitrate}k`)
  } else if (wantsMp3 && outExt === 'mp3') {
    args.push('-vn', '-c:a', 'libmp3lame', '-q:a', '0', '-threads', '0')
  } else {
    if (options.streamMaps) {
      for (const index of options.streamMaps) args.push('-map', `0:${index}`)
      args.push('-map_metadata', '0', '-map_chapters', '0')
    } else if (!isAdaptiveMediaInput(mediaType, url)) {
      // Automatic stream selection can omit embedded subtitles even with -c copy.
      // Map existing A/V/subtitle tracks explicitly; incompatible codecs must fail
      // rather than silently publish a file missing content. Data streams are not media tracks.
      args.push('-map', '0:v?', '-map', '0:a?', '-map', '0:s?', '-map_metadata', '0', '-map_chapters', '0')
    }
    if (outExt === 'mp4' && isHls) {
      // Copy mux only — omit +faststart: moving moov to the head is an extra pass that hurts tail latency on long HLS.
      args.push('-c', 'copy', '-bsf:a', 'aac_adtstoasc')
    } else if (outExt === 'mp4') {
      args.push('-c', 'copy', '-movflags', '+faststart')
    } else {
      args.push('-c', 'copy')
    }
  }

  args.push('-max_muxing_queue_size', '4096')
  if (outputMuxer) args.push('-f', outputMuxer)
  args.push(outputPath)
  mkdirSync(dirname(outputPath), { recursive: true })

  const proc = spawnManagedProcess(ffmpegPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildSpawnEnv(),
    detached: process.platform !== 'win32'
  })
  let stopActiveChild = () => terminateDownloadProcess(proc, true)
  let termination: Promise<boolean> | null = null
  const stopProcess = (): Promise<boolean> => {
    if (!termination) termination = stopActiveChild()
    return termination
  }

  const destinations: string[] = [outputPath]
  let stderrBuf = ''
  let lastEmit = 0
  let knownDuration = durationSec != null && durationSec > 0 ? durationSec : 0

  const emitFromLine = (line: string) => {
    const parsed = parseFfmpegProgressLine(line)
    if (!parsed) return

    const dur = knownDuration > 1 ? knownDuration : 0
    let percent: number
    let eta = ''
    if (dur > 0) {
      percent = Math.min(99, Math.max(0, (100 * parsed.sec) / dur))
      const remain = dur - parsed.sec
      if (remain > 0) eta = formatEta(remain)
    } else {
      percent = 1
    }

    const now = Date.now()
    if (now - lastEmit < 250 && percent < 99) return
    lastEmit = now

    onProgress({
      percent,
      speed: displaySpeedForUi(parsed.speedToken, parsed.bitrateKbits),
      eta,
      downloaded: '',
      total: '',
      phase: wantsMp3 ? 'audio' : 'video'
    })
  }

  const drain = (chunk: Buffer) => {
    const text = chunk.toString()
    stderrBuf = `${stderrBuf}${text}`.slice(-64 * 1024)
    for (const line of text.split(/\r\n|\n|\r/)) {
      const headerDuration = parseMediaDurationSeconds(line)
      if (headerDuration && headerDuration > knownDuration) knownDuration = headerDuration
      if (line.includes('time=')) {
        emitFromLine(line)
      }
    }
  }

  proc.stdout?.on('data', drain)
  proc.stderr?.on('data', drain)

  const validateOutput: FfmpegDirectDownloadProcess['validateOutput'] = async (path, expectation, signal) => {
    const probe = await probeMediaMetadata(ffprobeExecutable(ffmpegPath), [
      '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', path
    ], { stdio: ['ignore', 'pipe', 'pipe'], env: buildSpawnEnv(), detached: process.platform !== 'win32' }, signal,
    (_child, stop) => { stopActiveChild = stop; termination = null })
    if (!probe.ok) return { valid: false, cancelled: probe.cancelled, error: probe.error }
    const result = probe.metadata as { streams?: Array<{ codec_type?: unknown }> } | null
    const streamTypes = Array.isArray(result?.streams)
      ? result.streams.flatMap((stream) => typeof stream?.codec_type === 'string' ? [stream.codec_type.toLowerCase()] : [])
      : []
    const expected = expectedStreamClass(expectation.format, expectation.mediaType)
    return streamTypes.includes(expected) ? { valid: true } : {
      valid: false,
      error: `FFmpeg output is missing the expected ${expected} stream${streamTypes.length ? ` (found ${[...new Set(streamTypes)].join(', ')})` : ''}`
    }
  }

  const downloadProcess: FfmpegDirectDownloadProcess = {
    process: proc as ChildProcess,
    onProgress: (cb: (progress: DownloadProgress) => void) => {
      onProgress = cb
    },
    cancel: () => {
      void stopProcess()
    },
    waitForCleanup: () => termination ?? Promise.resolve(true),
    getStderr: () => stderrBuf,
    getDestinations: () => [...destinations],
    validateOutput
  }

  return downloadProcess
}

const THUMB_EXTRACT_TIMEOUT_MS = 28000
const MAX_THUMB_DATA_URL_LENGTH = 200_000

/** True when a quick ffmpeg frame grab is appropriate for list thumbnails. */
export function shouldTryStreamThumbnail(mediaType: string | undefined, url: string, format: string): boolean {
  if (format === 'audio' || format === 'mp3') return false
  const mt = (mediaType || '').toLowerCase()
  const likeM3u8 = /\.m3u8(\?|#|$)/i.test(url)
  if (!mt && !likeM3u8) return false
  if (mt === 'jpeg' || mt === 'jpg' || mt === 'png' || mt === 'webp' || mt === 'mp3' || mt === 'm4a') return false
  if (likeM3u8) return true
  return isFfmpegDirectMediaEligible(mediaType, url)
}

/**
 * One JPEG frame (~2s into the stream) as a data URL for UI `<img src>`.
 * Uses the same HTTP headers as direct-media download.
 */
export async function extractStreamThumbnailAsDataUrl(opts: {
  url: string
  mediaType?: string
  referer?: string
  customHeaders?: Record<string, string>
  signal?: AbortSignal
}): Promise<string | null> {
  if (opts.signal?.aborted) return null
  const ffmpegPath = settings.get('ffmpegPath')
  if (!ffmpegPath) return null

  const { url, mediaType, referer, customHeaders } = opts
  const isHls = mediaType === 'hls' || /\.m3u8(\?|#|$)/i.test(url)

  const dir = join(tmpdir(), 'v-download', 'thumb-extract')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const outPath = join(dir, `thumb-${randomBytes(8).toString('hex')}.jpg`)

  const headerMap = directMediaHeaders(referer, customHeaders)
  const headersArg = headersToFfmpegArg(headerMap)

  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-y']
  if (isHls) {
    args.push('-protocol_whitelist', 'file,http,https,tcp,tls,crypto,udp')
  }
  args.push('-headers', headersArg, '-ss', '2', '-an', '-i', url, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', outPath)

  const proc = spawnManagedProcess(ffmpegPath, args, {
    stdio: 'ignore',
    env: buildSpawnEnv(),
    detached: process.platform !== 'win32'
  })

  const code = await new Promise<number>((resolve) => {
    let timedOut = false
    let termination: Promise<boolean> | null = null
    const stopProcess = (): void => {
      termination = terminateDownloadProcess(proc, true)
    }
    const onAbort = () => {
      timedOut = true
      stopProcess()
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const t = setTimeout(() => {
      timedOut = true
      stopProcess()
    }, THUMB_EXTRACT_TIMEOUT_MS)
    proc.on('close', async (c) => {
      clearTimeout(t)
      opts.signal?.removeEventListener('abort', onAbort)
      if (termination && !(await termination)) {
        console.warn('[ffmpeg] thumbnail process group remained visible after SIGKILL escalation')
      }
      resolve(timedOut ? 124 : c ?? 1)
    })
    // Spawn failures also emit `close`; keep cleanup tied to that event.
    proc.on('error', () => {})
    if (opts.signal?.aborted) onAbort()
  })

  if (code !== 0) {
    await unlink(outPath).catch(() => {})
    return null
  }

  try {
    const buf = await readFile(outPath)
    await unlink(outPath).catch(() => {})
    if (buf.length < 800) return null
    const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`
    if (dataUrl.length > MAX_THUMB_DATA_URL_LENGTH) return null
    return dataUrl
  } catch {
    await unlink(outPath).catch(() => {})
    return null
  }
}
