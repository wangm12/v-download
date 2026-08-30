export function normalizeProxyUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const input = value.trim()
  if (!input) return ''
  try {
    const url = new URL(input)
    if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol)) return ''
    if (url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash) return ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}
