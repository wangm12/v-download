export interface RemoteTaskFromResolve {
  title: string
  format: string
  thumbnail?: string
  duration?: number
  metadata: Record<string, unknown>
}

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
}

function noteMetadata(info: Record<string, unknown>, pageUrl: string): Record<string, unknown> {
  return {
    noteTitle: typeof info.title === 'string' ? info.title : '',
    noteAuthor: typeof info.channel === 'string' ? info.channel : '',
    noteUrl: typeof info.webpage_url === 'string' && info.webpage_url.trim() ? info.webpage_url : pageUrl,
    noteDescription: typeof info.description === 'string' ? info.description : '',
  }
}

export function isResolvePlaylist(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const entries = (data as { entries?: unknown }).entries
  return Array.isArray(entries) && entries.length > 1
}

export function taskOptionsFromResolveData(data: unknown, pageUrl: string): RemoteTaskFromResolve {
  const info = asRecord(data)
  const title = (typeof info.title === 'string' && info.title.trim()) || 'Untitled'
  const thumbnail = typeof info.thumbnail === 'string' ? info.thumbnail : undefined
  const duration = typeof info.duration === 'number' ? info.duration : undefined
  const channel = typeof info.channel === 'string' ? info.channel : ''
  const id = typeof info.id === 'string' ? info.id : ''
  const note = noteMetadata(info, pageUrl)
  const type = typeof info._type === 'string' ? info._type : ''
  const imageUrls = Array.isArray(info.image_urls)
    ? info.image_urls.filter((item): item is string => typeof item === 'string')
    : []

  if (type === 'xhs_gallery' && imageUrls.length > 0) {
    return {
      title,
      format: 'video',
      thumbnail,
      duration: duration ?? 0,
      metadata: { ...note, xhsImageUrls: imageUrls, ...(channel ? { channel } : {}) },
    }
  }
  if (type === 'douyin_gallery' && imageUrls.length > 0) {
    return {
      title,
      format: 'video',
      thumbnail,
      duration: duration ?? 0,
      metadata: { ...note, douyinImageUrls: imageUrls, ...(channel ? { channel } : {}) },
    }
  }
  if (type === 'text') {
    return {
      title,
      format: 'video',
      thumbnail,
      duration: duration ?? 0,
      metadata: { ...note, noteOnly: true, ...(channel ? { channel } : {}) },
    }
  }
  return {
    title,
    format: 'video',
    thumbnail,
    duration,
    metadata: {
      ...note,
      ...(channel ? { channel } : {}),
      ...(id ? { ytdlpId: id } : {}),
    },
  }
}
