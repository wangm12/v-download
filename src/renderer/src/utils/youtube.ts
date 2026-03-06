export const YOUTUBE_URL_REGEX =
  /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+/

const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be', 'music.youtube.com']

export function isYouTubeUrl(url: string): boolean {
  return YOUTUBE_URL_REGEX.test(url)
}

export function extractUrlFromClipboard(text: string): string | null {
  const trimmed = text.trim()
  if (!YOUTUBE_URL_REGEX.test(trimmed)) return null
  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
    if (YOUTUBE_HOSTS.some((h) => url.hostname.includes(h) || url.hostname === h)) {
      return url.toString()
    }
  } catch {
    // invalid URL
  }
  return null
}
