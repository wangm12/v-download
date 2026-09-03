import type { VideoInfo } from '@/types'

export function noteMetadataFromVideoInfo(info: VideoInfo): Record<string, unknown> {
  const note = {
    noteTitle: info.title || '',
    noteAuthor: info.channel || '',
    noteUrl: info.webpage_url || '',
    noteDescription: info.description || '',
    ...(info._type === 'text' ? { noteOnly: true } : {}),
  }
  return note
}

export function isTextInfo(info: VideoInfo): boolean {
  return info._type === 'text'
}
