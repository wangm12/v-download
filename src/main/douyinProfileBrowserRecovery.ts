/**
 * Browser recovery for Douyin profile post listing when API pagination is restricted.
 * Visible system browser (Playwright) + live cookies + API intercept + HTML fallback.
 */
import { chromium } from 'playwright-core'
import type { Browser } from 'playwright-core'
import { readDouyinCookiesFromBrowser } from './browserCookies'
import { mapBrowserToPlaywrightLaunch, resolvedCookiesBrowser } from './cookiesBrowser'
import { cacheProfileAwemeItems } from './douyinProfileAwemeCache'
import { awemeItemToProfileRow, extractProfilePostsFromHtml } from './douyinProfileHtml'
import type { DouyinProfilePostRow } from './douyinProfileTypes'

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const DEFAULT_WAIT_MS = 45_000
const DEFAULT_MAX_SCROLLS = 36
const DEFAULT_IDLE_ROUNDS = 4
const LOAD_URL_TIMEOUT_MS = 35_000

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export interface BrowserRecoveryOptions {
  secUid: string
  cookiesFilePath?: string
  existingIds?: Set<string>
  maxScrolls?: number
  idleRounds?: number
  waitTimeoutMs?: number
  signal?: AbortSignal
}

export interface BrowserRecoveryResult {
  rows: DouyinProfilePostRow[]
  postApiPages: number
}

function ingestAwemeList(
  list: unknown[],
  merged: Map<string, DouyinProfilePostRow>
): number {
  let added = 0
  const objects = list.filter((item) => item && typeof item === 'object') as Record<string, unknown>[]
  cacheProfileAwemeItems(objects)
  for (const item of objects) {
    const row = awemeItemToProfileRow(item)
    if (!row || merged.has(row.awemeId)) continue
    merged.set(row.awemeId, row)
    added++
  }
  return added
}

/** Collect profile posts via visible Playwright browser + scroll + API intercept + HTML parse. */
export async function collectProfilePostsViaBrowserRecovery(
  options: BrowserRecoveryOptions
): Promise<BrowserRecoveryResult> {
  const {
    secUid,
    cookiesFilePath,
    existingIds = new Set<string>(),
    maxScrolls = DEFAULT_MAX_SCROLLS,
    idleRounds = DEFAULT_IDLE_ROUNDS,
    waitTimeoutMs = DEFAULT_WAIT_MS,
    signal,
  } = options

  const browserName = resolvedCookiesBrowser()
  const launchOpts = mapBrowserToPlaywrightLaunch(browserName)
  if (!launchOpts) {
    throw new Error(
      `Browser profile "${browserName}" is not supported for auto-recovery. Set Chrome, Edge, or Brave in Settings, or use Open profile in browser.`
    )
  }

  const targetUrl = `https://www.douyin.com/user/${secUid}`
  const merged = new Map<string, DouyinProfilePostRow>()
  const extractLimit = 200
  let postApiPages = 0
  let browser: Browser | null = null

  const closeBrowser = async () => {
    try {
      if (browser) await browser.close()
    } catch {
      /* ignore */
    } finally {
      browser = null
    }
  }

  const onAbort = () => {
    void closeBrowser()
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  const ingestHtml = (html: string): number => {
    if (!html || html.length < 800) return 0
    const { rows } = extractProfilePostsFromHtml(html, extractLimit)
    let added = 0
    for (const row of rows) {
      if (!merged.has(row.awemeId)) {
        merged.set(row.awemeId, row)
        added++
      }
    }
    return added
  }

  const countNewBeyondExisting = (): number => {
    let n = 0
    for (const id of merged.keys()) {
      if (!existingIds.has(id)) n++
    }
    return n
  }

  try {
    browser = await chromium.launch({
      ...launchOpts,
      headless: false,
      args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
    })

    const cookies = await readDouyinCookiesFromBrowser(cookiesFilePath)
    const context = await browser.newContext({
      userAgent: DESKTOP_UA,
      locale: 'zh-CN',
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: {
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Referer: 'https://www.douyin.com/',
      },
    })

    if (cookies.length > 0) {
      await context.addCookies(cookies)
      console.log(`[douyinProfile:recovery] injected ${cookies.length} cookies (browser=${browserName})`)
    } else {
      console.log(`[douyinProfile:recovery] no cookies injected — sync cookies in Settings (browser=${browserName})`)
    }

    const page = await context.newPage()

    page.on('response', (response) => {
      const url = response.url()
      if (!url.includes('/aweme/v1/web/aweme/post/')) return
      void (async () => {
        try {
          const data = (await response.json()) as Record<string, unknown>
          const dataObj = data.data != null && typeof data.data === 'object' ? (data.data as Record<string, unknown>) : null
          const list = (Array.isArray(data.aweme_list)
            ? data.aweme_list
            : dataObj?.aweme_list) as unknown[] | undefined
          if (!Array.isArray(list) || list.length === 0) return
          postApiPages++
          const added = ingestAwemeList(list, merged)
          if (added > 0) {
            console.log(`[douyinProfile:recovery] API intercept page=${postApiPages} added=${added} merged=${merged.size}`)
          }
        } catch {
          /* ignore parse errors */
        }
      })()
    })

    console.log(`[douyinProfile:recovery] loading ${targetUrl}`)
    await page.goto(targetUrl, {
      timeout: LOAD_URL_TIMEOUT_MS,
      waitUntil: 'domcontentloaded',
    })

    const started = Date.now()
    let stableRounds = 0
    let lastMergedSize = 0
    let lastNewCount = 0

    for (let i = 0; i < 12; i++) {
      if (signal?.aborted) throw new Error('Request cancelled')
      const title = await page.title().catch(() => '')
      if (title.includes('验证码')) {
        console.log('[douyinProfile:recovery] Captcha detected — complete verification in this window')
      }
      ingestHtml(await page.content().catch(() => ''))
      if (merged.size > 0) break
      await sleep(1000)
    }

    for (let round = 0; round < maxScrolls; round++) {
      if (signal?.aborted) throw new Error('Request cancelled')
      if (Date.now() - started > waitTimeoutMs) {
        console.log('[douyinProfile:recovery] wall timeout reached')
        break
      }

      await page.evaluate(() => window.scrollBy(0, 3800)).catch(() => {})
      await sleep(900)
      const added = ingestHtml(await page.content().catch(() => ''))
      const newBeyond = countNewBeyondExisting()

      if (round === 0 || round % 5 === 0 || added > 0) {
        console.log(
          `[douyinProfile:recovery] scroll=${round + 1} merged=${merged.size} newBeyondExisting=${newBeyond} added=${added} apiPages=${postApiPages}`
        )
      }

      if (merged.size === lastMergedSize && newBeyond === lastNewCount) {
        stableRounds++
      } else {
        stableRounds = 0
        lastMergedSize = merged.size
        lastNewCount = newBeyond
      }

      if (stableRounds >= idleRounds) break
      if (newBeyond > 0 && stableRounds >= 2 && added === 0) break
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`[douyinProfile:recovery] error: ${msg}`)
    if (/Executable doesn't exist|Failed to launch|browserType.launch/i.test(msg)) {
      throw new Error(
        `Could not launch ${browserName}. Install the browser or change Settings → Browser profile, then use Open profile in browser.`
      )
    }
    throw e
  } finally {
    signal?.removeEventListener('abort', onAbort)
    await closeBrowser()
  }

  const rows: DouyinProfilePostRow[] = []
  for (const [id, row] of merged) {
    if (existingIds.has(id)) continue
    rows.push(row)
  }

  console.log(`[douyinProfile:recovery] done merged=${merged.size} newRows=${rows.length} apiPages=${postApiPages}`)

  return { rows, postApiPages }
}

/** False when browser recovery is disabled via env (opt-in from UI still required). */
export function browserRecoveryEnabled(): boolean {
  return process.env.V_DOWNLOAD_DOUYIN_PROFILE_RECOVERY !== '0'
}
