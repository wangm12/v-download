export interface DouyinProfileUrl {
  secUid: string
  url: string
}

function parseHttpUrl(value: string): URL | null {
  try {
    const raw = value.trim()
    if (!raw) return null
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username || url.password) return null
    return url
  } catch {
    return null
  }
}

/** Creator pages and mobile user shares; never infer a profile from a video's sec_uid query. */
export function parseDouyinProfileUrl(value: string): DouyinProfileUrl | null {
  const url = parseHttpUrl(value)
  if (!url) return null
  const host = url.hostname.toLowerCase()
  if (!['douyin.com', 'iesdouyin.com'].some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return null
  }
  const match = url.pathname.match(/^\/(?:share\/)?user\/([^/]+)\/?$/i)
  if (!match?.[1]) return null
  try {
    const pathId = decodeURIComponent(match[1])
    // Older mobile shares use a numeric user ID in the path and sec_uid in the query.
    const secUid = /^\d+$/.test(pathId) ? url.searchParams.get('sec_uid') || pathId : pathId
    if (!/^[A-Za-z0-9_-]+$/.test(secUid)) return null
    return { secUid, url: `https://www.douyin.com/user/${secUid}` }
  } catch {
    return null
  }
}

export function isDouyinShortUrl(value: string): boolean {
  const url = parseHttpUrl(value)
  return url?.hostname.toLowerCase() === 'v.douyin.com' && /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
}
