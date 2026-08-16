/**
 * Douyin often responds to plain Node `fetch()` with an anti-bot HTML shell
 * (byted_acrawler + location.reload) and no video JSON. A hidden BrowserWindow
 * runs the same JS as Chrome and yields hydrated DOM after reload.
 *
 * Optional: enable "Use CloakBrowser for Douyin" in Settings (or
 * V_DOWNLOAD_CLOAKBROWSER=1) to use CloakBrowser's patched Chromium via
 * Playwright instead of Electron's engine. See README for licensing and footprint.
 */
import { BrowserWindow, session, app, net } from 'electron'
import { createWriteStream, existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import type { BrowserContext } from 'playwright-core'
import * as settings from './settings'
import { createDouyinDownloadProgressReporter, type DouyinDownloadProgress } from './douyinDownloadProgress'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** Reuse one partition so __ac_* cookies survive across fetches. */
const SESSION_PARTITION = 'persist:v-download-douyin-hydrate'

/** Block ByteDance verify/captcha *scripts* in the hydrate session (multiple CDNs: yhgfb-cn-static, bytescm, …). */
const sessionsCaptchaBlocked = new WeakSet<Electron.Session>()

function isDouyinCaptchaNoiseScriptUrl(u: string): boolean {
  if (!/https?:\/\//i.test(u)) return false
  // e.g. lf-rc1.yhgfb-cn-static.com/.../rc-verifycenter/.../rmc-captcha.js
  // e.g. lf-cdn-tos.bytescm.com/obj/rc-verifycenter/rmc-captcha/@latest/captcha.js
  return (
    /rc-verifycenter/i.test(u) ||
    /rmc-captcha/i.test(u) ||
    /sec-sdk-captcha/i.test(u) ||
    (/\.bytescm\.com\//i.test(u) && /(captcha|verifycenter)/i.test(u)) ||
    (/\.snssdk\.com\//i.test(u) && /(captcha|verify|secsdk)/i.test(u))
  )
}

function ensureDouyinHydrateCaptchaBlocked(ses: Electron.Session): void {
  if (sessionsCaptchaBlocked.has(ses)) return
  sessionsCaptchaBlocked.add(ses)
  try {
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'], types: ['script'] }, (details, callback) => {
      if (isDouyinCaptchaNoiseScriptUrl(details.url)) {
        callback({ cancel: true })
        return
      }
      callback({})
    })
  } catch {
    /* webRequest may be unavailable in rare builds */
  }
}

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
  const hasFlightPayload = /self\.__pace_f\.push|self\.__next_f\.push/i.test(html)
  if (
    !hasFlightPayload &&
    /_ROUTER_DATA|__MODERN_ROUTER_DATA__|SIGI_STATE|id=["']RENDER_DATA["']|"item_list"|"play_addr"|"playAddr"/i.test(
      html
    )
  ) {
    return true
  }
  // RSC/Flight pages append several small bootstrap chunks before the aweme
  // payload arrives. Seeing the push function alone is too early: returning
  // then makes the caller parse an incomplete page and fall back to JPEG
  // covers for motion-photo notes.
  if (
    hasFlightPayload &&
    /"?(?:awemeId|aweme_id|images|imageList|playAddr|play_addr)"?\s*:/i.test(html)
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

function createAbortError(): DOMException {
  return new DOMException('Douyin Chromium fetch aborted', 'AbortError')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError()
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, Math.max(0, ms))
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(createAbortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(createAbortError())

  let onAbort: (() => void) | undefined
  const abortPromise = new Promise<T>((_, reject) => {
    onAbort = () => reject(createAbortError())
    signal.addEventListener('abort', onAbort, { once: true })
  })
  return Promise.race([promise, abortPromise]).finally(() => {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  })
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), Math.max(1, timeoutMs))
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
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

function isDouyinAppDeepLink(url: string): boolean {
  return /^(snssdk\d*|aweme|sslocal|douyin):/i.test(url)
}

const EXTRACT_CDN_URLS_FROM_PAGE_JS = `(() => {
  const out = [];
  const seen = new Set();
  const norm = (s) => {
    if (typeof s !== "string") return null;
    const u = s.replace(/\\\\u002F/gi, "/");
    if (!/^https?:\\/\\//i.test(u)) return null;
    if (!/douyinvod|bytecdn|zjcdn|ixigua|amemv|tos-cn-|mime_type=video/i.test(u)) return null;
    if (seen.has(u)) return null;
    seen.add(u);
    return u;
  };
  const walk = (o, d) => {
    if (d > 12 || o == null) return;
    if (typeof o === "string") { const u = norm(o); if (u) out.push(u); return; }
    if (Array.isArray(o)) { for (const x of o) walk(x, d + 1); return; }
    if (typeof o === "object") { for (const k of Object.keys(o)) walk(o[k], d + 1); }
  };
  for (const r of [window.__INITIAL_STATE__, window._ROUTER_DATA, window.__MODERN_ROUTER_DATA__]) {
    try { walk(r, 0); } catch (e) {}
  }
  const v = document.querySelector("video");
  if (v) { const u = norm(v.currentSrc || v.src); if (u) out.push(u); }
  return out;
})()`

function isLikelyDouyinVideoCdnUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false
  if (/aweme\.snssdk\.com/i.test(url)) return false
  if (/douyinvod\.com|365yg\.com|zjcdn\.com|ixigua\.com|amemv\.com/i.test(url)) return true
  if (/\.bytecdn\.com/i.test(url) && (/\/video\//i.test(url) || /mime_type=video/i.test(url))) return true
  if (/tos-cn-/.test(url) && /\.(mp4|m3u8)(\?|$)/i.test(url)) return true
  return false
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
  options?: {
    cookiesFilePath?: string
    timeoutMs?: number
    preferredUa?: 'mobile' | 'desktop' | 'auto'
    signal?: AbortSignal
  }
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
    throwIfAborted(options?.signal)
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

    await raceWithAbort(
      page.goto(pageUrl, {
        timeout: initialTimeout,
        waitUntil: 'domcontentloaded',
      }),
      options?.signal
    )
    bumpDeadline()

    while (Date.now() < deadline) {
      await sleepWithAbort(450, options?.signal)
      bumpDeadline()
      const html = await raceWithAbort(page.content(), options?.signal)
      if (htmlLooksHydrated(html)) {
        console.log(`[douyin] CloakBrowser got hydrated HTML (${html.length} bytes) for ${pageUrl}`)
        return html
      }
    }

    const last = await page.content().catch(() => '')
    throwIfAborted(options?.signal)
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

export type DouyinChromiumFetchOptions = {
  cookiesFilePath?: string
  timeoutMs?: number
  preferredUa?: 'mobile' | 'desktop' | 'auto'
  signal?: AbortSignal
  /** Filled with video CDN URLs observed during page load (for play URL enrichment). */
  capturedCdnUrls?: string[]
  /** Shorter waits / early exit when only sniffing CDN urls (bulk download enrichment). */
  enrichmentMode?: boolean
}

let chromiumHydrateChain: Promise<void> = Promise.resolve()

/** Serialize hidden Chromium windows — parallel hydrate starves CPU and looks hung. */
export async function withDouyinChromiumHydrateLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = chromiumHydrateChain
  let release!: () => void
  chromiumHydrateChain = new Promise<void>((resolve) => {
    release = resolve
  })
  await prev
  try {
    return await fn()
  } finally {
    release()
  }
}

async function fetchDouyinHtmlWithElectronChromium(
  pageUrl: string,
  options?: DouyinChromiumFetchOptions
): Promise<string> {
  const initialTimeout = options?.timeoutMs ?? 52_000
  const started = Date.now()
  let deadline = started + initialTimeout
  const pref = options?.preferredUa ?? 'auto'
  const ua = pickChromiumUa(pageUrl, pref)

  const bumpDeadline = () => {
    if (options?.enrichmentMode) return
    const bump = Date.now() + 30_000
    deadline = Math.min(started + MAX_WALL_MS, Math.max(deadline, bump))
  }

  const ses = session.fromPartition(SESSION_PARTITION)
  ensureDouyinHydrateCaptchaBlocked(ses)
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
      sandbox: true,
      /** Keep the hidden page composited so Douyin's anti-bot hydration scripts run reliably on macOS. */
      offscreen: false,
    },
  })

  win.webContents.setAudioMuted(true)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const captured = options?.capturedCdnUrls
  let captureActive = true
  const onCdnResponse = (details: Electron.OnCompletedListenerDetails) => {
    if (!captureActive) return
    if (details.statusCode !== 200 && details.statusCode !== 206) return
    if (!isLikelyDouyinVideoCdnUrl(details.url)) return
    if (!captured || captured.includes(details.url)) return
    captured.push(details.url)
    console.log(`[douyin] Chromium captured CDN url (${captured.length}): ${details.url.slice(0, 96)}…`)
  }
  ses.webRequest.onCompleted({ urls: ['<all_urls>'] }, onCdnResponse)

  const blockAppNavigation = (event: Electron.Event, url: string) => {
    if (isDouyinAppDeepLink(url)) {
      event.preventDefault()
      bumpDeadline()
      console.log(`[douyin] Blocked Douyin app deep link: ${url.slice(0, 96)}…`)
    }
  }

  const onDidFinishLoad = () => bumpDeadline()
  const onDidStopLoading = () => bumpDeadline()
  win.webContents.on('will-navigate', blockAppNavigation)
  win.webContents.on('will-redirect', blockAppNavigation)
  win.webContents.on('did-finish-load', onDidFinishLoad)
  win.webContents.on('did-stop-loading', onDidStopLoading)

  const destroy = () => {
    captureActive = false
    try {
      win.webContents.removeListener('will-navigate', blockAppNavigation)
      win.webContents.removeListener('will-redirect', blockAppNavigation)
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
    throwIfAborted(options?.signal)
    try {
      const load = win.loadURL(pageUrl, {
        userAgent: ua,
        extraHeaders: [
          'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
          'Referer: https://www.douyin.com/',
        ].join('\n'),
      })
      await raceWithAbort(
        withTimeout(load, initialTimeout, `Timed out loading Douyin page after ${initialTimeout}ms`),
        options?.signal
      )
    } catch (loadErr) {
      const msg = loadErr instanceof Error ? loadErr.message : String(loadErr)
      if (!/ERR_ABORTED/i.test(msg)) throw loadErr
      console.warn(`[douyin] Chromium load aborted (often app deep link) for ${pageUrl}: ${msg}`)
    }

    while (Date.now() < deadline) {
      throwIfAborted(options?.signal)
      await sleepWithAbort(450, options?.signal)
      if (captured && captured.length > 0) {
        const html: string = await raceWithAbort(
          win.webContents
            .executeJavaScript(`document.documentElement ? document.documentElement.outerHTML : ''`)
            .catch(() => ''),
          options?.signal
        )
        console.log(
          `[douyin] Chromium exiting early with ${captured.length} CDN url(s) for ${pageUrl}`
        )
        return html || '<html></html>'
      }
      if (options?.enrichmentMode && captured) {
        const videoSrc: string = await raceWithAbort(
          win.webContents
            .executeJavaScript(
              `(() => { const v = document.querySelector('video'); if (!v) return ''; const s = v.currentSrc || v.src || ''; return typeof s === 'string' ? s : ''; })()`
            )
            .catch(() => ''),
          options?.signal
        )
        if (videoSrc && isLikelyDouyinVideoCdnUrl(videoSrc) && !captured.includes(videoSrc)) {
          captured.push(videoSrc)
          console.log(`[douyin] Chromium captured video element src for ${pageUrl}`)
          return '<html></html>'
        }
      }
      const html: string = await raceWithAbort(
        win.webContents.executeJavaScript(
          `document.documentElement ? document.documentElement.outerHTML : ''`
        ),
        options?.signal
      )
      if (htmlLooksHydrated(html)) {
        if (options?.enrichmentMode && captured) {
          const fromState: string[] = await win.webContents
            .executeJavaScript(EXTRACT_CDN_URLS_FROM_PAGE_JS)
            .catch(() => [])
          for (const u of fromState) {
            if (typeof u === 'string' && isLikelyDouyinVideoCdnUrl(u) && !captured.includes(u)) {
              captured.push(u)
            }
          }
          if (captured.length > 0) {
            console.log(
              `[douyin] Chromium extracted ${captured.length} CDN url(s) from page state for ${pageUrl}`
            )
            return html
          }
        }
        console.log(`[douyin] Chromium got hydrated HTML (${html.length} bytes) for ${pageUrl}`)
        return html
      }
      if (
        options?.enrichmentMode &&
        isDouyinAntiBotShell(html) &&
        Date.now() - started > 8_000
      ) {
        console.warn(`[douyin] Chromium fast-fail anti-bot shell on ${pageUrl}`)
        break
      }
    }

    const last: string = await raceWithAbort(
      win.webContents
        .executeJavaScript(`document.documentElement ? document.documentElement.outerHTML : ''`)
        .catch(() => ''),
      options?.signal
    )
    if (last && htmlLooksHydrated(last)) return last

    if (captured && captured.length > 0) {
      console.log(`[douyin] Chromium hydrate timed out but captured ${captured.length} CDN url(s)`)
      return last || '<html></html>'
    }

    throw new Error('Timed out waiting for Douyin page to hydrate in Chromium')
  } finally {
    destroy()
  }
}

/** GET text through the Chromium hydrate session (for signed web APIs after page visit). */
export async function fetchTextWithDouyinSession(
  url: string,
  cookiesFilePath?: string
): Promise<string> {
  const ses = session.fromPartition(SESSION_PARTITION)
  if (cookiesFilePath?.trim()) {
    await applyNetscapeCookiesToSession(ses, cookiesFilePath)
  }

  return new Promise<string>((resolve, reject) => {
    const request = net.request({ url, session: ses })
    request.setHeader('Referer', 'https://www.douyin.com/')
    request.setHeader('Origin', 'https://www.douyin.com')
    request.setHeader('User-Agent', DESKTOP_UA)
    request.setHeader('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8')
    request.setHeader('Accept', 'application/json, text/plain, */*')

    const chunks: Buffer[] = []
    request.on('response', (response) => {
      const code = response.statusCode ?? 0
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8')
        if (code < 200 || code >= 400) {
          reject(new Error(`HTTP ${code}: ${body.slice(0, 200)}`))
          return
        }
        resolve(body)
      })
      response.on('error', reject)
    })
    request.on('error', reject)
    request.end()
  })
}

/** Download through the Chromium hydrate session so CDN cookies are sent per-domain. */
export async function downloadUrlWithDouyinSession(
  url: string,
  outputPath: string,
  cookiesFilePath?: string,
  onProgress?: (progress: DouyinDownloadProgress) => void
): Promise<void> {
  const ses = session.fromPartition(SESSION_PARTITION)
  if (cookiesFilePath?.trim()) {
    await applyNetscapeCookiesToSession(ses, cookiesFilePath)
  }

  await new Promise<void>((resolve, reject) => {
    const request = net.request({ url, session: ses })
    request.setHeader('Referer', 'https://www.douyin.com/')
    request.setHeader('Origin', 'https://www.douyin.com')
    request.setHeader('User-Agent', DESKTOP_UA)
    request.setHeader('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8')

    request.on('response', (response) => {
      const streamResponse = response as unknown as { pause: () => void; resume: () => void }
      const code = response.statusCode ?? 0
      if (code !== 200) {
        streamResponse.resume()
        reject(new Error(`Download failed: ${code} ${response.statusMessage ?? ''}`.trim()))
        return
      }

      const contentLength = parseInt(String(response.headers['content-length'] ?? '0'), 10) || 0
      const fileStream = createWriteStream(outputPath)
      const reporter = createDouyinDownloadProgressReporter(contentLength, onProgress)

      response.on('data', (chunk: Buffer) => {
        reporter.addBytes(chunk.length)
        if (!fileStream.write(chunk)) {
          streamResponse.pause()
          fileStream.once('drain', () => streamResponse.resume())
        }
      })

      response.on('end', () => {
        fileStream.end(() => resolve())
      })
      response.on('error', (err) => {
        fileStream.destroy()
        reject(err)
      })
    })

    request.on('error', reject)
    request.end()
  })
}

/** Cookie header from the Chromium hydrate session (set during page fetches). */
export async function getDouyinHydrateSessionCookieHeader(): Promise<string> {
  const ses = session.fromPartition(SESSION_PARTITION)
  const jars = await ses.cookies.get({})
  const relevant = jars.filter((c) => {
    const d = c.domain ?? ''
    return /douyin|snssdk|byteimg|douyinvod|ixigua|amemv|bytedance|iesdouyin/i.test(d)
  })
  return relevant.map((c) => `${c.name}=${c.value}`).join('; ')
}

export async function fetchDouyinHtmlWithChromium(
  pageUrl: string,
  options?: DouyinChromiumFetchOptions
): Promise<string> {
  const run = async (): Promise<string> => {
    if (useCloakBrowserEngine()) {
      return fetchDouyinHtmlWithCloakBrowser(pageUrl, options)
    }
    return fetchDouyinHtmlWithElectronChromium(pageUrl, options)
  }

  if (options?.enrichmentMode) {
    return withDouyinChromiumHydrateLock(run)
  }

  try {
    return await run()
  } catch (err) {
    if (process.env.V_DOWNLOAD_CLOAK_FALLBACK === '1') {
      console.warn('[douyin] Electron hydrate failed; trying CloakBrowser fallback…', err)
      return fetchDouyinHtmlWithCloakBrowser(pageUrl, options)
    }
    throw err
  }
}
