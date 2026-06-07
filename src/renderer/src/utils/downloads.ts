import type { Download, Playlist } from '@/types'

function isDouyinProfileGroup(d: Download): boolean {
  return /douyin\.com/i.test(d.url) && Boolean(d.playlist_id) && d.playlist_id === d.channel
}

export function groupDownloadsByPlaylist(downloads: Download[]): (Download | Playlist)[] {
  const standalone: Download[] = []
  const playlistMap = new Map<string, { playlist: Playlist; downloads: Download[] }>()

  for (const d of downloads) {
    if (d.playlist_id) {
      const existing = playlistMap.get(d.playlist_id)
      if (existing) {
        existing.downloads.push(d)
      } else {
        const profileGroup = isDouyinProfileGroup(d)
        playlistMap.set(d.playlist_id, {
          playlist: {
            id: d.playlist_id,
            url: d.url,
            title: d.playlist_id,
            type: profileGroup ? 'Douyin profile' : 'playlist',
            total_count: 1,
            completed_count: d.status === 'complete' ? 1 : 0,
            output_dir: '',
            created_at: d.created_at,
            updated_at: d.updated_at
          },
          downloads: [d]
        })
      }
    } else {
      standalone.push(d)
    }
  }

  const result: (Download | Playlist)[] = [...standalone]
  for (const { playlist, downloads } of playlistMap.values()) {
    const sorted = [...downloads].sort(
      (a, b) => (a.playlist_index ?? 0) - (b.playlist_index ?? 0)
    )
    result.push({
      ...playlist,
      total_count: sorted.length,
      completed_count: sorted.filter((d) => d.status === 'complete').length,
      downloads: sorted
    })
  }

  return result.sort((a, b) => {
    const aTime = 'created_at' in a ? a.created_at : ''
    const bTime = 'created_at' in b ? b.created_at : ''
    return new Date(bTime).getTime() - new Date(aTime).getTime()
  })
}
