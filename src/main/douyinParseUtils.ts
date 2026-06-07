/**
 * Shared Douyin HTML / cookie parsing helpers used by `douyin.ts` (single item)
 * and `douyinProfile*.ts` (profile post list). Keep Electron-free where possible.
 */
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

export const DOUYIN_MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'

export const DOUYIN_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export type DouyinFetchUaMode = 'mobile' | 'desktop'

export function parseCookieMapFromNetscapeFile(cookiePath: string): Record<string, string> {
  const map: Record<string, string> = {}
  if (!existsSync(cookiePath)) return map
  const content = readFileSync(cookiePath, 'utf-8')
  for (const line of content.split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue
    const parts = line.split('\t')
    if (parts.length >= 7 && /douyin/i.test(parts[0])) {
      const name = parts[5]?.trim()
      const value = parts[6]?.trim()
      if (name && value != null) map[name] = value
    }
  }
  return map
}

export function buildCookieHeaderFromNetscapeFile(cookiePath: string): string {
  const map = parseCookieMapFromNetscapeFile(cookiePath)
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

/** Extract `{...}` assignment after `marker` = (handles strings with `{` `}`). */
export function extractBalancedJsonAfterMarker(html: string, marker: string): string | null {
  const pos = html.indexOf(marker)
  if (pos === -1) return null
  const eq = html.indexOf('=', pos + marker.length)
  if (eq === -1) return null
  let j = eq + 1
  while (j < html.length && /\s/.test(html[j])) j++
  if (j >= html.length || html[j] !== '{') return null

  let depth = 0
  let inStr = false
  let quote: '"' | "'" | null = null
  let escape = false
  const start = j

  for (; j < html.length; j++) {
    const c = html[j]
    if (inStr) {
      if (escape) {
        escape = false
        continue
      }
      if (c === '\\') {
        escape = true
        continue
      }
      if (quote && c === quote) {
        inStr = false
        quote = null
        continue
      }
      continue
    }
    if (c === '"' || c === "'") {
      inStr = true
      quote = c as '"' | "'"
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return html.slice(start, j + 1)
    }
  }
  return null
}

export async function fetchDouyinPageHtml(
  pageUrl: string,
  cookiesFilePath: string | undefined,
  uaMode: DouyinFetchUaMode
): Promise<string> {
  const ua = uaMode === 'desktop' ? DOUYIN_DESKTOP_UA : DOUYIN_MOBILE_UA
  const headers: Record<string, string> = {
    'User-Agent': ua,
    Referer: 'https://www.douyin.com/',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  }
  if (cookiesFilePath && cookiesFilePath.trim()) {
    const abs = resolve(cookiesFilePath.trim())
    const cookieHeader = buildCookieHeaderFromNetscapeFile(abs)
    if (cookieHeader) headers.Cookie = cookieHeader
  }

  const res = await fetch(pageUrl, { headers, redirect: 'follow' })
  if (!res.ok) throw new Error(`Page fetch failed: ${res.status}`)
  return res.text()
}
