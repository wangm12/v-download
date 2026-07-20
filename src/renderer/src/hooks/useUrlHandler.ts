import { useState, useCallback, useRef } from 'react'
import type { VideoInfo, SettingsData } from '@/types'
import { extractUrlFromClipboard, isMediaUrl, isYouTubeUrl, filenameFromUrl } from '@/utils/youtube'
import { isDouyinProfileHomeUrl } from '@/utils/douyinBulk'
import { shouldOpenCollectionPicker } from '@/utils/collectionPicker'
import { normalizeThumbnailUrl } from '@/utils/thumbnail'
import type { DetectedMedia } from '@/components/MediaPickerDialog'

interface PendingPlaylistMeta {
  title?: string
  url: string
}

export type LoadingPhase = '' | 'info' | 'sniffing'

interface QueuedUrl {
  url: string
  meta?: { type?: string; referer?: string; title?: string; headers?: Record<string, string> }
}

/** Page sniff looks for raw .m3u8/.mp4 — useful as fallback on unknown sites when yt-dlp parsing fails. */
function shouldSniffAfterYtdlpFailure(url: string, err: string): boolean {
  if (!err || !err.trim()) return false
  const likelyExtractorFailure =
    /unsupported url|unable to extract|no video formats found|unsupported webpage|extractor error|not available|no longer supported|primarily used for piracy/i.test(err)
  if (!likelyExtractorFailure) return false
  const bundle = `${url}\n${err}`.toLowerCase()
  // Block by URL and by error text (yt-dlp often repeats the target URL in the message).
  if (
    /douyin|iesdouyin|tiktok|youtu\.be|youtube|music\.youtube|bilibili|b23\.tv|instagram|twitter\.com|:\/\/x\.com\/|facebook\.com|fb\.watch|reddit\.com|vimeo\.com|twitch\.tv|xiaohongshu\.com|xhslink\.com|snapchat\.com|dailymotion|rumble\.com/i.test(
      bundle
    )
  ) {
    return false
  }
  try {
    const host = new URL(url).hostname.toLowerCase()
    const blockedHosts = [
      'douyin.com',
      'iesdouyin.com',
      'tiktok.com',
      'youtube.com',
      'youtu.be',
      'music.youtube.com',
      'bilibili.com',
      'b23.tv',
      'instagram.com',
      'twitter.com',
      'x.com',
      'facebook.com',
      'fb.watch',
      'reddit.com',
      'vimeo.com',
      'twitch.tv',
      'xiaohongshu.com',
      'xhslink.com',
    ]
    for (const suffix of blockedHosts) {
      if (host === suffix || host.endsWith(`.${suffix}`)) return false
    }
  } catch {
    return false
  }
  return true
}

export function useUrlHandler(settings: SettingsData) {
  const siteDefaults = useCallback((url: string) => {
    try {
      const hostname = new URL(url).hostname.toLowerCase()
      return (settings.siteRules ?? []).find((rule) => {
        const domain = rule.domain.trim().toLowerCase()
        return rule.enabled && domain && (hostname === domain || hostname.endsWith(`.${domain}`))
      })
    } catch { return undefined }
  }, [settings.siteRules])
  const [loading, setLoading] = useState(false)
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>('')
  const [errorMsg, setErrorMsg] = useState('')
  const [showFormatDialog, setShowFormatDialog] = useState(false)
  const [showDouyinProfilePicker, setShowDouyinProfilePicker] = useState(false)
  const [douyinProfileUrl, setDouyinProfileUrl] = useState('')
  const [showCollectionPicker, setShowCollectionPicker] = useState(false)
  const [collectionPickerUrl, setCollectionPickerUrl] = useState('')
  const [pendingVideoInfo, setPendingVideoInfo] = useState<VideoInfo | null>(null)
  const [pendingEntries, setPendingEntries] = useState<VideoInfo[] | null>(null)
  const [pendingPlaylistMeta, setPendingPlaylistMeta] = useState<PendingPlaylistMeta | null>(null)

  const [sniffedMedia, setSniffedMedia] = useState<DetectedMedia[] | null>(null)
  const [sniffedPageUrl, setSniffedPageUrl] = useState('')
  const [sniffedPageTitle, setSniffedPageTitle] = useState('')

  const [pendingUrls, setPendingUrls] = useState<QueuedUrl[]>([])
  const pendingUrlsRef = useRef<QueuedUrl[]>([])
  const busyRef = useRef(false)
  const dialogOpenRef = useRef(false)
  const sniffOpenRef = useRef(false)
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchAndShowRef = useRef<((url: string, meta?: { type?: string; referer?: string; title?: string; headers?: Record<string, string> }) => Promise<void>) | null>(null)

  const updatePendingUrls = useCallback((updater: QueuedUrl[] | ((prev: QueuedUrl[]) => QueuedUrl[])) => {
    setPendingUrls((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      pendingUrlsRef.current = next
      return next
    })
  }, [])

  const advanceQueue = useCallback(() => {
    updatePendingUrls((prev) => {
      if (prev.length === 0) return prev
      const [next, ...rest] = prev
      setTimeout(() => fetchAndShowRef.current?.(next.url, next.meta), 0)
      return rest
    })
  }, [updatePendingUrls])

  const scheduleAutoAdvance = useCallback((msg: string) => {
    setErrorMsg(msg)
    if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current)
    autoAdvanceTimer.current = setTimeout(() => {
      autoAdvanceTimer.current = null
      setErrorMsg('')
      advanceQueue()
    }, 2000)
  }, [advanceQueue])

  const isBusy = useCallback(() => {
    return busyRef.current || dialogOpenRef.current || sniffOpenRef.current
  }, [])

  const clearPending = useCallback(() => {
    setShowFormatDialog(false)
    setShowDouyinProfilePicker(false)
    setDouyinProfileUrl('')
    setShowCollectionPicker(false)
    setCollectionPickerUrl('')
    setPendingVideoInfo(null)
    setPendingEntries(null)
    setPendingPlaylistMeta(null)
    dialogOpenRef.current = false
    advanceQueue()
  }, [advanceQueue])

  const closeDouyinProfilePicker = useCallback(() => {
    setShowDouyinProfilePicker(false)
    setDouyinProfileUrl('')
    dialogOpenRef.current = false
    advanceQueue()
  }, [advanceQueue])

  const closeCollectionPicker = useCallback(() => {
    setShowCollectionPicker(false)
    setCollectionPickerUrl('')
    dialogOpenRef.current = false
    advanceQueue()
  }, [advanceQueue])

  const clearSniffed = useCallback(() => {
    setSniffedMedia(null)
    setSniffedPageUrl('')
    setSniffedPageTitle('')
    sniffOpenRef.current = false
    advanceQueue()
  }, [advanceQueue])

  const clearQueue = useCallback(() => {
    updatePendingUrls([])
  }, [updatePendingUrls])

  const fetchAndShow = useCallback(async (url: string, meta?: { type?: string; referer?: string; title?: string; headers?: Record<string, string> }) => {
    if (!window.api) {
      setErrorMsg('App API not available')
      return
    }

    setErrorMsg('')
    if (autoAdvanceTimer.current) {
      clearTimeout(autoAdvanceTimer.current)
      autoAdvanceTimer.current = null
    }
    setLoading(true)
    setLoadingPhase('info')
    busyRef.current = true
    try {
      // Extension passes mediaType for raw CDN URLs that do not match isMediaUrl (e.g. Douyin tos paths without ".mp4")
      const extensionDirectTypes = ['mp4', 'hls', 'webm', 'flv', 'jpeg', 'mp3'] as const
      const fromExtension =
        !!meta?.type &&
        (extensionDirectTypes as readonly string[]).includes(meta.type) &&
        /^https?:\/\//i.test(url)
      if ((isMediaUrl(url) || fromExtension) && !isYouTubeUrl(url)) {
        const rule = siteDefaults(url)
        const title = meta?.title || filenameFromUrl(url)
        await window.api.startDownload({
          url,
          title,
          format: rule?.format === 'audio' ? 'mp3' : 'video',
          quality: rule?.quality || settings.defaultVideoQuality,
          referer: meta?.referer,
          customHeaders: meta?.headers,
          mediaType: meta?.type
        })
        return
      }

      if (isDouyinProfileHomeUrl(url)) {
        setDouyinProfileUrl(url.trim())
        setShowDouyinProfilePicker(true)
        dialogOpenRef.current = true
        setLoading(false)
        setLoadingPhase('')
        busyRef.current = false
        return
      }

      if (shouldOpenCollectionPicker(url)) {
        setCollectionPickerUrl(url.trim())
        setShowCollectionPicker(true)
        dialogOpenRef.current = true
        setLoading(false)
        setLoadingPhase('')
        busyRef.current = false
        return
      }

      const res = await window.api.getVideoInfo(url)
      const resObj = res as { data?: unknown; error?: string }
      if (resObj?.error) {
        const err = resObj.error
        const trySniff = shouldSniffAfterYtdlpFailure(url, err)
        if (trySniff) {
          setLoadingPhase('sniffing')
          try {
            const sniffRes = await (window.api as { sniffMedia: (url: string) => Promise<{ data?: { media: DetectedMedia[]; pageTitle: string }; error?: string }> }).sniffMedia(url)
            const sniffData = sniffRes?.data
            if (sniffData?.media && sniffData.media.length > 0) {
              setSniffedMedia(sniffData.media)
              setSniffedPageUrl(url)
              setSniffedPageTitle(sniffData.pageTitle || '')
              sniffOpenRef.current = true
            } else {
              const tail = err.length > 220 ? `${err.slice(0, 220)}…` : err
              const msg = `No direct media URLs found in the page load. yt-dlp said: ${tail}`
              if (pendingUrlsRef.current.length > 0) scheduleAutoAdvance(msg)
              else setErrorMsg(msg)
            }
          } catch {
            const msg = 'Failed to scan page for media'
            if (pendingUrlsRef.current.length > 0) scheduleAutoAdvance(msg)
            else setErrorMsg(msg)
          }
          setLoading(false)
          setLoadingPhase('')
          busyRef.current = false
          return
        } else {
          if (pendingUrlsRef.current.length > 0) scheduleAutoAdvance(err)
          else setErrorMsg(err)
        }
        setLoading(false)
        setLoadingPhase('')
        busyRef.current = false
        return
      }
      const info = resObj?.data ?? res
      if (!info) {
        const msg = 'Failed to fetch video info'
        if (pendingUrlsRef.current.length > 0) scheduleAutoAdvance(msg)
        else setErrorMsg(msg)
        setLoading(false)
        setLoadingPhase('')
        busyRef.current = false
        return
      }

      const infoObj = info as Record<string, unknown>
      const entries = infoObj?.entries as unknown[] | undefined

      if (Array.isArray(entries) && entries.length > 1) {
        setCollectionPickerUrl(url.trim())
        setShowCollectionPicker(true)
        dialogOpenRef.current = true
        setLoading(false)
        setLoadingPhase('')
        busyRef.current = false
        return
      }

      {
        const galleryUrls = infoObj?.image_urls
        const galleryType = infoObj?._type
        const isImageGalleryInfo =
          (galleryType === 'douyin_gallery' || galleryType === 'xhs_gallery') &&
          Array.isArray(galleryUrls) &&
          galleryUrls.length > 0

        if (isImageGalleryInfo) {
          const galleryTitle = String(infoObj?.title ?? 'gallery')
          const galleryChannel = String(infoObj?.channel ?? '')
          const imageMetaKey = galleryType === 'xhs_gallery' ? 'xhsImageUrls' : 'douyinImageUrls'
          if (settings.showFormatDialog) {
            const gallerySummary: VideoInfo = {
              id: String(infoObj?.id ?? ''),
              title: galleryTitle,
              thumbnail: normalizeThumbnailUrl(String(infoObj?.thumbnail ?? '')),
              duration: 0,
              channel: galleryChannel,
              view_count: 0,
              webpage_url: String(infoObj?.webpage_url ?? url),
              _type: String(galleryType),
              image_urls: galleryUrls as string[]
            }
            setPendingVideoInfo(gallerySummary)
            setPendingEntries(null)
            setPendingPlaylistMeta(null)
            setShowFormatDialog(true)
            dialogOpenRef.current = true
          } else {
            await window.api.startDownload({
              url,
              title: galleryTitle,
              format: 'video',
              quality: settings.defaultVideoQuality,
              thumbnail: normalizeThumbnailUrl(String(infoObj?.thumbnail ?? '')),
              duration: 0,
              metadata: {
                [imageMetaKey]: galleryUrls as string[],
                channel: galleryChannel
              }
            })
          }
        } else {
          const videoInfo: VideoInfo = {
            id: String(infoObj?.id ?? ''),
            title: String(infoObj?.title ?? ''),
            thumbnail: normalizeThumbnailUrl(String(infoObj?.thumbnail ?? '')),
            duration: Number(infoObj?.duration ?? 0),
            channel: String(infoObj?.channel ?? ''),
            view_count: Number(infoObj?.view_count ?? 0),
            webpage_url: String(infoObj?.webpage_url ?? infoObj?.url ?? url),
            formats: Array.isArray(infoObj?.formats) ? infoObj.formats as VideoInfo['formats'] : undefined
          }

          if (settings.showFormatDialog) {
            setPendingVideoInfo(videoInfo)
            setPendingEntries(null)
            setPendingPlaylistMeta(null)
            setShowFormatDialog(true)
            dialogOpenRef.current = true
          } else {
            const rule = siteDefaults(url)
            await window.api.startDownload({
              url,
              title: videoInfo.title,
              format: rule?.format === 'audio' ? 'mp3' : 'video',
              quality: rule?.quality || settings.defaultVideoQuality,
              thumbnail: videoInfo.thumbnail,
              duration: videoInfo.duration,
              metadata: videoInfo.id ? { ytdlpId: videoInfo.id } : undefined
            })
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (pendingUrlsRef.current.length > 0) scheduleAutoAdvance(msg)
      else setErrorMsg(msg)
    } finally {
      setLoading(false)
      setLoadingPhase('')
      busyRef.current = false
    }
  }, [
    settings.showFormatDialog,
    settings.defaultVideoQuality,
    siteDefaults,
    settings.youtubePlaylistMode,
    scheduleAutoAdvance
  ])

  fetchAndShowRef.current = fetchAndShow

  const handleUrl = useCallback(async (url: string, meta?: { type?: string; referer?: string; title?: string; headers?: Record<string, string> }) => {
    if (isBusy()) {
      updatePendingUrls((prev) => {
        const isDuplicate = prev.some((p) => p.url === url)
        if (isDuplicate) return prev
        return [...prev, { url, meta }]
      })
      return
    }
    await fetchAndShow(url, meta)
  }, [isBusy, fetchAndShow])

  const handlePaste = useCallback(async () => {
    if (!window.api) return
    const text = await window.api.readClipboard()
    const url = extractUrlFromClipboard(text)
    if (!url) {
      if (text.trim()) setErrorMsg('No http(s) link found in clipboard')
      return
    }
    await handleUrl(url)
  }, [handleUrl])

  const handleExternalUrl = useCallback(async (rawUrl: string) => {
    let url = rawUrl
    let meta: { type?: string; referer?: string; title?: string; headers?: Record<string, string> } | undefined

    if (url.startsWith('ytdl://') || url.startsWith('vdownload://')) {
      try {
        const parsed = new URL(url)
        if (parsed.hostname === 'wake' || parsed.hostname === 'open') {
          return
        }
        // searchParams.get already percent-decodes once; avoid decodeURIComponent (throws on stray %)
        url = parsed.searchParams.get('url') || ''
        const type = parsed.searchParams.get('type') || undefined
        const referer = parsed.searchParams.get('referer') || undefined
        const title = parsed.searchParams.get('title') || undefined
        const headersStr = parsed.searchParams.get('headers')
        const headers = headersStr ? JSON.parse(headersStr) : undefined
        if (type || referer || title || headers) {
          meta = { type, referer, title, headers }
        }
      } catch {
        return
      }
    }

    if (!url) return
    handleUrl(url, meta)
  }, [handleUrl])

  return {
    loading,
    loadingPhase,
    errorMsg,
    showFormatDialog,
    showDouyinProfilePicker,
    douyinProfileUrl,
    showCollectionPicker,
    collectionPickerUrl,
    pendingVideoInfo,
    pendingEntries,
    pendingPlaylistMeta,
    sniffedMedia,
    sniffedPageUrl,
    sniffedPageTitle,
    queueCount: pendingUrls.length,
    handleUrl,
    handlePaste,
    handleExternalUrl,
    clearPending,
    clearSniffed,
    clearQueue,
    setShowFormatDialog,
    closeDouyinProfilePicker,
    closeCollectionPicker
  }
}
