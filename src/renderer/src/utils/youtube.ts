export const YOUTUBE_URL_REGEX =
  /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+/

const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be', 'music.youtube.com']

const MEDIA_URL_REGEX = /\.(m3u8|mp4|webm|flv|mkv)(\?|#|$)/i

export function isYouTubeUrl(url: string): boolean {
  return YOUTUBE_URL_REGEX.test(url)
}

export function isMediaUrl(url: string): boolean {
  return MEDIA_URL_REGEX.test(url)
}

export function isValidDownloadUrl(url: string): boolean {
  return isYouTubeUrl(url) || isMediaUrl(url) || /^https?:\/\/.+/i.test(url)
}

export function getMediaType(url: string): string {
  if (/\.m3u8(\?|#|$)/i.test(url)) return 'hls'
  if (/\.mp4(\?|#|$)/i.test(url)) return 'mp4'
  if (/\.webm(\?|#|$)/i.test(url)) return 'webm'
  if (/\.flv(\?|#|$)/i.test(url)) return 'flv'
  return 'unknown'
}

export function filenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const filename = pathname.split('/').pop()
    if (filename && filename.length > 0) {
      return decodeURIComponent(filename)
    }
  } catch {}
  return 'download'
}

const PLAYLIST_REGEX = /[?&]list=/
const CHANNEL_REGEX = /youtube\.com\/(@[\w-]+|channel\/[\w-]+|c\/[\w-]+|user\/[\w-]+)(\/|$)/

export function isPlaylistUrl(url: string): boolean {
  return PLAYLIST_REGEX.test(url) || CHANNEL_REGEX.test(url)
}

/** Trailing punctuation / CJK closers often glued to copied links (e.g. Douyin share text). */
const TRAILING_URL_JUNK = /[，。！？；：、）》」』\]\)>,.]+$/u

/** v.douyin short links (single path segment); avoids grabbing junk after the code when pasted in share blobs. */
const V_DOUYIN_SHORT = /https:\/\/v\.douyin\.com\/[a-zA-Z0-9_-]+\/?/gi

function extractAllEmbeddedHttpUrls(text: string): string[] {
  const re = /https?:\/\/[^\s<>"']+/gi
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push(m[0])
  }
  return out
}

/** Normalize pasted URL fragments (trailing punctuation, `:6pm` glued to v.douyin path, etc.). */
function scrubUrlCandidate(raw: string): string {
  let s = raw.replace(TRAILING_URL_JUNK, '').trim()
  try {
    const u = new URL(s)
    if (/v\.douyin\.com$/i.test(u.hostname) && /\/:[^/]+$/.test(u.pathname)) {
      u.pathname = u.pathname.replace(/\/:[^/]+$/, '/')
      return u.toString()
    }
  } catch {
    /* keep s */
  }
  return s
}

export function extractUrlFromClipboard(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const shortHits = trimmed.match(V_DOUYIN_SHORT)
  if (shortHits?.length) {
    const normalized = shortHits[0].endsWith('/') ? shortHits[0] : `${shortHits[0]}/`
    try {
      const url = new URL(normalized)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return url.toString()
      }
    } catch {
      /* fall through */
    }
  }

  const embeddedList = extractAllEmbeddedHttpUrls(trimmed)
  const douyinFirst = [
    ...embeddedList.filter((u) => /douyin/i.test(u)),
    ...embeddedList.filter((u) => !/douyin/i.test(u)),
  ]

  for (const raw of douyinFirst) {
    const candidate = scrubUrlCandidate(raw)
    try {
      const url = new URL(candidate)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return url.toString()
      }
    } catch {
      /* next */
    }
  }

  try {
    const candidate = trimmed.startsWith('http') ? scrubUrlCandidate(trimmed) : `https://${trimmed}`
    const url = new URL(candidate)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString()
    }
  } catch {}
  return null
}
