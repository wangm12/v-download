import { normalizeThumbnailUrl } from './ytdlp'

const MAX_BYTES = 2 * 1024 * 1024

function refererForUrl(url: string, explicit?: string): string | undefined {
  if (explicit?.trim()) return explicit.trim()
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.endsWith('hdslb.com') || host.endsWith('bilibili.com')) {
      return 'https://www.bilibili.com/'
    }
  } catch {
    /* ignore */
  }
  return undefined
}

/** Fetch a remote cover through the main process (CSP-safe data URL for renderer). */
export async function fetchRemoteThumbnailDataUrl(
  url: string,
  referer?: string
): Promise<string | null> {
  const normalized = normalizeThumbnailUrl(url)
  if (!normalized || normalized.startsWith('data:')) return normalized || null

  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
  }
  const ref = refererForUrl(normalized, referer)
  if (ref) headers.Referer = ref

  const res = await fetch(normalized, { headers, redirect: 'follow' })
  if (!res.ok) return null

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 64 || buf.length > MAX_BYTES) return null

  const ct = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim()
  const mime = ct.startsWith('image/') ? ct : 'image/jpeg'
  return `data:${mime};base64,${buf.toString('base64')}`
}
