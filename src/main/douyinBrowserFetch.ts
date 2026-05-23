/**
 * Douyin often responds to plain Node `fetch()` with an anti-bot HTML shell
 * (byted_acrawler + location.reload) and no video JSON. A hidden BrowserWindow
 * runs the same JS as Chrome and yields hydrated DOM after reload.
 */
import { BrowserWindow, session } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** Reuse one partition so __ac_* cookies survive across fetches. */
const SESSION_PARTITION = 'persist:v-download-douyin-hydrate'

/** Max wall time including reload chains (acrawler + location.reload). */
const MAX_WALL_MS = 120_000

export function isDouyinAntiBotShell(html: string): boolean {
  if (!html || html.length < 800 || html.length > 200_000) return false
  if (!/byted_acrawler\.init/i.test(html)) return false
  if (!/location\.reload/i.test(html)) return false
  if (!/<body[^>]*>\s*<\/body>/i.test(html)) return false
  return true
}

function htmlLooksHydrated(html: string): boolean {
  if (!html || html.length < 8000) return false
  if (isDouyinAntiBotShell(html)) return false
  if (
    /_ROUTER_DATA|__MODERN_ROUTER_DATA__|SIGI_STATE|id=["']RENDER_DATA["']|"item_list"|"play_addr"|"playAddr"/i.test(
      html
    )
  ) {
    return true
  }
  // Some hydrated SPAs omit _ROUTER_DATA but embed aweme JSON at scale
  if (html.length > 35_000 && /"aweme_id"\s*:\s*"\d{10,}"/.test(html)) {
    return true
  }
  return false
}

async function applyNetscapeCookiesToSession(ses: Electron.Session, cookiePath: string): Promise<void> {
  const abs = resolve(cookiePath.trim())
  if (!existsSync(abs)) return
  const content = readFileSync(abs, 'utf-8')
  for (const line of content.split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue
    const parts = line.split('\t')
    if (parts.length < 7 || !/douyin/i.test(parts[0])) continue
    const domainRaw = parts[0].trim()
    const path = parts[2] || '/'
    const secure = parts[3] === 'TRUE'
    const exp = Number(parts[4])
    const name = parts[5]
    const value = parts[6]
    if (!name) continue
    if (Number.isFinite(exp) && exp > 0 && exp < Date.now() / 1000) continue
    const domain = domainRaw.startsWith('.') ? domainRaw : `.${domainRaw}`
    const host = domain.startsWith('.') ? domain.slice(1) : domain
    const url = secure ? `https://${host}` : `https://${host}`
    try {
      await ses.cookies.set({
        url,
        name,
        value,
        domain,
        path,
        secure,
        expirationDate: Number.isFinite(exp) && exp > 0 ? exp : undefined,
      })
    } catch {
      /* ignore bad rows */
    }
  }
}

function pickChromiumUa(pageUrl: string, preferred: 'mobile' | 'desktop' | 'auto'): string {
  if (preferred === 'mobile') return MOBILE_UA
  if (preferred === 'desktop') return DESKTOP_UA
  // auto: main video page often matches mobile Safari; share hosts use desktop.
  if (/www\.douyin\.com\/video\//i.test(pageUrl)) return MOBILE_UA
  return DESKTOP_UA
}

export async function fetchDouyinHtmlWithChromium(
  pageUrl: string,
  options?: { cookiesFilePath?: string; timeoutMs?: number; preferredUa?: 'mobile' | 'desktop' | 'auto' }
): Promise<string> {
  const initialTimeout = options?.timeoutMs ?? 52_000
  const started = Date.now()
  let deadline = started + initialTimeout
  const pref = options?.preferredUa ?? 'auto'
  const ua = pickChromiumUa(pageUrl, pref)

  const bumpDeadline = () => {
    const bump = Date.now() + 30_000
    deadline = Math.min(started + MAX_WALL_MS, Math.max(deadline, bump))
  }

  const ses = session.fromPartition(SESSION_PARTITION)
  await ses.setUserAgent(ua)

  if (options?.cookiesFilePath?.trim()) {
    await applyNetscapeCookiesToSession(ses, options.cookiesFilePath)
  }

  const win = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    x: -3000,
    y: -3000,
    width: 1280,
    height: 800,
    enableLargerThanScreen: true,
    focusable: false,
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      /** Reduces offscreen Skia / shared-image glitches on macOS for hidden windows. */
      offscreen: true,
    },
  })

  win.webContents.setAudioMuted(true)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const onDidFinishLoad = () => bumpDeadline()
  const onDidStopLoading = () => bumpDeadline()
  win.webContents.on('did-finish-load', onDidFinishLoad)
  win.webContents.on('did-stop-loading', onDidStopLoading)

  const destroy = () => {
    try {
      win.webContents.removeListener('did-finish-load', onDidFinishLoad)
      win.webContents.removeListener('did-stop-loading', onDidStopLoading)
    } catch {
      /* ignore */
    }
    try {
      if (!win.isDestroyed()) win.destroy()
    } catch {
      /* ignore */
    }
  }

  try {
    await win.loadURL(pageUrl, {
      userAgent: ua,
      extraHeaders: [
        'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
        'Referer: https://www.douyin.com/',
      ].join('\n'),
    })

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 450))
      const html: string = await win.webContents.executeJavaScript(
        `document.documentElement ? document.documentElement.outerHTML : ''`
      )
      if (htmlLooksHydrated(html)) {
        console.log(`[douyin] Chromium got hydrated HTML (${html.length} bytes) for ${pageUrl}`)
        return html
      }
    }

    const last: string = await win.webContents
      .executeJavaScript(`document.documentElement ? document.documentElement.outerHTML : ''`)
      .catch(() => '')
    if (last && htmlLooksHydrated(last)) return last

    throw new Error('Timed out waiting for Douyin page to hydrate in Chromium')
  } finally {
    destroy()
  }
}
