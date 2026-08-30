export type NativeAuthSite = 'youtube' | 'douyin' | 'tiktok' | 'bilibili' | 'xiaohongshu' | 'x'

const SITE_HOSTS: Record<NativeAuthSite, string[]> = {
  youtube: ['youtube.com', 'youtu.be'],
  douyin: ['douyin.com', 'iesdouyin.com'],
  tiktok: ['tiktok.com'],
  bilibili: ['bilibili.com', 'b23.tv'],
  xiaohongshu: ['xiaohongshu.com', 'xhslink.com'],
  x: ['x.com', 'twitter.com']
}

export interface NativeCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly?: boolean
  expirationDate?: number
}

export function nativeAuthSiteForUrl(value: string): NativeAuthSite | null {
  try {
    const host = new URL(value).hostname.toLowerCase()
    for (const [site, hosts] of Object.entries(SITE_HOSTS) as Array<[NativeAuthSite, string[]]>) {
      if (hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) return site
    }
  } catch {
    /* invalid URL */
  }
  return null
}

export function nativeAuthHost(site: NativeAuthSite): string {
  return SITE_HOSTS[site][0]!
}

export function cookieDomainMatchesHost(domain: string, host: string): boolean {
  const normalizedDomain = domain.trim().toLowerCase().replace(/^\./, '')
  const normalizedHost = host.trim().toLowerCase()
  return Boolean(normalizedDomain && normalizedHost && (normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`)))
}

export function sanitizeNativeCookie(value: unknown): NativeCookie | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const name = typeof raw.name === 'string' ? raw.name : ''
  const cookieValue = typeof raw.value === 'string' ? raw.value : ''
  const domain = typeof raw.domain === 'string' ? raw.domain.trim() : ''
  const path = typeof raw.path === 'string' && raw.path.startsWith('/') ? raw.path : '/'
  if (!name || !domain || !cookieValue) return null
  const expirationDate = Number(raw.expirationDate)
  return {
    name,
    value: cookieValue,
    domain,
    path,
    secure: raw.secure === true,
    ...(Number.isFinite(expirationDate) && expirationDate > 0 ? { expirationDate } : {})
  }
}

export function nativeAuthSites(): NativeAuthSite[] {
  return Object.keys(SITE_HOSTS) as NativeAuthSite[]
}
