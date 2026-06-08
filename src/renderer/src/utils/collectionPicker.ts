import { isPlaylistUrl } from '@/utils/youtube'

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

export function shouldOpenCollectionPicker(url: string): boolean {
  return isPlaylistUrl(url) || isBilibiliSpaceUrl(url) || isBilibiliAnthologyCandidate(url)
}

export function collectionPickerLabel(url: string): string {
  if (isBilibiliSpaceUrl(url) || isBilibiliAnthologyCandidate(url)) return 'Bilibili'
  if (isPlaylistUrl(url)) return 'YouTube'
  return 'Playlist'
}
