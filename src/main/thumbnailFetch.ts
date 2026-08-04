import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { normalizeThumbnailUrl } from './ytdlp'

const MAX_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3
const REQUEST_TIMEOUT_MS = 12_000
const LOOKUP_TIMEOUT_MS = 2_500
const LOCAL_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost'])

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = octets
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
}

function isPrivateIp(address: string): boolean {
  const normalized = address.toLowerCase()
  const addressType = isIP(normalized)
  if (addressType === 0) return false
  if (addressType === 4) return isPrivateIpv4(normalized)
  if (addressType !== 6) return true
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized)) return true
  const mapped = normalized.match(/^(?:0*:){0,5}ffff:(\d+\.\d+\.\d+\.\d+)$/)
  return Boolean(mapped && isPrivateIpv4(mapped[1]))
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function isSafeRemoteUrl(rawUrl: string): Promise<boolean> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) return false
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local') || isPrivateIp(hostname)) return false
  const addresses = await withTimeout(lookup(hostname, { all: true, verbatim: true }), LOOKUP_TIMEOUT_MS)
  return Boolean(addresses?.length && addresses.every((entry) => !isPrivateIp(entry.address)))
}

function imageMimeFromBytes(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.length >= 3 && buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (buf.length >= 6 && (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a')) return 'image/gif'
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp' && /avif|avis/.test(buf.subarray(8, 12).toString('ascii'))) return 'image/avif'
  return null
}

async function readLimitedBody(res: Response): Promise<Buffer | null> {
  if (!res.body) return null
  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      total += chunk.length
      if (total > MAX_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks, total)
  } catch {
    await reader.cancel().catch(() => {})
    return null
  }
}

function refererForUrl(url: string, explicit?: string): string | undefined {
  if (explicit?.trim() && explicit.length <= 2048 && !/[\r\n]/.test(explicit)) {
    try {
      const parsed = new URL(explicit.trim())
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString()
    } catch {
      /* ignore invalid explicit referers */
    }
  }
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
  if (!normalized) return null
  if (normalized.startsWith('data:')) return normalized.length <= MAX_BYTES * 2 ? normalized : null
  if (!(await isSafeRemoteUrl(normalized))) return null

  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
  }
  const ref = refererForUrl(normalized, referer)
  if (ref) headers.Referer = ref

  let currentUrl = normalized
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    if (!(await isSafeRemoteUrl(currentUrl))) return null
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(currentUrl, { headers, redirect: 'manual', signal: controller.signal })

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get('location')
        await res.body?.cancel().catch(() => {})
        if (!location || redirect === MAX_REDIRECTS) return null
        try {
          currentUrl = new URL(location, currentUrl).toString()
        } catch {
          return null
        }
        continue
      }
      if (!res.ok) return null

      const declaredMime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      if (declaredMime && !declaredMime.startsWith('image/')) return null
      const buf = await readLimitedBody(res)
      if (!buf || buf.length < 64) return null
      const mime = declaredMime.startsWith('image/') ? declaredMime : imageMimeFromBytes(buf)
      if (!mime) return null
      return `data:${mime};base64,${buf.toString('base64')}`
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}
