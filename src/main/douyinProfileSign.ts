/**
 * Douyin web profile API query building + msToken + X-Bogus signing.
 */
import { randomBytes } from 'crypto'
import { resolve } from 'path'
import { DOUYIN_DESKTOP_UA, parseCookieMapFromNetscapeFile } from './douyinParseUtils'
import { signDouyinUrlWithXBogus } from './douyinProfileXbogus'

const POST_API_PATH = '/aweme/v1/web/aweme/post/'
const DETAIL_API_PATH = '/aweme/v1/web/aweme/detail/'

/** Reference `_default_query` core fields (douyin-downloader api_client.py). */
export function buildDefaultWebQuery(msToken: string): Record<string, string> {
  return {
    device_platform: 'webapp',
    aid: '6383',
    channel: 'channel_pc_web',
    update_version_code: '170400',
    pc_client_type: '1',
    pc_libra_divert: 'Windows',
    version_code: '290100',
    version_name: '29.1.0',
    cookie_enabled: 'true',
    screen_width: '1536',
    screen_height: '864',
    browser_language: 'zh-CN',
    browser_platform: 'Win32',
    browser_name: 'Chrome',
    browser_version: '131.0.0.0',
    browser_online: 'true',
    engine_name: 'Blink',
    engine_version: '131.0.0.0',
    os_name: 'Windows',
    os_version: '10',
    cpu_core_num: '16',
    device_memory: '8',
    platform: 'PC',
    downlink: '10',
    effective_type: '4g',
    round_trip_time: '200',
    support_h265: '1',
    support_dash: '1',
    uifid: '',
    msToken,
  }
}

/** Reference `get_user_post` extra params. */
export function buildUserPostQuery(
  secUserId: string,
  maxCursor: string,
  count: number,
  msToken: string
): Record<string, string> {
  return {
    ...buildDefaultWebQuery(msToken),
    sec_user_id: secUserId,
    max_cursor: maxCursor,
    count: String(count),
    locate_query: 'false',
    show_live_replay_strategy: '1',
    need_time_list: '1',
    time_list_query: '0',
    whale_cut_token: '',
    cut_version: '1',
    publish_video_strategy_type: '2',
  }
}

function genFalseMsToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let token = ''
  const buf = randomBytes(182)
  for (let i = 0; i < 182; i++) {
    token += chars[buf[i]! % chars.length]
  }
  return `${token}==`
}

/** Resolve msToken from cookie map, Netscape file, or generate fallback. */
export function resolveMsToken(
  cookiesFilePath: string | undefined,
  cookieMap?: Map<string, string>
): string {
  if (cookieMap && cookieMap.size > 0) {
    const fromLive = cookieMap.get('msToken')?.trim()
    if (fromLive && (fromLive.length === 164 || fromLive.length === 184)) {
      return fromLive
    }
    if (fromLive) return fromLive
  }
  if (cookiesFilePath?.trim()) {
    const map = parseCookieMapFromNetscapeFile(resolve(cookiesFilePath.trim()))
    const fromCookie = map.msToken?.trim()
    if (fromCookie && (fromCookie.length === 164 || fromCookie.length === 184)) {
      return fromCookie
    }
    if (fromCookie) return fromCookie
  }
  return genFalseMsToken()
}

function paramsToQueryString(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

/** Reference aweme/detail query (single video play_addr with signed CDN urls). */
export function buildAwemeDetailQuery(awemeId: string, msToken: string): Record<string, string> {
  return {
    ...buildDefaultWebQuery(msToken),
    aweme_id: awemeId,
  }
}

/** Build signed full URL for aweme/detail API. */
export function buildSignedAwemeDetailUrl(
  awemeId: string,
  cookiesFilePath: string | undefined,
  cookieMap?: Map<string, string>
): string {
  const msToken = resolveMsToken(cookiesFilePath, cookieMap)
  const params = buildAwemeDetailQuery(awemeId, msToken)
  const base = `https://www.douyin.com${DETAIL_API_PATH}?${paramsToQueryString(params)}`
  return signDouyinUrlWithXBogus(base, DOUYIN_DESKTOP_UA)
}

/** Build signed full URL for aweme/post API. */
export function buildSignedAwemePostUrl(
  secUserId: string,
  maxCursor: string | undefined,
  count: number,
  cookiesFilePath: string | undefined,
  cookieMap?: Map<string, string>
): string {
  const mc = maxCursor != null && String(maxCursor).trim() !== '' ? String(maxCursor).trim() : '0'
  const msToken = resolveMsToken(cookiesFilePath, cookieMap)
  const params = buildUserPostQuery(secUserId, mc, count, msToken)
  const base = `https://www.douyin.com${POST_API_PATH}?${paramsToQueryString(params)}`
  return signDouyinUrlWithXBogus(base, DOUYIN_DESKTOP_UA)
}
