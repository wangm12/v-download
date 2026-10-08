import { memo, useLayoutEffect, useRef, useState } from 'react'
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
  const requestKey = `${normalized}\n${referer || ''}`
  const currentRequestKeyRef = useRef(requestKey)
  const proxyRequestControllerRef = useRef<AbortController | null>(null)
  useLayoutEffect(() => {
    currentRequestKeyRef.current = requestKey
  }, [requestKey])
  useLayoutEffect(() => {
    const controller = new AbortController()
    proxyRequestControllerRef.current = controller
    return () => {
      controller.abort()
      if (proxyRequestControllerRef.current === controller) proxyRequestControllerRef.current = null
    }
  }, [requestKey])
  const [resolvedState, setResolvedState] = useState({ key: requestKey, src: normalized })
  const [proxyAttemptState, setProxyAttemptState] = useState({ key: requestKey, tried: false })
  const resolved = resolvedState.key === requestKey ? resolvedState.src : normalized
  const proxyTried = proxyAttemptState.key === requestKey && proxyAttemptState.tried

  const tryProxy = async (key: string) => {
    if (
      currentRequestKeyRef.current !== key ||
      proxyTried ||
      !normalized ||
      normalized.startsWith('data:')
    ) return
    setProxyAttemptState({ key, tried: true })
    try {
      if (!window.api?.fetchThumbnailDataUrl) return
      const value = await requestCachedThumbnail(
        `proxy:${key}`,
        async () => {
          const res = await window.api.fetchThumbnailDataUrl(normalized, referer)
          return res?.data || null
        },
        proxyRequestControllerRef.current?.signal
      )
      if (value && currentRequestKeyRef.current === key) setResolvedState({ key, src: value })
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
        if (currentRequestKeyRef.current !== requestKey) return
        if (!proxyTried) void tryProxy(requestKey)
        else setResolvedState({ key: requestKey, src: '' })
      }}
    />
  )
})
