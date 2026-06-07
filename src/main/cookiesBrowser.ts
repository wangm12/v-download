/**
 * Shared browser profile config for Douyin cookies and Playwright recovery launch.
 */
import { existsSync } from 'fs'
import { homedir, platform } from 'os'
import { join } from 'path'
import * as settings from './settings'

export interface PlaywrightLaunchOptions {
  channel?: 'chrome' | 'msedge' | 'chrome-beta' | 'chrome-dev' | 'msedge-beta' | 'msedge-dev'
  executablePath?: string
}

const BROWSER_NAME_RE = /^[a-zA-Z0-9_.\-: ]+$/

/** yt-dlp `--cookies-from-browser` value; sanitized so argv cannot be abused via settings.json. */
export function resolvedCookiesBrowser(): string {
  const raw = settings.get('cookiesFromBrowser')
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s || s.length > 120) return 'chrome'
  if (!BROWSER_NAME_RE.test(s)) return 'chrome'
  return s
}

function macAppPath(appName: string, binary: string): string {
  return join('/Applications', `${appName}.app`, 'Contents', 'MacOS', binary)
}

function resolveMacExecutable(browser: string): string | undefined {
  switch (browser) {
    case 'chrome':
      return macAppPath('Google Chrome', 'Google Chrome')
    case 'chromium':
      return macAppPath('Chromium', 'Chromium')
    case 'brave':
      return macAppPath('Brave Browser', 'Brave Browser')
    case 'edge':
      return macAppPath('Microsoft Edge', 'Microsoft Edge')
    case 'opera':
      return macAppPath('Opera', 'Opera')
    case 'vivaldi':
      return macAppPath('Vivaldi', 'Vivaldi')
    default:
      return undefined
  }
}

function resolveLinuxExecutable(browser: string): string | undefined {
  const home = homedir()
  switch (browser) {
    case 'chrome':
      return '/usr/bin/google-chrome'
    case 'chromium':
      return '/usr/bin/chromium-browser'
    case 'brave':
      return '/usr/bin/brave-browser'
    case 'edge':
      return '/usr/bin/microsoft-edge'
    case 'opera':
      return '/usr/bin/opera'
    case 'vivaldi':
      return '/usr/bin/vivaldi'
    default:
      return join(home, '.local', 'share', 'applications', `${browser}.desktop`)
  }
}

function resolveWinExecutable(browser: string): string | undefined {
  const local = process.env.LOCALAPPDATA ?? ''
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  switch (browser) {
    case 'chrome':
      return join(local, 'Google', 'Chrome', 'Application', 'chrome.exe')
    case 'chromium':
      return join(pf, 'Chromium', 'Application', 'chrome.exe')
    case 'brave':
      return join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
    case 'edge':
      return join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    case 'opera':
      return join(local, 'Programs', 'Opera', 'launcher.exe')
    case 'vivaldi':
      return join(local, 'Vivaldi', 'Application', 'vivaldi.exe')
    default:
      return undefined
  }
}

/** Map settings browser id → Playwright launch options. null = auto-recovery unsupported (Firefox/Safari). */
export function mapBrowserToPlaywrightLaunch(browser: string): PlaywrightLaunchOptions | null {
  const b = browser.trim().toLowerCase()
  if (b === 'firefox' || b === 'safari') return null
  if (b === 'chrome') return { channel: 'chrome' }
  if (b === 'edge') return { channel: 'msedge' }

  let executablePath: string | undefined
  if (platform() === 'darwin') {
    executablePath = resolveMacExecutable(b)
  } else if (platform() === 'win32') {
    executablePath = resolveWinExecutable(b)
  } else {
    executablePath = resolveLinuxExecutable(b)
  }
  if (executablePath && existsSync(executablePath)) {
    return { executablePath }
  }
  // Chromium-based fallback when path unknown
  if (b === 'chromium') return { channel: 'chrome' }
  return { channel: 'chrome' }
}

/** macOS `open -a` application name for configured browser. */
export function mapBrowserToOpenApp(browser: string): string | null {
  switch (browser.trim().toLowerCase()) {
    case 'chrome':
      return 'Google Chrome'
    case 'chromium':
      return 'Chromium'
    case 'brave':
      return 'Brave Browser'
    case 'edge':
      return 'Microsoft Edge'
    case 'opera':
      return 'Opera'
    case 'vivaldi':
      return 'Vivaldi'
    case 'firefox':
      return 'Firefox'
    case 'safari':
      return 'Safari'
    default:
      return null
  }
}

/** Windows executable for configured browser (best-effort). */
export function mapBrowserToWinExecutable(browser: string): string | undefined {
  const p = resolveWinExecutable(browser.trim().toLowerCase())
  return p && existsSync(p) ? p : undefined
}
