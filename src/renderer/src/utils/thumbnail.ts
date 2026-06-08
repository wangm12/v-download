/** Renderer CSP allows https images only; yt-dlp often returns http:// CDN URLs (e.g. Bilibili). */
export function normalizeThumbnailUrl(url: string | null | undefined): string {
  const trimmed = (url ?? '').trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('data:')) return trimmed
  if (trimmed.startsWith('http://')) return `https://${trimmed.slice('http://'.length)}`
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  return trimmed
}
