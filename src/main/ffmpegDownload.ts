import { spawn, ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { mkdirSync, existsSync } from 'fs'
import { readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import * as settings from './settings'
import type { DownloadProcess, DownloadProgress } from './downloadTypes'
import { DEFAULT_DIRECT_MEDIA_UA } from './ytdlp'

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
  /** Known duration in seconds (for percent / ETA). */
  durationSec?: number | null
  onProgress?: (progress: DownloadProgress) => void
}

/**
 * Download a single direct media URL with ffmpeg (remux or mp3 encode).
 * Caller is responsible for routing (e.g. auto-fallback to yt-dlp on failure).
 */
export function downloadDirectMediaWithFfmpeg(options: FfmpegDirectDownloadOptions): DownloadProcess {
  const ffmpegPath = settings.get('ffmpegPath')
  const {
    url,
    outputPath,
    mediaType,
    format,
    referer,
    customHeaders,
    durationSec,
    onProgress: progressCb
  } = options

  let onProgress: (progress: DownloadProgress) => void = progressCb ?? (() => {})

  const wantsMp3 =
    format === 'audio' || format === 'mp3' || mediaType === 'mp3'
  const outMatch = outputPath.match(/\.([^.]+)$/i)
  const outExt = (outMatch?.[1] ?? 'mp4').toLowerCase()

  const isHls = mediaType === 'hls' || /\.m3u8(\?|#|$)/i.test(url)

  const headerMap = buildHeaderMap(referer, customHeaders)
  const headersArg = headersToFfmpegArg(headerMap)

  const args: string[] = ['-hide_banner', '-loglevel', 'info', '-y']

  /** Reuse TLS connections where supported — small win for many HLS segment requests. */
  if (/^https?:\/\//i.test(url)) {
    args.push('-http_persistent', '1')
  }

  if (isHls) {
    args.push('-protocol_whitelist', 'file,http,https,tcp,tls,crypto,udp')
  }

  args.push(
    '-headers',
    headersArg,
    '-reconnect',
    '1',
    '-reconnect_streamed',
    '1',
    '-reconnect_delay_max',
    '5',
    '-i',
    url
  )

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

  args.push('-max_muxing_queue_size', '4096', outputPath)

  const proc = spawn(ffmpegPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildSpawnEnv()
  })

  const destinations: string[] = [outputPath]
  let stderrBuf = ''
  let lastEmit = 0

  const emitFromLine = (line: string) => {
    const parsed = parseFfmpegProgressLine(line)
    if (!parsed) return

    const dur = durationSec != null && durationSec > 0 ? durationSec : null
    let percent: number
    let eta = ''
    if (dur != null) {
      percent = Math.min(99, Math.max(0, (100 * parsed.sec) / dur))
      const remain = dur - parsed.sec
      if (remain > 0) eta = formatEta(remain)
    } else {
      // Unknown total duration: map decoded timeline position to 1–99% (asymptotic, no false 95% ceiling).
      const t = Math.max(0, parsed.sec)
      percent = Math.min(99, Math.max(1, (100 * (t + 2)) / (t + 90)))
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
    stderrBuf += text
    for (const line of text.split('\n')) {
      if (line.includes('time=')) {
        emitFromLine(line)
      }
    }
  }

  proc.stdout?.on('data', drain)
  proc.stderr?.on('data', drain)

  const downloadProcess: DownloadProcess = {
    process: proc as ChildProcess,
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
    getDestinations: () => [...destinations]
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
}): Promise<string | null> {
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

  const proc = spawn(ffmpegPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildSpawnEnv()
  })

  const code = await new Promise<number>((resolve) => {
    let done = false
    const t = setTimeout(() => {
      if (done) return
      done = true
      try {
        proc.kill('SIGKILL')
      } catch {
        /* */
      }
      resolve(124)
    }, THUMB_EXTRACT_TIMEOUT_MS)
    proc.on('close', (c) => {
      if (done) return
      done = true
      clearTimeout(t)
      resolve(c ?? 1)
    })
    proc.on('error', () => {
      if (done) return
      done = true
      clearTimeout(t)
      resolve(1)
    })
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
