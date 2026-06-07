/** Session key: when set, Preferences → Downloads pre-fills the Douyin bulk URL field once. */
export const DOUYIN_BULK_URL_PREFILL_SESSION_KEY = 'v-download:pref:douyin-bulk-url'

/** True when `url` looks like a Douyin creator profile (`/user/...`), for bulk-downloader flows. */
export function isDouyinProfileHomeUrl(url: string): boolean {
  const raw = url.trim()
  if (!raw) return false
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    const u = new URL(withProto)
    const host = u.hostname.toLowerCase()
    if (host !== 'douyin.com' && !host.endsWith('.douyin.com')) return false
    return /\/user\//i.test(u.pathname)
  } catch {
    return /(?:^|\/\/)www\.douyin\.com\/user\/|(?:^|\/)douyin\.com\/user\//i.test(raw)
  }
}
