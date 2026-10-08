import { useEffect, useRef, useState } from 'react'
import { ThumbnailImage } from './ThumbnailImage'
import { requestCachedThumbnail } from '@/utils/thumbnailRequestQueue'

interface EntryThumbnailProps {
  pageUrl: string
  thumbnail?: string
  referer?: string
}

/** Row cover — uses list thumbnail when present, otherwise fetches per page URL (Bilibili flat list). */
export function EntryThumbnail({ pageUrl, thumbnail, referer }: EntryThumbnailProps) {
  const requestKey = `${pageUrl}\n${thumbnail ?? ''}`
  const containerRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [resolvedState, setResolvedState] = useState({ key: requestKey, src: thumbnail ?? '' })
  const resolved = resolvedState.key === requestKey ? resolvedState.src : thumbnail ?? ''

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      setIsVisible(Boolean(entry?.isIntersecting))
    }, { rootMargin: '160px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (thumbnail) {
      setResolvedState({ key: requestKey, src: thumbnail })
      return
    }
    if (!isVisible) return
    let cancelled = false
    const controller = new AbortController()
    setResolvedState({ key: requestKey, src: '' })
    ;(async () => {
      try {
        if (!window.api?.getEntryThumbnail) return
        const value = await requestCachedThumbnail(`entry:${pageUrl}`, async () => {
          const res = await window.api.getEntryThumbnail(pageUrl)
          return res?.data || null
        }, controller.signal)
        if (!cancelled && value) setResolvedState({ key: requestKey, src: value })
      } catch {
        /* placeholder */
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [pageUrl, requestKey, thumbnail, isVisible])

  return (
    <div ref={containerRef} className="w-full h-full">
      <ThumbnailImage src={resolved} referer={referer || pageUrl} />
    </div>
  )
}
