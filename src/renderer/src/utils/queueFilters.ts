import type { Download } from '@/types'

export function filterDownloadsBySearch(downloads: Download[], query: string): Download[] {
  const q = query.trim().toLowerCase()
  if (!q) return downloads
  return downloads.filter(
    (d) => d.title.toLowerCase().includes(q) || d.url.toLowerCase().includes(q)
  )
}
