import { isDouyinShortUrl } from '@v-download/shared'
import { DOUYIN_MOBILE_UA } from './douyinParseUtils'
import { fetchWithTimeout } from './httpClient'

/** Inspect short-link redirects before asking a single-post resolver or browser extension for media. */
export async function resolveDouyinShareUrl(
  url: string,
  options: { signal?: AbortSignal; proxyUrl?: string } = {}
): Promise<string> {
  if (options.signal?.aborted) throw new DOMException('Douyin URL resolution aborted', 'AbortError')
  if (!isDouyinShortUrl(url)) return url
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    signal: options.signal,
    headers: {
      'User-Agent': DOUYIN_MOBILE_UA,
      Referer: 'https://www.douyin.com/',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  }, { timeoutMs: 10_000, proxyUrl: options.proxyUrl })
  await response.body?.cancel().catch(() => undefined)
  return response.url
}
