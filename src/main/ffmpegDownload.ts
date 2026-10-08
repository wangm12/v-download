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

function buildHeaderMap(
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
const FFPROBE_VALIDATION_TIMEOUT_MS = 15_000
const FFPROBE_CAPTURE_MAX_BYTES = 64 * 1024

function isHttpUrl(value: string): boolean {
  try {
    return /^https?:$/.test(new URL(value).protocol)
  } catch {
    return false
  }
}

function isManifestInput(mediaType: string | undefined, url: string): boolean {
  const type = (mediaType ?? '').toLowerCase()
  return type === 'hls' || type === 'dash' || type === 'mpd' ||
    /\.(?:m3u8|mpd)(?:\?|#|$)/i.test(url)
}

function isProgressiveHttpInput(mediaType: string | undefined, url: string): boolean {
  return isHttpUrl(url) && !isManifestInput(mediaType, url)
}

function expectedStreamClass(format: string, mediaType: string | undefined): 'audio' | 'video' {
  const type = (mediaType ?? '').toLowerCase()
  if (format === 'audio' || format === 'mp3' || /^audio(?:\/|$)/.test(type) || /^(?:mp3|m4a|aac|opus|ogg|oga|wav|flac)$/.test(type)) {
    return 'audio'
  }
  return 'video'
}

function ffprobeExecutable(ffmpegPath: string): string {
  const executable = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  const sibling = join(dirname(ffmpegPath), executable)
  return existsSync(sibling) ? sibling : executable
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
    format === 'audio' || format === 'mp3' || mediaType === 'mp3'
  const muxerInputPath = outputPath.replace(/\.part$/i, '')
  const outExt = extname(muxerInputPath).slice(1).toLowerCase() || 'mp4'
  const outputMuxer = outExt === 'mp3' ? 'mp3' : outExt === 'mp4' ? 'mp4' : ''

  const isHls = mediaType === 'hls' || /\.m3u8(\?|#|$)/i.test(url)

  const headerMap = buildHeaderMap(referer, customHeaders)
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

  if (wantsMp3 && outExt === 'mp3') {
    args.push('-vn', '-c:a', 'libmp3lame', '-q:a', '0', '-threads', '0')
  } else {
    if (outExt === 'mp4' && isHls) {
      // Copy mux only — omit +faststart: moving moov to the head is an extra pass that hurts tail latency on long HLS.
      args.push('-c:v', 'copy', '-c:a', 'copy', '-bsf:a', 'aac_adtstoasc')
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
  let activeChild = proc
  let termination: Promise<boolean> | null = null
  const stopProcess = (): Promise<boolean> => {
    if (!termination) termination = terminateDownloadProcess(activeChild, true)
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
    if (signal?.aborted) return { valid: false, cancelled: true }

    let probe: ChildProcess
    try {
      const args = [
        '-v', 'error',
        '-show_entries', 'stream=codec_type',
        '-of', 'json',
        path
      ]
      probe = spawnManagedProcess(ffprobeExecutable(ffmpegPath), args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildSpawnEnv(),
        detached: process.platform !== 'win32'
      })
    } catch (error) {
      return { valid: false, error: `Could not start ffprobe: ${String(error)}` }
    }

    activeChild = probe
    termination = null
    const expected = expectedStreamClass(expectation.format, expectation.mediaType)
    return await new Promise<FfmpegOutputValidationResult>((resolve) => {
      let stdout = ''
      let stderr = ''
      let stdoutBytes = 0
      let timedOut = false
      let cancelled = false
      let spawnError = ''
      let settled = false

      const finish = (result: FfmpegOutputValidationResult) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        signal?.removeEventListener('abort', onAbort)
        resolve(result)
      }
      const onAbort = () => {
        cancelled = true
        void stopProcess().then(
          () => finish({ valid: false, cancelled: true }),
          () => finish({ valid: false, cancelled: true })
        )
      }
      const timeout = setTimeout(() => {
        timedOut = true
        const error = `ffprobe validation timed out after ${Math.round(FFPROBE_VALIDATION_TIMEOUT_MS / 1000)} seconds`
        void stopProcess().then(
          () => finish({ valid: false, error }),
          () => finish({ valid: false, error })
        )
      }, FFPROBE_VALIDATION_TIMEOUT_MS)
      timeout.unref?.()

      probe.stdout?.on('data', (chunk: Buffer) => {
        if (stdoutBytes + chunk.length > FFPROBE_CAPTURE_MAX_BYTES) {
          spawnError = 'ffprobe output exceeded its safety limit'
          void stopProcess().then(
            () => finish({ valid: false, error: `ffprobe validation failed: ${spawnError}` }),
            () => finish({ valid: false, error: `ffprobe validation failed: ${spawnError}` })
          )
          return
        }
        stdoutBytes += chunk.length
        stdout += chunk.toString('utf8')
      })
      probe.stderr?.on('data', (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString('utf8')}`.slice(-FFPROBE_CAPTURE_MAX_BYTES)
      })
      probe.once('error', (error) => {
        spawnError = error.message
      })
      probe.once('close', (code) => {
        if (cancelled || signal?.aborted) {
          finish({ valid: false, cancelled: true })
          return
        }
        if (timedOut) {
          finish({ valid: false, error: `ffprobe validation timed out after ${Math.round(FFPROBE_VALIDATION_TIMEOUT_MS / 1000)} seconds` })
          return
        }
        if (spawnError) {
          finish({ valid: false, error: `ffprobe validation failed: ${spawnError}` })
          return
        }
        if (code !== 0) {
          const detail = stderr.trim().split('\n').filter(Boolean).slice(-3).join('\n')
          finish({ valid: false, error: detail ? `ffprobe could not read the output: ${detail}` : `ffprobe exited with code ${code}` })
          return
        }
        let streamTypes: string[]
        try {
          const result = JSON.parse(stdout) as { streams?: Array<{ codec_type?: unknown }> }
          streamTypes = Array.isArray(result.streams)
            ? result.streams.flatMap((stream) => typeof stream?.codec_type === 'string' ? [stream.codec_type.toLowerCase()] : [])
            : []
        } catch {
          finish({ valid: false, error: 'ffprobe returned malformed output metadata' })
          return
        }
        if (!streamTypes.includes(expected)) {
          finish({
            valid: false,
            error: `FFmpeg output is missing the expected ${expected} stream${streamTypes.length ? ` (found ${[...new Set(streamTypes)].join(', ')})` : ''}`
          })
          return
        }
        finish({ valid: true })
      })
      if (signal?.aborted) onAbort()
      else signal?.addEventListener('abort', onAbort, { once: true })
    })
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

  const headerMap = buildHeaderMap(referer, customHeaders)
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
