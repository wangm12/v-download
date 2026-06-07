import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { execSync } from 'child_process'

export interface SettingsSchema {
  downloadDir: string
  concurrency: number
  showFormatDialog: boolean
  playlistSubfolder: boolean
  defaultVideoQuality: string
  defaultAudioQuality: string
  sleepInterval: number
  cookiesPath: string
  /** Passed to yt-dlp `--cookies-from-browser` for Douyin (e.g. chrome, brave, edge). */
  cookiesFromBrowser: string
  /**
   * When true, Douyin HTML hydration uses CloakBrowser (patched Chromium + Playwright)
   * instead of Electron’s embedded Chromium. First run downloads ~200MB binary to cache.
   */
  douyinUseCloakBrowser: boolean
  /** YouTube playlists: one yt-dlp job vs per-video tasks. */
  youtubePlaylistMode: 'native' | 'fanout'
  youtubePlaylistSleepRequests: number
  /** 0 = no limit; passed as --max-downloads for native playlist. */
  youtubePlaylistMaxDownloads: number
  douyinBulkRunPyPath: string
  douyinBulkConfigPath: string
  /**
   * Optional override for douyin-downloader `-p` / `--path`. Empty = use `downloadDir`.
   * Keeps bulk output aligned with the app’s default save location.
   */
  douyinBulkOutputPath: string
  /** Passed to douyin-downloader `-t` / `--thread` (worker threads inside the tool). Clamped 1–32. */
  douyinBulkThreads: number
  /** When true, append `--show-warnings` for richer stderr (troubleshooting). */
  douyinBulkVerboseWarnings: boolean
  ytdlpPath: string
  ffmpegPath: string
  /**
   * Sniffed / extension direct URLs (`mediaType`): try ffmpeg first, force yt-dlp only, or auto with fallback.
   */
  directMediaEngine: 'auto' | 'ffmpeg' | 'ytdlp'
  /** yt-dlp `--concurrent-fragments` for direct-media tasks (HLS). Clamped 1–32. */
  concurrentFragments: number
  /**
   * Preset that sets recommended concurrency / sleep / fragments / engine when applied from Preferences.
   * Individual fields remain the source of truth after apply; changing steppers does not auto-switch this label.
   */
  downloadSpeedMode: 'balanced' | 'turbo' | 'gentle'
  /** User confirmed the Turbo risk disclaimer (429 / account throttling). Shown once before first Turbo apply. */
  turboRiskAcknowledged: boolean
  /**
   * Optional yt-dlp `--downloader` name (e.g. aria2c). Empty = built-in downloader only.
   * Must be a short safe token; validated in normalizeLoadedSettings.
   */
  ytdlpExternalDownloader: string
}

function findBinary(name: string): string {
  const platformPaths: Record<string, string[]> = {
    darwin: [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`],
    linux: [`/usr/bin/${name}`, `/usr/local/bin/${name}`, `/snap/bin/${name}`],
    win32: [`C:\\ProgramData\\chocolatey\\bin\\${name}.exe`]
  }

  const candidates = platformPaths[process.platform] ?? []
  for (const p of candidates) {
    if (existsSync(p)) return p
  }

  try {
    const which = process.platform === 'win32' ? 'where' : 'which'
    return execSync(`${which} ${name}`, { encoding: 'utf-8' }).trim().split('\n')[0]
  } catch {
    return candidates[0] ?? name
  }
}

const defaults: SettingsSchema = {
  downloadDir: '',
  concurrency: 3,
  showFormatDialog: true,
  playlistSubfolder: true,
  defaultVideoQuality: '1080',
  defaultAudioQuality: '320',
  sleepInterval: 3,
  cookiesPath: '',
  cookiesFromBrowser: 'chrome',
  douyinUseCloakBrowser: false,
  youtubePlaylistMode: 'native',
  youtubePlaylistSleepRequests: 0,
  youtubePlaylistMaxDownloads: 0,
  douyinBulkRunPyPath: '',
  douyinBulkConfigPath: '',
  douyinBulkOutputPath: '',
  douyinBulkThreads: 5,
  douyinBulkVerboseWarnings: false,
  ytdlpPath: findBinary('yt-dlp'),
  ffmpegPath: findBinary('ffmpeg'),
  directMediaEngine: 'auto',
  concurrentFragments: 5,
  downloadSpeedMode: 'balanced',
  turboRiskAcknowledged: false,
  ytdlpExternalDownloader: ''
}

let settingsPath = ''
let cache: SettingsSchema | null = null

function getSettingsPath(): string {
  if (!settingsPath) {
    const dir = app.getPath('userData')
    settingsPath = join(dir, 'settings.json')
  }
  return settingsPath
}

function load(): SettingsSchema {
  if (cache) return cache
  try {
    const raw = readFileSync(getSettingsPath(), 'utf-8')
    cache = { ...defaults, ...JSON.parse(raw) }
  } catch {
    cache = { ...defaults }
    if (!cache.downloadDir) cache.downloadDir = app.getPath('downloads')
  }
  if (!cache!.downloadDir) cache!.downloadDir = app.getPath('downloads')
  normalizeLoadedSettings(cache!)
  return cache!
}

function normalizeLoadedSettings(s: SettingsSchema): void {
  if (s.directMediaEngine !== 'auto' && s.directMediaEngine !== 'ffmpeg' && s.directMediaEngine !== 'ytdlp') {
    s.directMediaEngine = 'auto'
  }
  let n = Number(s.concurrentFragments)
  if (!Number.isFinite(n)) n = 5
  s.concurrentFragments = Math.min(32, Math.max(1, Math.floor(n)))
  if (s.downloadSpeedMode !== 'balanced' && s.downloadSpeedMode !== 'turbo' && s.downloadSpeedMode !== 'gentle') {
    s.downloadSpeedMode = 'balanced'
  }
  s.turboRiskAcknowledged = Boolean(s.turboRiskAcknowledged)
  const dl = typeof s.ytdlpExternalDownloader === 'string' ? s.ytdlpExternalDownloader.trim() : ''
  s.ytdlpExternalDownloader = /^[a-zA-Z0-9_-]{1,32}$/.test(dl) ? dl : ''
  s.douyinBulkOutputPath = typeof s.douyinBulkOutputPath === 'string' ? s.douyinBulkOutputPath.trim() : ''
  let bt = Number(s.douyinBulkThreads)
  if (!Number.isFinite(bt)) bt = 5
  s.douyinBulkThreads = Math.min(32, Math.max(1, Math.floor(bt)))
  s.douyinBulkVerboseWarnings = Boolean(s.douyinBulkVerboseWarnings)
}

function save(): void {
  try {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(getSettingsPath(), JSON.stringify(cache, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to save settings:', err)
  }
}

/** Apply queue + yt-dlp tuning presets for the download speed mode (see Preferences). */
export function applyDownloadSpeedMode(
  mode: 'balanced' | 'turbo' | 'gentle',
  opts?: { acknowledgeTurboRisk?: boolean }
): 'ok' | 'turbo_ack_required' {
  load()
  if (!cache) return 'ok'
  if (mode === 'turbo' && !cache.turboRiskAcknowledged && !opts?.acknowledgeTurboRisk) {
    return 'turbo_ack_required'
  }
  if (mode === 'balanced') {
    cache.concurrency = 3
    cache.sleepInterval = 3
    cache.concurrentFragments = 5
    cache.directMediaEngine = 'auto'
  } else if (mode === 'turbo') {
    cache.concurrency = Math.min(10, Math.max(1, 8))
    cache.sleepInterval = 0
    cache.concurrentFragments = Math.min(32, Math.max(1, 16))
    cache.directMediaEngine = 'ytdlp'
    cache.turboRiskAcknowledged = true
  } else {
    cache.concurrency = 1
    cache.sleepInterval = 5
    cache.concurrentFragments = 2
    cache.directMediaEngine = 'auto'
  }
  cache.downloadSpeedMode = mode
  normalizeLoadedSettings(cache)
  save()
  return 'ok'
}

export function getAll(): SettingsSchema {
  return { ...load() }
}

export function get<K extends keyof SettingsSchema>(key: K): SettingsSchema[K] {
  return load()[key]
}

export function set<K extends keyof SettingsSchema>(key: K, value: SettingsSchema[K]): void {
  load()
  cache![key] = value
  normalizeLoadedSettings(cache!)
  save()
}

export function getCookiesPath(): string {
  const path = get('cookiesPath')
  if (!path || path.trim() === '') return ''
  return path.trim()
}
