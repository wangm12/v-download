/**
 * Optional headless Chromium (Playwright) to hydrate Douyin when plain `fetch` returns
 * an anti-bot shell or HTML without parseable video JSON.
 */
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { config } from './config.js'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Same idea as Electron `isDouyinAntiBotShell` — acrawler + empty body + reload. */
function isDouyinAntiBotShell(html: string): boolean {
  if (!html || html.length < 800 || html.length > 200_000) return false
  if (!/byted_acrawler\.init/i.test(html)) return false
  if (!/location\.reload/i.test(html)) return false
  if (!/<body[^>]*>\s*<\/body>/i.test(html)) return false
  return true
}

function htmlLooksHydratedEnough(html: string): boolean {
  if (!html || html.length < 8000) return false
  if (isDouyinAntiBotShell(html)) return false
  if (
    /_ROUTER_DATA|__MODERN_ROUTER_DATA__|SIGI_STATE|id=["']RENDER_DATA["']|"item_list"|"play_addr"|"playAddr"/i.test(
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

export interface FetchDouyinPlaywrightOptions {
  cookiesFilePath: string
  /** Total wall time for navigation + polling (default 120s). */
  timeoutMs?: number
}

/**
 * Launch persistent Chromium, inject cookies, open `pageUrl`, poll until HTML looks
 * hydrated or timeout. Caller parses HTML.
 */
export async function fetchDouyinHtmlWithPlaywright(
  pageUrl: string,
  opts: FetchDouyinPlaywrightOptions
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 120_000
  const cookieAbs = resolve(opts.cookiesFilePath.trim())

  let chromium: typeof import('playwright').chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    throw new Error(
      'Playwright is not installed. From vdl-server: npm install playwright && npx playwright install chromium'
    )
  }

  const userDataDir = join(resolve(config.tempDir), 'pw-douyin-profile')
  mkdirSync(userDataDir, { recursive: true })

  const cookies = netscapeToPlaywrightCookies(cookieAbs)
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    locale: 'zh-CN',
    viewport: { width: 390, height: 844 },
    userAgent: MOBILE_UA,
    ignoreHTTPSErrors: true,
    javaScriptEnabled: true,
  })

  try {
    if (cookies.length > 0) {
      await context.addCookies(cookies)
      console.log(`[douyin:pw] Injected ${cookies.length} cookies from Netscape file`)
    } else {
      console.warn('[douyin:pw] No Douyin-related cookies in file; continuing with empty jar + disk profile')
    }

    const page = await context.newPage()
    page.setDefaultNavigationTimeout(timeoutMs)
    page.setDefaultTimeout(timeoutMs)

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' })

    const deadline = Date.now() + timeoutMs
    let last = await page.content()
    while (Date.now() < deadline) {
      if (htmlLooksHydratedEnough(last)) {
        console.log(`[douyin:pw] Hydrated HTML (${last.length} bytes) for ${pageUrl}`)
        return last
      }
      await sleep(2000)
      last = await page.content()
    }

    console.warn(`[douyin:pw] Timeout after ${timeoutMs}ms; returning last HTML (${last.length} bytes)`)
    return last
  } finally {
    await context.close()
  }
}
