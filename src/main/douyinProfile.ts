import { fetchDouyinHtmlWithChromium, isDouyinAntiBotShell } from './douyinBrowserFetch'
import { fetchDouyinPageHtml } from './douyinParseUtils'
import { tryFetchWebAwemePostPage } from './douyinProfileApi'
import {
  browserRecoveryEnabled,
  collectProfilePostsViaBrowserRecovery,
} from './douyinProfileBrowserRecovery'
import { cacheProfileAwemeItems } from './douyinProfileAwemeCache'
import { awemeItemToProfileRow, extractProfilePostsFromHtml } from './douyinProfileHtml'
import type { DouyinProfileListResult, DouyinProfilePostRow } from './douyinProfileTypes'

function logProfile(msg: string, secUid: string): void {
  const short = secUid.length > 12 ? `${secUid.slice(0, 8)}…` : secUid
  console.log(`[douyinProfile] ${msg} secUid=${short}`)
}

/** Shorter than default Chromium hydrate to avoid long captcha-widget loops on profile pages. Override with V_DOWNLOAD_DOUYIN_PROFILE_CHROMIUM_MS. */
function profileChromiumTimeoutMs(): number {
  const raw = process.env.V_DOWNLOAD_DOUYIN_PROFILE_CHROMIUM_MS
  const n = raw != null && raw !== '' ? Number(raw) : NaN
  if (Number.isFinite(n) && n >= 5_000) return Math.floor(n)
  return 24_000
}

function profileBrowserRecoveryTimeoutMs(): number {
  const raw = process.env.V_DOWNLOAD_DOUYIN_PROFILE_RECOVERY_MS
  const n = raw != null && raw !== '' ? Number(raw) : NaN
  if (Number.isFinite(n) && n >= 10_000) return Math.floor(n)
  return 45_000
}

/** Strict host: `douyin.com` or `*.douyin.com`; path `/user/{sec_uid}`. */
export function extractSecUidFromProfileUrl(url: string): string | null {
  try {
    const raw = url.trim()
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    const host = u.hostname.toLowerCase()
    if (host !== 'douyin.com' && !host.endsWith('.douyin.com')) return null
    const m = u.pathname.match(/\/user\/([^/?#]+)/)
    if (!m?.[1]) return null
    return decodeURIComponent(m[1])
  } catch {
    return null
  }
}

function encodeCursor(maxCursor: string): string {
  return Buffer.from(JSON.stringify({ v: 1, mc: maxCursor }), 'utf-8').toString('base64url')
}

function decodeCursor(cursor: string | null | undefined): string | null {
  if (!cursor?.trim()) return null
  try {
    const o = JSON.parse(Buffer.from(cursor.trim(), 'base64url').toString('utf-8')) as { v?: number; mc?: string }
    if (o && typeof o.mc === 'string' && o.mc.length > 0) return o.mc
  } catch {
    /* ignore */
  }
  return null
}

function rowsFromAwemeList(list: Record<string, unknown>[], limit: number): DouyinProfilePostRow[] {
  const seen = new Set<string>()
  const rows: DouyinProfilePostRow[] = []
  for (const item of list) {
    const row = awemeItemToProfileRow(item)
    if (!row || seen.has(row.awemeId)) continue
    seen.add(row.awemeId)
    rows.push(row)
    if (rows.length >= limit) break
  }
  return rows
}

/** Profile page HTML → embedded post list (same strategy as legacy HTML-only path). */
async function fetchHtmlProfileExtract(
  secUid: string,
  cookiePath: string | undefined,
  extractLimit: number
): Promise<{
  rows: DouyinProfilePostRow[]
  maxCursor: string | null
  hasMore: boolean
  source: 'html' | 'chromium'
  lastLen: number
}> {
  const pageUrls = [`https://m.douyin.com/user/${secUid}`, `https://www.douyin.com/user/${secUid}`]
  let lastLen = 0
  for (const pageUrl of pageUrls) {
    for (const uaMode of ['mobile', 'desktop'] as const) {
      try {
        let html = await fetchDouyinPageHtml(pageUrl, cookiePath, uaMode)
        lastLen = html.length
        let source: 'html' | 'chromium' = 'html'
        if (isDouyinAntiBotShell(html)) {
          logProfile(`anti-bot shell Node fetch (${html.length}b) → Chromium`, secUid)
          try {
            html = await fetchDouyinHtmlWithChromium(pageUrl, {
              cookiesFilePath: cookiePath,
              preferredUa: uaMode === 'mobile' ? 'mobile' : 'desktop',
              timeoutMs: profileChromiumTimeoutMs(),
            })
            source = 'chromium'
            lastLen = html.length
          } catch (e) {
            logProfile(`Chromium failed: ${e instanceof Error ? e.message : String(e)}`, secUid)
            continue
          }
        }
        const ext = extractProfilePostsFromHtml(html, extractLimit)
        if (ext.rows.length > 0) {
          logProfile(`HTML rows=${ext.rows.length} hasMore=${ext.hasMore} source=${source} bytes=${html.length}`, secUid)
          return {
            rows: ext.rows,
            maxCursor: ext.maxCursor,
            hasMore: ext.hasMore,
            source,
            lastLen,
          }
        }
      } catch (e) {
        logProfile(`fetch failed (${uaMode}): ${e instanceof Error ? e.message : String(e)}`, secUid)
      }
    }
  }
  return { rows: [], maxCursor: null, hasMore: false, source: 'html', lastLen }
}

export type DouyinProfileFirstPageMode = 'merged' | 'api_quick' | 'html_only'

export async function listDouyinProfilePosts(options: {
  profileUrl: string
  cursor?: string | null
  limit?: number
  cookiesFilePath?: string
  signal?: AbortSignal
  /** First paint only. `api_quick` / `html_only` are ignored when `cursor` is set (load more). Default `merged`. */
  firstPageMode?: DouyinProfileFirstPageMode
  /** Skip these aweme IDs during browser recovery (already in picker). */
  existingAwemeIds?: string[]
  /** Open visible Douyin window to scroll/collect posts (opt-in only; never auto). */
  browserRecovery?: boolean
}): Promise<DouyinProfileListResult> {
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 35)))
  const secUid = extractSecUidFromProfileUrl(options.profileUrl)
  if (!secUid) {
    return { ok: false, code: 'INVALID_URL', message: 'Not a valid Douyin profile URL (expected /user/... on douyin.com)' }
  }

  if (options.signal?.aborted) {
    return { ok: false, code: 'TIMEOUT', message: 'Request cancelled' }
  }

  const maxFromCursor = decodeCursor(options.cursor ?? null)
  const cookiePath = options.cookiesFilePath?.trim()
  const firstPageMode: DouyinProfileFirstPageMode = options.firstPageMode ?? 'merged'
  const existingIds = new Set(options.existingAwemeIds ?? [])

  /** Map web API page; `requestedMaxCursor` is the max_cursor sent for this request (omit on first page). */
  const mapApiPage = (
    api: {
      aweme_list: Record<string, unknown>[]
      max_cursor: string
      has_more: number
      pagination_restricted?: boolean
    },
    requestedMaxCursor: string | null | undefined
  ) => {
    cacheProfileAwemeItems(api.aweme_list)
    const rows = rowsFromAwemeList(api.aweme_list, limit)
    const rawLen = api.aweme_list.length
    const mc = String(api.max_cursor ?? '').trim()
    const hasMoreFromApi = api.has_more === 1 && mc.length > 0
    const req = (requestedMaxCursor ?? '').trim()
    const cursorAdvanced = req.length > 0 && mc.length > 0 && mc !== req
    const fullishPage = rawLen >= 10
    const heuristicMore =
      !hasMoreFromApi && cursorAdvanced && fullishPage && mc.length > 0 && mc !== '0'
    const firstPageMaybeMore =
      (req === '' || req === '0') &&
      !hasMoreFromApi &&
      fullishPage &&
      mc.length > 0 &&
      mc !== '0'
    const cursorStall = Boolean(api.pagination_restricted)
    const hasMore = !cursorStall && (hasMoreFromApi || heuristicMore || firstPageMaybeMore)
    if (heuristicMore) {
      logProfile(`API pagination heuristic (has_more=0, full page, cursor advanced) rawLen=${rawLen}`, secUid)
    }
    if (firstPageMaybeMore) {
      logProfile(`API pagination heuristic (first page: has_more=0 but max_cursor present) rawLen=${rawLen}`, secUid)
    }
    if (cursorStall) {
      logProfile(`API pagination restricted (empty page or cursor stall) rawLen=${rawLen}`, secUid)
    }
    const nextCur = hasMore && mc.length > 0 ? encodeCursor(mc) : null
    return { rows, nextCur, hasMore, paginationRestricted: cursorStall }
  }

  async function tryBrowserRecovery(): Promise<DouyinProfileListResult | null> {
    if (!options.browserRecovery || !browserRecoveryEnabled()) return null
    if (!secUid) return null
    logProfile('browser recovery (user requested)', secUid)
    try {
      const recovered = await collectProfilePostsViaBrowserRecovery({
        secUid,
        cookiesFilePath: cookiePath,
        existingIds,
        signal: options.signal,
        waitTimeoutMs: profileBrowserRecoveryTimeoutMs(),
        maxScrolls: 36,
        idleRounds: 4,
      })
      if (recovered.rows.length === 0) {
        return {
          ok: true,
          items: [],
          cursor: null,
          hasMore: false,
          source: 'browser_recovery',
          warnings: [
            'Browser session found no new posts beyond the current list. Complete any verification and try again, or use Load more.',
          ],
        }
      }
      return {
        ok: true,
        items: recovered.rows,
        cursor: null,
        hasMore: false,
        source: 'browser_recovery',
        warnings: [
          'Recovered via visible browser scroll. If posts are missing, complete any verification in the Douyin window and retry Load all.',
        ],
      }
    } catch (e) {
      logProfile(`browser recovery failed: ${e instanceof Error ? e.message : String(e)}`, secUid)
      return null
    }
  }

  if (options.browserRecovery) {
    const recovered = await tryBrowserRecovery()
    if (recovered) return recovered
    return {
      ok: false,
      code: 'LOAD_MORE_FAILED',
      message:
        'Browser could not load more posts. Complete any verification in the Douyin window, refresh cookies in Settings, and retry.',
    }
  }

  if (maxFromCursor) {
    logProfile('load-more via API', secUid)
    const api = await tryFetchWebAwemePostPage(secUid, maxFromCursor, cookiePath, options.signal)
    if (api) {
      const { rows, nextCur, hasMore, paginationRestricted } = mapApiPage(api, maxFromCursor)
      logProfile(`API page rows=${rows.length} raw=${api.aweme_list.length} hasMore=${hasMore} restricted=${paginationRestricted}`, secUid)

      if (paginationRestricted || (rows.length === 0 && api.status_code === 0)) {
        return {
          ok: false,
          code: 'PAGINATION_RESTRICTED',
          message:
            'Douyin limited API pagination (often ~20 posts). Refresh cookies in Settings, or click Load in browser.',
        }
      }

      return {
        ok: true,
        items: rows,
        cursor: nextCur,
        hasMore,
        source: 'api',
      }
    }

    return {
      ok: false,
      code: 'LOAD_MORE_FAILED',
      message:
        'Could not load the next page. Refresh cookies in Settings, or click Load in browser.',
    }
  }

  /** Fast path: web API only (renderer shows this first, then calls `html_only`). */
  if (!maxFromCursor && firstPageMode === 'api_quick') {
    logProfile('first page: API quick (HTML deferred)', secUid)
    const apiFirst = await tryFetchWebAwemePostPage(secUid, undefined, cookiePath, options.signal)
    if (apiFirst?.aweme_list.length) {
      const apiMapped = mapApiPage(apiFirst, null)
      logProfile(`API quick rows=${apiMapped.rows.length} raw=${apiFirst.aweme_list.length} hasMore=${apiMapped.hasMore}`, secUid)
      return {
        ok: true,
        items: apiMapped.rows,
        cursor: apiMapped.nextCur,
        hasMore: apiMapped.hasMore,
        source: 'api',
      }
    }
    return { ok: true, items: [], cursor: null, hasMore: false, source: 'api' }
  }

  /** Second-phase: profile HTML only (merge in renderer). */
  if (!maxFromCursor && firstPageMode === 'html_only') {
    logProfile('first page: HTML-only (deferred enrich)', secUid)
    const htmlLimit = Math.min(200, Math.max(limit, 80))
    const htmlExtract = await fetchHtmlProfileExtract(secUid, cookiePath, htmlLimit)
    if (htmlExtract.rows.length > 0) {
      const cursor = htmlExtract.hasMore && htmlExtract.maxCursor ? encodeCursor(htmlExtract.maxCursor) : null
      logProfile(
        `HTML-only rows=${htmlExtract.rows.length} hasMore=${htmlExtract.hasMore} source=${htmlExtract.source}`,
        secUid
      )
      return {
        ok: true,
        items: htmlExtract.rows,
        cursor,
        hasMore: Boolean(htmlExtract.hasMore && cursor),
        source: htmlExtract.source,
        warnings:
          htmlExtract.hasMore && !htmlExtract.maxCursor
            ? ['Pagination cursor missing in page; Load more may use API only']
            : undefined,
      }
    }
    return { ok: true, items: [], cursor: null, hasMore: false, source: htmlExtract.source }
  }

  logProfile('first page: merged API + HTML', secUid)
  const apiFirst = await tryFetchWebAwemePostPage(secUid, undefined, cookiePath, options.signal)

  const merged = new Map<string, DouyinProfilePostRow>()
  let apiMapped: ReturnType<typeof mapApiPage> | null = null

  if (apiFirst?.aweme_list.length) {
    apiMapped = mapApiPage(apiFirst, null)
    for (const r of apiMapped.rows) merged.set(r.awemeId, r)
    logProfile(`API first page rows=${apiMapped.rows.length} raw=${apiFirst.aweme_list.length} hasMore=${apiMapped.hasMore}`, secUid)
  }

  // Unsigned web API often returns a short first page + has_more=false; profile HTML embed usually has more.
  let htmlExtract: Awaited<ReturnType<typeof fetchHtmlProfileExtract>> = {
    rows: [] as DouyinProfilePostRow[],
    maxCursor: null as string | null,
    hasMore: false,
    source: 'html',
    lastLen: 0,
  }
  const shouldHtmlEnrich = !apiMapped || !apiMapped.hasMore || merged.size === 0
  if (shouldHtmlEnrich) {
    const htmlLimit = Math.min(200, Math.max(limit, 80))
    htmlExtract = await fetchHtmlProfileExtract(secUid, cookiePath, htmlLimit)
    let added = 0
    for (const r of htmlExtract.rows) {
      if (!merged.has(r.awemeId)) {
        merged.set(r.awemeId, r)
        added++
      }
    }
    if (htmlExtract.rows.length > 0) {
      logProfile(
        `HTML enrich htmlRows=${htmlExtract.rows.length} addedNew=${added} mergedTotal=${merged.size} hasMore=${htmlExtract.hasMore} source=${htmlExtract.source}`,
        secUid
      )
    }
  }

  if (merged.size > 0) {
    const items = Array.from(merged.values())
    let cursor: string | null = null
    let hasMore = false
    let source: 'html' | 'chromium' | 'api' | 'merged' = 'api'
    if (apiMapped?.hasMore && apiMapped.nextCur) {
      cursor = apiMapped.nextCur
      hasMore = true
      source = htmlExtract.rows.length > 0 ? 'merged' : 'api'
    } else if (htmlExtract.hasMore && htmlExtract.maxCursor) {
      cursor = encodeCursor(htmlExtract.maxCursor)
      hasMore = true
      source = apiMapped ? 'merged' : htmlExtract.source
    } else {
      cursor = null
      hasMore = false
      if (apiMapped && htmlExtract.rows.length > 0) source = 'merged'
      else if (apiMapped) source = 'api'
      else source = htmlExtract.source
    }
    const warnings: string[] | undefined =
      htmlExtract.hasMore && !htmlExtract.maxCursor
        ? ['Pagination cursor missing in page; Load more may use API only']
        : undefined
    return {
      ok: true,
      items,
      cursor,
      hasMore,
      source,
      warnings,
    }
  }

  const lastLen = htmlExtract.lastLen

  if (!cookiePath) {
    return {
      ok: false,
      code: 'COOKIE_REQUIRED',
      message: 'No posts found. Configure a Douyin cookie file in Settings (or sync from browser), then retry.',
    }
  }

  if (lastLen > 0 && lastLen < 5000) {
    return {
      ok: false,
      code: 'PRIVATE_OR_EMPTY',
      message: 'Page was very small or empty. The account may be private, or login/cookies are required.',
    }
  }

  return {
    ok: false,
    code: 'UNSUPPORTED_LAYOUT',
    message: 'Could not extract a post list from this profile page. Try updating cookies or use Advanced → external bulk tool.',
  }
}
