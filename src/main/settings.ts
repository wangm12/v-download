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
  ytdlpPath: string
  ffmpegPath: string
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
  ytdlpPath: findBinary('yt-dlp'),
  ffmpegPath: findBinary('ffmpeg')
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
  return cache!
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

export function getAll(): SettingsSchema {
  return { ...load() }
}

export function get<K extends keyof SettingsSchema>(key: K): SettingsSchema[K] {
  return load()[key]
}

export function set<K extends keyof SettingsSchema>(key: K, value: SettingsSchema[K]): void {
  load()
  cache![key] = value
  save()
}

export function getCookiesPath(): string {
  const path = get('cookiesPath')
  if (!path || path.trim() === '') return ''
  return path.trim()
}
