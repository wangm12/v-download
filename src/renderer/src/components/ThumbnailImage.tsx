import { memo, useEffect, useState } from 'react'
import { normalizeThumbnailUrl } from '@/utils/thumbnail'
import { requestCachedThumbnail } from '@/utils/thumbnailRequestQueue'

interface ThumbnailImageProps {
  src: string | null | undefined
  referer?: string
  alt?: string
  className?: string
  placeholderClassName?: string
}

export const ThumbnailImage = memo(function ThumbnailImage({
  src,
  referer,
  alt = '',
  className = 'w-full h-full object-cover',
  placeholderClassName = 'w-full h-full bg-gradient-to-br from-elevated to-surface'
}: ThumbnailImageProps) {
  const normalized = normalizeThumbnailUrl(src)
  const [resolved, setResolved] = useState(normalized)
  const [proxyTried, setProxyTried] = useState(false)

  useEffect(() => {
    setResolved(normalizeThumbnailUrl(src))
    setProxyTried(false)
  }, [src])

  const tryProxy = async () => {
    if (proxyTried || !normalized || normalized.startsWith('data:')) return
    setProxyTried(true)
    try {
      if (!window.api?.fetchThumbnailDataUrl) return
      const value = await requestCachedThumbnail(
        `proxy:${normalized}|${referer || ''}`,
        async () => {
          const res = await window.api.fetchThumbnailDataUrl(normalized, referer)
          return res?.data || null
        }
      )
      if (value) setResolved(value)
    } catch {
      /* keep broken state → placeholder */
    }
  }

  if (!resolved) {
    return <div className={placeholderClassName} />
  }

  return (
    <img
      src={resolved}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => {
        if (!proxyTried) void tryProxy()
        else setResolved('')
      }}
    />
  )
})
