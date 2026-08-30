import { app, BrowserWindow, session } from 'electron'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildNetscapeCookieFile } from '@v-download/shared'
import {
  cookieDomainMatchesHost,
  nativeAuthHost,
  nativeAuthSiteForUrl,
  nativeAuthSites,
  sanitizeNativeCookie,
  type NativeAuthSite,
  type NativeCookie
} from './nativeAuthModel'
export { nativeAuthSites } from './nativeAuthModel'
export type { NativeAuthSite } from './nativeAuthModel'

export interface NativeAuthAccountStatus {
  site: NativeAuthSite
  host: string
  connected: boolean
  cookieCount: number
  lastSyncedAt: string | null
}

export type NativeAuthEvent =
  | { type: 'opened'; site: NativeAuthSite }
  | { type: 'saved'; site: NativeAuthSite; account: NativeAuthAccountStatus }
  | { type: 'error'; site: NativeAuthSite; message: string }

interface StoredAuth {
  cookies: NativeCookie[]
  lastSyncedAt: string
}

interface ActiveAuthWindow {
  window: BrowserWindow
  capturing: boolean
}

const KEYCHAIN_ACCOUNT = 'v-download'
const keychainCache = new Map<NativeAuthSite, StoredAuth | null>()
const activeWindows = new Map<NativeAuthSite, ActiveAuthWindow>()

function serviceName(site: NativeAuthSite): string {
  return `v-download.native-auth.${site}`
}

function keychainAvailable(): boolean {
  return process.platform === 'darwin'
}

function readKeychain(site: NativeAuthSite): StoredAuth | null {
  if (!keychainAvailable()) return null
  if (keychainCache.has(site)) return keychainCache.get(site) ?? null
  try {
    const raw = execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', serviceName(site), '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim()
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const cookies = Array.isArray(parsed.cookies)
      ? parsed.cookies.map(sanitizeNativeCookie).filter((cookie): cookie is NativeCookie => cookie !== null)
      : []
    const lastSyncedAt = typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : ''
    const stored = lastSyncedAt ? { cookies, lastSyncedAt } : null
    keychainCache.set(site, stored)
    return stored
  } catch {
    keychainCache.set(site, null)
    return null
  }
}

function writeKeychain(site: NativeAuthSite, cookies: NativeCookie[]): StoredAuth {
  if (!keychainAvailable()) throw new Error('Native account login is currently supported on macOS only.')
  const stored: StoredAuth = { cookies, lastSyncedAt: new Date().toISOString() }
  execFileSync(
    '/usr/bin/security',
    [
      'add-generic-password',
      '-a',
      KEYCHAIN_ACCOUNT,
      '-s',
      serviceName(site),
      '-w',
      JSON.stringify(stored),
      '-U'
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  )
  keychainCache.set(site, stored)
  return stored
}

function cookieFilePath(site: NativeAuthSite): string {
  return join(app.getPath('userData'), 'native-cookies', `${site}.txt`)
}

function writeCookieFile(site: NativeAuthSite, cookies: NativeCookie[]): void {
  const path = cookieFilePath(site)
  const dir = join(path, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(path, buildNetscapeCookieFile(cookies, { headerNote: 'V-Download native browser session' }), { mode: 0o600 })
  chmodSync(path, 0o600)
}

function deleteCookieFile(site: NativeAuthSite): void {
  try {
    unlinkSync(cookieFilePath(site))
  } catch {
    /* no saved file */
  }
}

export function nativeAuthPageUrl(site: NativeAuthSite): string {
  switch (site) {
    case 'youtube':
      return 'https://accounts.google.com/ServiceLogin?service=youtube'
    case 'douyin':
      return 'https://www.douyin.com/'
    case 'tiktok':
      return 'https://www.tiktok.com/login'
    case 'bilibili':
      return 'https://passport.bilibili.com/login'
    case 'xiaohongshu':
      return 'https://www.xiaohongshu.com/'
    case 'x':
      return 'https://x.com/i/flow/login'
  }
}

function accountStatus(site: NativeAuthSite, stored = readKeychain(site)): NativeAuthAccountStatus {
  const cookies = stored?.cookies ?? []
  return {
    site,
    host: nativeAuthHost(site),
    connected: cookies.length > 0,
    cookieCount: cookies.length,
    lastSyncedAt: stored?.lastSyncedAt ?? null
  }
}

export function listNativeAuthAccounts(): NativeAuthAccountStatus[] {
  return nativeAuthSites().map((site) => accountStatus(site))
}

export function initializeNativeAuth(): void {
  for (const site of nativeAuthSites()) readKeychain(site)
}

export function beginNativeAuth(site: NativeAuthSite, emit: (event: NativeAuthEvent) => void): { ok: boolean; error?: string } {
  if (!keychainAvailable()) return { ok: false, error: 'Native account login is currently supported on macOS only.' }
  const existing = activeWindows.get(site)
  if (existing && !existing.window.isDestroyed()) {
    existing.window.show()
    existing.window.focus()
    return { ok: true }
  }

  const authSession = session.fromPartition(`persist:v-download-native-auth-${site}`)
  const window = new BrowserWindow({
    width: 1060,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    title: `Connect ${nativeAuthHost(site)} — V-Download`,
    backgroundColor: '#0b0b0b',
    webPreferences: {
      session: authSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const active: ActiveAuthWindow = { window, capturing: false }
  activeWindows.set(site, active)

  const capture = async (): Promise<void> => {
    if (active.capturing) return
    active.capturing = true
    try {
      const cookies = (await authSession.cookies.get({}))
        .map(sanitizeNativeCookie)
        .filter((cookie): cookie is NativeCookie => cookie !== null)
      if (cookies.length === 0) {
        emit({ type: 'error', site, message: 'No cookies were found. Finish signing in, then close the login window.' })
      } else {
        const stored = writeKeychain(site, cookies)
        writeCookieFile(site, cookies)
        emit({ type: 'saved', site, account: accountStatus(site, stored) })
      }
    } catch (err) {
      emit({ type: 'error', site, message: err instanceof Error ? err.message : String(err) })
    } finally {
      activeWindows.delete(site)
      if (!window.isDestroyed()) window.destroy()
    }
  }

  window.on('close', (event) => {
    if (active.capturing) return
    event.preventDefault()
    void capture()
  })
  window.on('closed', () => {
    activeWindows.delete(site)
  })
  emit({ type: 'opened', site })
  window.loadURL(nativeAuthPageUrl(site)).catch((err: unknown) => {
    emit({ type: 'error', site, message: err instanceof Error ? err.message : String(err) })
    if (!window.isDestroyed()) window.destroy()
  })
  window.show()
  return { ok: true }
}

export function clearNativeAuth(site: NativeAuthSite): { ok: boolean; error?: string } {
  if (!keychainAvailable()) return { ok: false, error: 'Native account login is currently supported on macOS only.' }
  try {
    execFileSync(
      '/usr/bin/security',
      ['delete-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', serviceName(site)],
      { stdio: ['ignore', 'ignore', 'ignore'] }
    )
  } catch {
    /* The item may already be absent. */
  }
  keychainCache.set(site, null)
  deleteCookieFile(site)
  return { ok: true }
}

export function getNativeCookieFileForUrl(url: string): string | null {
  if (!app.isReady()) return null
  const site = nativeAuthSiteForUrl(url)
  if (!site) return null
  const stored = readKeychain(site)
  if (!stored?.cookies.length) return null
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return null
  }
  const matching = stored.cookies.filter((cookie) => cookieDomainMatchesHost(cookie.domain, host))
  if (matching.length === 0) return null
  const path = cookieFilePath(site)
  try {
    if (!existsSync(path)) writeCookieFile(site, stored.cookies)
    return path
  } catch {
    return null
  }
}

export function stopNativeAuthWindows(): void {
  for (const active of activeWindows.values()) {
    if (!active.window.isDestroyed()) active.window.destroy()
  }
  activeWindows.clear()
}
