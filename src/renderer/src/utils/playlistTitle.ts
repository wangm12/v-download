import type { VideoInfo } from '@/types'

/** Prefer yt-dlp playlist_title; derive Bilibili anthology series name from "Series p01 …" when missing. */
export function resolvePlaylistTitle(
  infoObj: Record<string, unknown>,
  entries: VideoInfo[]
): string {
  const fromMeta = String(infoObj.playlist_title ?? '').trim()
  if (fromMeta) return fromMeta

  const first = entries[0]?.title?.trim()
  if (!first) return 'Playlist'

  const anthology = first.match(/^(.+?)\s+p\d+\b/i)
  if (anthology?.[1]) return anthology[1].trim()

  return first
}

export function resolvePlaylistChannel(
  infoObj: Record<string, unknown>,
  entries: VideoInfo[]
): string {
  const fromMeta = String(infoObj.playlist_channel ?? infoObj.playlist_uploader ?? '').trim()
  if (fromMeta) return fromMeta
  return entries[0]?.channel?.trim() ?? ''
}
