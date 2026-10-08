import { parseDouyinProfileUrl } from '@v-download/shared'

/** Session key: when set, Preferences → Downloads pre-fills the Douyin bulk URL field once. */
export const DOUYIN_BULK_URL_PREFILL_SESSION_KEY = 'v-download:pref:douyin-bulk-url'

export function normalizeDouyinProfileUrl(url: string): string | null {
  return parseDouyinProfileUrl(url)?.url ?? null
}

/** True for a creator page or mobile user share, for bulk-downloader flows. */
export function isDouyinProfileHomeUrl(url: string): boolean {
  return normalizeDouyinProfileUrl(url) !== null
}

export function douyinProfileUrlFromInfo(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const info = data as Record<string, unknown>
  if (info._type !== 'douyin_profile' || typeof info.webpage_url !== 'string') return null
  return normalizeDouyinProfileUrl(info.webpage_url)
}
