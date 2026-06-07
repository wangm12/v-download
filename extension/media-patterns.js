/**
 * Shared URL → media type rules for MV3 service worker and content scripts.
 * Exposed on globalThis so importScripts (background) and isolated content scripts can align.
 */
;(function (g) {
  'use strict'

  const MEDIA_PATTERNS = [
    { pattern: /\.m3u8(\?|#|$)/i, type: 'hls' },
    { pattern: /\.mp4(\?|#|$)/i, type: 'mp4' },
    { pattern: /\.webm(\?|#|$)/i, type: 'webm' },
    { pattern: /\.flv(\?|#|$)/i, type: 'flv' }
  ]

  const MIN_VIDEO_SIZE = 100000
  const SIZE_EXEMPT_TYPES = new Set(['hls'])

  function inferTypeFromUrl(url) {
    if (!url || typeof url !== 'string') return 'mp4'
    for (const { pattern, type } of MEDIA_PATTERNS) {
      if (pattern.test(url)) return type
    }
    return 'mp4'
  }

  g.VDownloadMediaPatterns = {
    MEDIA_PATTERNS,
    MIN_VIDEO_SIZE,
    SIZE_EXEMPT_TYPES,
    inferTypeFromUrl
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
