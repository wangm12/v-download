import { app } from 'electron'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs'
import { execFileSync } from 'child_process'
import { getQueueConcurrencyPolicy, type QueueConcurrencyPolicy } from '@v-download/shared'
import { normalizeProxyUrl } from './settingsModel'

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
  siteRules: SiteRule[]
  /** Optional proxy applied to yt-dlp requests. */
  proxyUrl: string
  /** Set only after the first-run setup wizard has been completed. */
  onboardingCompleted: boolean
  /** Off by default. When on, main serves /v1 jobs on remoteApiBind:remoteApiPort. */
  remoteApiEnabled: boolean
  remoteApiToken: string
  remoteApiBind: '127.0.0.1' | '0.0.0.0'
  remoteApiPort: number
}

export interface SiteRule {
  id: string
  domain: string
  format: 'best' | 'video' | 'audio'
  quality: string
  enabled: boolean
}

export type DownloadSpeedMode = SettingsSchema['downloadSpeedMode']
export type DownloadConcurrencyPolicy = QueueConcurrencyPolicy

/** Additive policy description for queue/settings consumers; legacy fields remain authoritative. */
export function getDownloadConcurrencyPolicy(mode: DownloadSpeedMode = get('downloadSpeedMode')): DownloadConcurrencyPolicy {
  return getQueueConcurrencyPolicy(mode)
}

function findBinary(name: string): string {
  const packaged = join(process.resourcesPath ?? join(process.cwd(), 'resources'), 'engines', `${process.platform}-${process.arch}`, process.platform === 'win32' ? `${name}.exe` : name)
  if (existsSync(packaged)) return packaged
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
    // `name` is an internal constant, never renderer-controlled; argv avoids shell parsing.
    return execFileSync(which, [name], { encoding: 'utf-8' }).trim().split('\n')[0]
  } catch {
    return ''
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
  ytdlpExternalDownloader: '',
  siteRules: [],
  proxyUrl: '',
  onboardingCompleted: false,
  remoteApiEnabled: false,
  remoteApiToken: '',
  remoteApiBind: '127.0.0.1',
  remoteApiPort: 18766
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
    const parsed = JSON.parse(raw) as Partial<SettingsSchema>
    cache = {
      ...defaults,
      ...parsed,
      // Existing installs already have working defaults; only new settings files
      // should enter the first-run wizard.
      onboardingCompleted: Object.prototype.hasOwnProperty.call(parsed, 'onboardingCompleted')
        ? Boolean(parsed.onboardingCompleted)
        : true
    }
  } catch {
    cache = { ...defaults }
    if (!cache.downloadDir) cache.downloadDir = app.getPath('downloads')
  }
  if (!cache!.downloadDir) cache!.downloadDir = app.getPath('downloads')
  normalizeLoadedSettings(cache!)
  return cache!
}

function normalizeLoadedSettings(s: SettingsSchema): void {
  let concurrency = Number(s.concurrency)
  if (!Number.isFinite(concurrency)) concurrency = 3
  s.concurrency = Math.min(3, Math.max(1, Math.floor(concurrency)))
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
  s.proxyUrl = normalizeProxyUrl(s.proxyUrl)
  s.onboardingCompleted = Boolean(s.onboardingCompleted)
  s.remoteApiEnabled = Boolean(s.remoteApiEnabled)
  s.remoteApiToken = typeof s.remoteApiToken === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(s.remoteApiToken)
    ? s.remoteApiToken
    : ''
  s.remoteApiBind = s.remoteApiBind === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1'
  let remotePort = Number(s.remoteApiPort)
  if (!Number.isFinite(remotePort) || remotePort === 18765) remotePort = 18766
  s.remoteApiPort = Math.min(65535, Math.max(1024, Math.floor(remotePort)))
  s.siteRules = Array.isArray(s.siteRules) ? s.siteRules.filter((rule): rule is SiteRule => {
    return Boolean(rule && typeof rule.id === 'string' && typeof rule.domain === 'string' && rule.domain.trim() &&
      ['best', 'video', 'audio'].includes(rule.format) && typeof rule.quality === 'string' &&
      true)
  }).map((rule) => { const { engine: _ignored, ...clean } = rule as SiteRule & { engine?: unknown }; const quality = Number(clean.quality); const fallback = clean.format === 'audio' ? '320' : '1080'; return { ...clean, domain: clean.domain.trim().toLowerCase(), quality: Number.isFinite(quality) && quality > 0 ? String(Math.round(quality)) : fallback, enabled: Boolean(clean.enabled) } }) : []
}

function save(): void {
  try {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(getSettingsPath(), JSON.stringify(cache, null, 2), 'utf-8')
    try { chmodSync(getSettingsPath(), 0o600) } catch { /* best effort */ }
  } catch (err) {
    console.error('Failed to save settings:', err)
  }
}

export function generateRemoteApiToken(): string {
  return randomBytes(24).toString('hex')
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
    cache.concurrency = 3
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
  if (key === 'remoteApiEnabled' && cache!.remoteApiEnabled && !cache!.remoteApiToken) {
    cache!.remoteApiToken = generateRemoteApiToken()
  }
  if (key === 'remoteApiToken' && !String(cache!.remoteApiToken || '').trim()) {
    cache!.remoteApiToken = generateRemoteApiToken()
  }
  normalizeLoadedSettings(cache!)
  save()
}

export function validateSettingUpdate(key: string, value: unknown): value is SettingsSchema[keyof SettingsSchema] {
  if (key === 'cookiesPath') return false
  if (typeof value === 'string' && value.length > 4096) return false
  if (['downloadDir', 'douyinBulkRunPyPath', 'douyinBulkConfigPath', 'douyinBulkOutputPath', 'ytdlpPath', 'ffmpegPath'].includes(key) && typeof value === 'string' && (value.length === 0 || /[\0\r\n]/.test(value))) return false
  if (['showFormatDialog', 'playlistSubfolder', 'douyinUseCloakBrowser', 'turboRiskAcknowledged', 'douyinBulkVerboseWarnings', 'onboardingCompleted', 'remoteApiEnabled'].includes(key)) return typeof value === 'boolean'
  // Accept legacy persisted/update values (including 0 and values above 3); set() normalizes concurrency to 1..3.
  if (['concurrency', 'sleepInterval', 'youtubePlaylistSleepRequests', 'youtubePlaylistMaxDownloads', 'douyinBulkThreads', 'concurrentFragments'].includes(key)) return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
  if (key === 'remoteApiPort') return typeof value === 'number' && Number.isFinite(value) && value >= 1024 && value <= 65535 && value !== 18765
  if (key === 'remoteApiBind') return value === '127.0.0.1' || value === '0.0.0.0'
  if (key === 'remoteApiToken') return typeof value === 'string' && (value === '' || /^[A-Za-z0-9_-]{16,128}$/.test(value))
  if (['defaultVideoQuality', 'defaultAudioQuality'].includes(key)) return typeof value === 'string' && /^(?:\d{1,4}|best)$/.test(value)
  if (['cookiesFromBrowser', 'douyinBulkRunPyPath', 'douyinBulkConfigPath', 'douyinBulkOutputPath', 'ytdlpPath', 'ffmpegPath', 'ytdlpExternalDownloader'].includes(key)) return typeof value === 'string' && !/[\0\r\n]/.test(value)
  if (key === 'downloadDir') return typeof value === 'string' && value.length > 0
  if (key === 'directMediaEngine') return value === 'auto' || value === 'ffmpeg' || value === 'ytdlp'
  if (key === 'youtubePlaylistMode') return value === 'native' || value === 'fanout'
  if (key === 'proxyUrl') return typeof value === 'string' && (value.trim() === '' || normalizeProxyUrl(value) !== '')
  if (key === 'siteRules') return Array.isArray(value) && value.length <= 100 && value.every((rule) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return false
    const r = rule as Record<string, unknown>; const allowed = new Set(['id', 'domain', 'format', 'quality', 'enabled'])
    if (Object.keys(r).some((k) => !allowed.has(k))) return false
    return typeof r.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(r.id) && typeof r.domain === 'string' && /^[a-z0-9.-]{1,253}$/i.test(r.domain) && !r.domain.startsWith('.') && typeof r.quality === 'string' && /^(?:\d{1,4}|best)$/.test(r.quality) && (r.format === 'best' || r.format === 'video' || r.format === 'audio') && typeof r.enabled === 'boolean'
  })
  return false
}

export function getCookiesPath(): string {
  const path = get('cookiesPath')
  if (!path || path.trim() === '') return ''
  return path.trim()
}
