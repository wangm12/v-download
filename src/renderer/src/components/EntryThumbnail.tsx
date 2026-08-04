import { useEffect, useState } from 'react'
import { ThumbnailImage } from './ThumbnailImage'
import { requestCachedThumbnail } from '@/utils/thumbnailRequestQueue'

interface EntryThumbnailProps {
  pageUrl: string
  thumbnail?: string
  referer?: string
}

/** Row cover — uses list thumbnail when present, otherwise fetches per page URL (Bilibili flat list). */
export function EntryThumbnail({ pageUrl, thumbnail, referer }: EntryThumbnailProps) {
  const [resolved, setResolved] = useState(thumbnail ?? '')

  useEffect(() => {
    if (thumbnail) {
      setResolved(thumbnail)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        if (!window.api?.getEntryThumbnail) return
        const value = await requestCachedThumbnail(`entry:${pageUrl}`, async () => {
          const res = await window.api.getEntryThumbnail(pageUrl)
          return res?.data || null
        })
        if (!cancelled && value) setResolved(value)
      } catch {
        /* placeholder */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pageUrl, thumbnail])

  return <ThumbnailImage src={resolved} referer={referer || pageUrl} />
}
