/**
 * Douyin web aweme/post JSON API with reference-aligned query params, msToken, X-Bogus, and retries.
 * Failures are non-fatal for first-page HTML flows; load-more callers may trigger browser recovery.
 */
import { buildDouyinCookieHeader, resolveDouyinCookieContext } from './browserCookies'
import { DOUYIN_DESKTOP_UA } from './douyinParseUtils'
import { buildSignedAwemePostUrl } from './douyinProfileSign'
import { fetchWithTimeout } from './httpClient'

export interface WebAwemePostApiResult {
  aweme_list: Record<string, unknown>[]
  max_cursor: string
  has_more: number
  status_code: number
  /** Reference post_strategy: empty page with status_code=0 or cursor stall */
  pagination_restricted?: boolean
}

const RETRY_DELAYS_MS = [1000, 2000, 5000]
const MAX_ATTEMPTS = 3
const DEFAULT_COUNT = 35

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function normalizeHasMore(hm: unknown): number {
  return hm === true || hm === 1 || hm === '1' || String(hm).toLowerCase() === 'true' ? 1 : 0
}

function parseApiJson(
  j: Record<string, unknown>,
  requestedMaxCursor: string
): WebAwemePostApiResult | null {
  const data = j.data != null && typeof j.data === 'object' ? (j.data as Record<string, unknown>) : null
  const list = (Array.isArray(j.aweme_list) ? j.aweme_list : data?.aweme_list) as unknown
  if (!Array.isArray(list)) return null

  const maxRaw = j.max_cursor ?? data?.max_cursor
  const max_c = maxRaw != null ? String(maxRaw).trim() : ''
  const hm = j.has_more ?? data?.has_more
  const has_more = normalizeHasMore(hm)
  const scRaw = j.status_code ?? data?.status_code
  const status_code = scRaw != null && Number.isFinite(Number(scRaw)) ? Number(scRaw) : 0

  const req = requestedMaxCursor.trim()
  const pageEmpty = list.filter((x) => x && typeof x === 'object').length === 0
  let pagination_restricted = false
  if (pageEmpty && status_code === 0) {
    pagination_restricted = true
  } else if (has_more === 1 && max_c.length > 0 && req.length > 0 && max_c === req) {
    pagination_restricted = true
  }

  return {
    aweme_list: list.filter((x) => x && typeof x === 'object') as Record<string, unknown>[],
    max_cursor: max_c,
    has_more,
    status_code,
    pagination_restricted: pagination_restricted || undefined,
  }
}

async function fetchOnce(
  url: string,
  secUserId: string,
  cookieHeader: string | undefined,
  signal?: AbortSignal
): Promise<{ status: number; bodyText: string }> {
  const headers: Record<string, string> = {
    'User-Agent': DOUYIN_DESKTOP_UA,
    Referer: `https://www.douyin.com/user/${secUserId}`,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Accept: 'application/json, text/plain, */*',
  }
  if (cookieHeader) headers.Cookie = cookieHeader
  const res = await fetchWithTimeout(url, { headers, redirect: 'follow', signal })
  const bodyText = await res.text()
  return { status: res.status, bodyText }
}

function shouldRetry(status: number, bodyText: string): boolean {
  if (status === 429 || status >= 500) return true
  if (status === 200 && bodyText.trim().length === 0) return true
  return false
}

export async function tryFetchWebAwemePostPage(
  secUserId: string,
  maxCursor: string | undefined,
  cookiesFilePath: string | undefined,
  signal?: AbortSignal,
  count = DEFAULT_COUNT
): Promise<WebAwemePostApiResult | null> {
  const reqCursor =
    maxCursor != null && String(maxCursor).trim() !== '' ? String(maxCursor).trim() : '0'

  const cookieCtx = await resolveDouyinCookieContext(cookiesFilePath)
  const cookieHeader =
    cookieCtx.header ?? (await buildDouyinCookieHeader(cookiesFilePath)) ?? undefined

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) return null
    if (attempt > 0) {
      await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 5000)
      if (signal?.aborted) return null
    }

    const url = buildSignedAwemePostUrl(
      secUserId,
      reqCursor,
      count,
      cookiesFilePath,
      cookieCtx.map
    )
    try {
      const { status, bodyText } = await fetchOnce(url, secUserId, cookieHeader, signal)

      if (shouldRetry(status, bodyText)) {
        continue
      }
      if (status < 200 || status >= 400) {
        return null
      }
      if (!bodyText.trim()) {
        continue
      }

      let j: Record<string, unknown>
      try {
        j = JSON.parse(bodyText) as Record<string, unknown>
      } catch {
        continue
      }

      const parsed = parseApiJson(j, reqCursor)
      if (parsed) return parsed
      return null
    } catch (e) {
      if (signal?.aborted) return null
      if (attempt === MAX_ATTEMPTS - 1) return null
      continue
    }
  }
  return null
}
