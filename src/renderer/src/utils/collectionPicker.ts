import { isPlaylistUrl } from './youtube'

export function isBilibiliSpaceUrl(url: string): boolean {
  return /space\.bilibili\.com/i.test(url) || /bilibili\.com\/space\//i.test(url)
}

/** Bilibili multi-part anthology when no `p=` is selected — list all parts in picker. */
export function isBilibiliAnthologyCandidate(url: string): boolean {
  if (!/bilibili\.com\/video\//i.test(url)) return false
  try {
    const u = new URL(url)
    return !u.searchParams.has('p')
  } catch {
    return false
  }
}

function isYoutubeSingleVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase()
    const youtube = host === 'youtube.com'
      || host === 'youtu.be'
      || host === 'm.youtube.com'
      || host === 'music.youtube.com'
      || host.endsWith('.youtube.com')
    if (!youtube) return false
    if (parsed.searchParams.get('v')) return true
    if (host === 'youtu.be' && parsed.pathname.split('/').filter(Boolean)[0]) return true
    return /\/(shorts|embed|live)\//i.test(parsed.pathname)
  } catch {
    return false
  }
}

export function shouldOpenCollectionPicker(url: string): boolean {
  if (isYoutubeSingleVideoUrl(url)) return false
  return isPlaylistUrl(url) || isBilibiliSpaceUrl(url) || isBilibiliAnthologyCandidate(url)
}

export function collectionPickerLabel(url: string): string {
  if (isBilibiliSpaceUrl(url) || isBilibiliAnthologyCandidate(url)) return 'Bilibili'
  if (isPlaylistUrl(url)) return 'YouTube'
  return 'Playlist'
}
