/**
 * Douyin often responds to plain Node `fetch()` with an anti-bot HTML shell
 * (byted_acrawler + location.reload) and no video JSON. A hidden BrowserWindow
 * runs the same JS as Chrome and yields hydrated DOM after reload.
 *
 * Optional: enable "Use CloakBrowser for Douyin" in Settings (or
 * V_DOWNLOAD_CLOAKBROWSER=1) to use CloakBrowser's patched Chromium via
 * Playwright instead of Electron's engine. See README for licensing and footprint.
 */
import { BrowserWindow, session, app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import type { BrowserContext } from 'playwright-core'
import * as settings from './settings'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** Reuse one partition so __ac_* cookies survive across fetches. */
const SESSION_PARTITION = 'persist:v-download-douyin-hydrate'

/** Max wall time including reload chains (acrawler + location.reload). */
const MAX_WALL_MS = 120_000

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function isDouyinAntiBotShell(html: string): boolean {
  if (!html || html.length < 800 || html.length > 200_000) return false
  if (!/byted_acrawler\.init/i.test(html)) return false
  if (!/location\.reload/i.test(html)) return false
  if (!/<body[^>]*>\s*<\/body>/i.test(html)) return false
  return true
}

/** True when HTML likely contains embeddable Douyin video JSON (Electron or Cloak polling). */
export function htmlLooksHydrated(html: string): boolean {
  if (!html || html.length < 8000) return false
  if (isDouyinAntiBotShell(html)) return false
  if (
    /_ROUTER_DATA|__MODERN_ROUTER_DATA__|SIGI_STATE|id=["']RENDER_DATA["']|"item_list"|"play_addr"|"playAddr"/i.test(
      html
    )
  ) {
    return true
  }
  // iesdouyin / share SPAs sometimes omit _ROUTER_DATA but ship Next.js or Byte embeds
  if (
    html.length >= 12_000 &&
    /id=["']__NEXT_DATA__["']|"aweme_detail"|"awemeDetail"|"videoInfoRes"|"SUPER_DATA"\s*=|window\.__INITIAL_STATE__|SSR_RENDER_DATA/i.test(
      html
    )
  ) {
    return true
  }
  if (html.length > 35_000 && /"aweme_id"\s*:\s*"\d{10,}"/.test(html)) {
    return true
  }
  return false
}

type PwCookie = {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite: 'Strict' | 'Lax' | 'None'
}

/** Netscape file → Playwright `addCookies` (Douyin / ByteDance related domains only). */
function netscapeToPlaywrightCookies(absPath: string): PwCookie[] {
  if (!existsSync(absPath)) return []
  const out: PwCookie[] = []
  for (const line of readFileSync(absPath, 'utf-8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue
    const p = line.split('\t')
    if (p.length < 7) continue
    const [domain, , path, secureStr, expiresStr, name, value] = p
    if (!/douyin|iesdouyin|byte|snssdk|aweme|toutiao/i.test(domain)) continue
    const exp = parseInt(expiresStr, 10)
    const secure = secureStr === 'TRUE'
    out.push({
      name,
      value,
      domain: domain.trim(),
      path: path?.trim() || '/',
      expires: exp > 0 ? exp : -1,
      httpOnly: false,
      secure,
      sameSite: 'Lax',
    })
  }
  return out
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
  if (/www\.douyin\.com\/video\//i.test(pageUrl)) return MOBILE_UA
  return DESKTOP_UA
}

function useCloakBrowserEngine(): boolean {
  return process.env.V_DOWNLOAD_CLOAKBROWSER === '1' || settings.get('douyinUseCloakBrowser') === true
}

async function fetchDouyinHtmlWithCloakBrowser(
  pageUrl: string,
  options?: { cookiesFilePath?: string; timeoutMs?: number; preferredUa?: 'mobile' | 'desktop' | 'auto' }
): Promise<string> {
  const initialTimeout = options?.timeoutMs ?? 52_000
  const started = Date.now()
  let deadline = started + initialTimeout
  const pref = options?.preferredUa ?? 'auto'
  const ua = pickChromiumUa(pageUrl, pref)
  const isMobile = ua === MOBILE_UA

  const bumpDeadline = () => {
    const bump = Date.now() + 30_000
    deadline = Math.min(started + MAX_WALL_MS, Math.max(deadline, bump))
  }

  let ctx: BrowserContext | null = null
  try {
    const { launchPersistentContext, ensureBinary } = await import('cloakbrowser')
    try {
      await ensureBinary()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(
        `CloakBrowser binary could not be downloaded (${msg}). Check network or disable “Use CloakBrowser for Douyin” in Settings.`
      )
    }

    const userDataDir = join(app.getPath('userData'), 'cloak-douyin-profile')
    ctx = await launchPersistentContext({
      userDataDir,
      headless: true,
      locale: 'zh-CN',
      userAgent: ua,
      viewport: isMobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    })

    if (options?.cookiesFilePath?.trim()) {
      const abs = resolve(options.cookiesFilePath.trim())
      const cookies = netscapeToPlaywrightCookies(abs)
      if (cookies.length > 0) {
        await ctx.addCookies(cookies)
        console.log(`[douyin:cloak] Injected ${cookies.length} cookies from Netscape file`)
      }
    }

    const page = ctx.pages()[0] ?? (await ctx.newPage())
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: 'https://www.douyin.com/',
    })

    await page.goto(pageUrl, {
      timeout: initialTimeout,
      waitUntil: 'domcontentloaded',
    })
    bumpDeadline()

    while (Date.now() < deadline) {
      await sleep(450)
      bumpDeadline()
      const html = await page.content()
      if (htmlLooksHydrated(html)) {
        console.log(`[douyin] CloakBrowser got hydrated HTML (${html.length} bytes) for ${pageUrl}`)
        return html
      }
    }

    const last = await page.content().catch(() => '')
    if (last && htmlLooksHydrated(last)) {
      console.log(`[douyin] CloakBrowser got hydrated HTML (${last.length} bytes, final poll) for ${pageUrl}`)
      return last
    }

    throw new Error('Timed out waiting for Douyin page to hydrate in CloakBrowser')
  } finally {
    if (ctx) {
      try {
        await ctx.close()
      } catch {
        /* ignore */
      }
    }
  }
}

async function fetchDouyinHtmlWithElectronChromium(
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
      await sleep(450)
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

export async function fetchDouyinHtmlWithChromium(
  pageUrl: string,
  options?: { cookiesFilePath?: string; timeoutMs?: number; preferredUa?: 'mobile' | 'desktop' | 'auto' }
): Promise<string> {
  if (useCloakBrowserEngine()) {
    return fetchDouyinHtmlWithCloakBrowser(pageUrl, options)
  }

  try {
    return await fetchDouyinHtmlWithElectronChromium(pageUrl, options)
  } catch (err) {
    if (process.env.V_DOWNLOAD_CLOAK_FALLBACK === '1') {
      console.warn('[douyin] Electron hydrate failed; trying CloakBrowser fallback…', err)
      return fetchDouyinHtmlWithCloakBrowser(pageUrl, options)
    }
    throw err
  }
}
