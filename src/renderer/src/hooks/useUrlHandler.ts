import { useState, useCallback, useEffect, useRef } from 'react'
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

type UrlMeta = {
  type?: string
  quality?: string
  autoStart?: boolean
  referer?: string
  title?: string
  headers?: Record<string, string>
}

export type LoadingPhase = '' | 'info' | 'sniffing'

interface InfoResolveResult {
  id: string
  url: string
  autoStart: boolean
  format?: string
  quality?: string
  requestedTitle?: string
  data?: unknown
  error?: string
}

interface SniffedResolveResult {
  id: string
  pageUrl: string
  pageTitle: string
  media: DetectedMedia[]
}

/** Page sniff looks for raw .m3u8/.mp4 — useful as fallback on unknown sites when yt-dlp parsing fails. */
function shouldSniffAfterYtdlpFailure(url: string, err: string): boolean {
  if (!err || !err.trim()) return false
  const likelyExtractorFailure =
    /unsupported url|unable to extract|no video formats found|unsupported webpage|extractor error|not available|no longer supported|primarily used for piracy/i.test(err)
  if (!likelyExtractorFailure) return false
  const bundle = `${url}\n${err}`.toLowerCase()
  if (
    /douyin|iesdouyin|tiktok|youtu\.be|youtube|music\.youtube|bilibili|b23\.tv|instagram|twitter\.com|:\/\/x\.com\/|facebook\.com|fb\.watch|reddit\.com|vimeo\.com|twitch\.tv|xiaohongshu\.com|xhslink\.com|snapchat|dailymotion|rumble\.com/i.test(
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

function toVideoInfo(data: unknown, fallbackUrl: string): VideoInfo {
  const info = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  return {
    id: String(info.id ?? ''),
    title: String(info.title ?? ''),
    thumbnail: normalizeThumbnailUrl(String(info.thumbnail ?? '')),
    duration: Number(info.duration ?? 0),
    channel: String(info.channel ?? ''),
    view_count: Number(info.view_count ?? 0),
    webpage_url: String(info.webpage_url ?? info.url ?? fallbackUrl),
    _type: typeof info._type === 'string' ? info._type : undefined,
    formats: Array.isArray(info.formats) ? info.formats as VideoInfo['formats'] : undefined,
    image_urls: Array.isArray(info.image_urls)
      ? info.image_urls.filter((item): item is string => typeof item === 'string')
      : undefined,
  }
}

function isGalleryInfo(info: VideoInfo): boolean {
  return (info._type === 'douyin_gallery' || info._type === 'xhs_gallery') && Boolean(info.image_urls?.length)
}

export function useUrlHandler(settings: SettingsData) {
  const siteDefaults = useCallback((url: string) => {
    try {
      const hostname = new URL(url).hostname.toLowerCase()
      return (settings.siteRules ?? []).find((rule) => {
        const domain = rule.domain.trim().toLowerCase()
        return rule.enabled && domain && (hostname === domain || hostname.endsWith(`.${domain}`))
      })
    } catch {
      return undefined
    }
  }, [settings.siteRules])

  const [errorMsg, setErrorMsg] = useState('')
  const [showFormatDialog, setShowFormatDialog] = useState(false)
  const [showDouyinProfilePicker, setShowDouyinProfilePicker] = useState(false)
  const [douyinProfileUrl, setDouyinProfileUrl] = useState('')
  const [showCollectionPicker, setShowCollectionPicker] = useState(false)
  const [collectionPickerUrl, setCollectionPickerUrl] = useState('')
  const [pendingVideoInfo, setPendingVideoInfo] = useState<VideoInfo | null>(null)
  const [pendingResolverId, setPendingResolverId] = useState<string | null>(null)
  const [pendingEntries, setPendingEntries] = useState<VideoInfo[] | null>(null)
  const [pendingPlaylistMeta, setPendingPlaylistMeta] = useState<PendingPlaylistMeta | null>(null)
  const [sniffedMedia, setSniffedMedia] = useState<DetectedMedia[] | null>(null)
  const [sniffedResolveId, setSniffedResolveId] = useState<string | null>(null)
  const [sniffedPageUrl, setSniffedPageUrl] = useState('')
  const [sniffedPageTitle, setSniffedPageTitle] = useState('')
  const [dialogQueueCount, setDialogQueueCount] = useState(0)

  const dialogOpenRef = useRef(false)
  const sniffOpenRef = useRef(false)
  const pendingResolverIdRef = useRef<string | null>(null)
  const sniffedResolveIdRef = useRef<string | null>(null)
  const readyResultsRef = useRef(new Map<string, InfoResolveResult>())
  const promotionInFlightRef = useRef(new Set<string>())
  const readyOrderRef = useRef<string[]>([])
  const sniffedResultsRef = useRef(new Map<string, SniffedResolveResult>())
  const sniffOrderRef = useRef<string[]>([])

  const refreshDialogQueueCount = useCallback(() => {
    setDialogQueueCount(readyOrderRef.current.length)
  }, [])

  const removeReadyId = useCallback((id: string) => {
    readyOrderRef.current = readyOrderRef.current.filter((candidate) => candidate !== id)
    refreshDialogQueueCount()
  }, [refreshDialogQueueCount])

  const removeSniffId = useCallback((id: string) => {
    sniffOrderRef.current = sniffOrderRef.current.filter((candidate) => candidate !== id)
  }, [])

  const openSniffResult = useCallback((id: string): boolean => {
    if (dialogOpenRef.current || sniffOpenRef.current) return false
    const result = sniffedResultsRef.current.get(id)
    if (!result) return false
    removeSniffId(id)
    setSniffedResolveId(id)
    sniffedResolveIdRef.current = id
    setSniffedMedia(result.media)
    setSniffedPageUrl(result.pageUrl)
    setSniffedPageTitle(result.pageTitle)
    sniffOpenRef.current = true
    return true
  }, [removeSniffId])

  const openReadyResult = useCallback((id: string): boolean => {
    if (dialogOpenRef.current || sniffOpenRef.current) return false
    const result = readyResultsRef.current.get(id)
    if (!result || result.data === undefined || result.error) return false
    removeReadyId(id)
    const rawInfo = result.data as Record<string, unknown>
    const entries = rawInfo?.entries as unknown[] | undefined
    if (Array.isArray(entries) && entries.length > 1) {
      setCollectionPickerUrl(result.url.trim())
      setShowCollectionPicker(true)
      dialogOpenRef.current = true
      return true
    }

    const info = toVideoInfo(result.data, result.url)
    setPendingVideoInfo(info)
    setPendingResolverId(id)
    pendingResolverIdRef.current = id
    setPendingEntries(null)
    setPendingPlaylistMeta(null)
    setShowFormatDialog(true)
    dialogOpenRef.current = true
    return true
  }, [removeReadyId])

  const advanceDialogQueue = useCallback(() => {
    if (dialogOpenRef.current || sniffOpenRef.current) return
    while (sniffOrderRef.current.length > 0) {
      const id = sniffOrderRef.current.shift()!
      if (openSniffResult(id)) return
    }
    while (readyOrderRef.current.length > 0) {
      const id = readyOrderRef.current.shift()!
      refreshDialogQueueCount()
      if (openReadyResult(id)) return
    }
  }, [openReadyResult, openSniffResult, refreshDialogQueueCount])

  const clearPending = useCallback((options: { consumeResolver?: boolean } = {}) => {
    const currentId = pendingResolverIdRef.current
    if (currentId) {
      removeReadyId(currentId)
      if (options.consumeResolver) readyResultsRef.current.delete(currentId)
    }
    pendingResolverIdRef.current = null
    setPendingResolverId(null)
    setShowFormatDialog(false)
    setPendingVideoInfo(null)
    setPendingEntries(null)
    setPendingPlaylistMeta(null)
    dialogOpenRef.current = false
    advanceDialogQueue()
  }, [advanceDialogQueue, removeReadyId])

  const closeDouyinProfilePicker = useCallback(() => {
    setShowDouyinProfilePicker(false)
    setDouyinProfileUrl('')
    dialogOpenRef.current = false
    advanceDialogQueue()
  }, [advanceDialogQueue])

  const closeCollectionPicker = useCallback(() => {
    setShowCollectionPicker(false)
    setCollectionPickerUrl('')
    dialogOpenRef.current = false
    advanceDialogQueue()
  }, [advanceDialogQueue])

  const clearSniffed = useCallback((options: { consumeResolver?: boolean } = {}) => {
    const currentId = sniffedResolveIdRef.current
    if (currentId) {
      removeSniffId(currentId)
      if (options.consumeResolver) sniffedResultsRef.current.delete(currentId)
    }
    sniffedResolveIdRef.current = null
    setSniffedResolveId(null)
    setSniffedMedia(null)
    setSniffedPageUrl('')
    setSniffedPageTitle('')
    sniffOpenRef.current = false
    advanceDialogQueue()
  }, [advanceDialogQueue, removeSniffId])

  const clearQueue = useCallback(() => {
    readyOrderRef.current = []
    sniffOrderRef.current = []
    refreshDialogQueueCount()
  }, [refreshDialogQueueCount])

  const promoteResolvedInfo = useCallback(async (result: InfoResolveResult, format?: string, quality?: string) => {
    if (!window.api || result.data === undefined) return false
    const info = toVideoInfo(result.data, result.url)
    const rule = siteDefaults(result.url)
    const selectedFormat = format || result.format || (rule?.format === 'audio' ? 'mp3' : 'video')
    const selectedQuality = quality || result.quality || rule?.quality || settings.defaultVideoQuality
    const metadata = isGalleryInfo(info)
      ? {
          [info._type === 'xhs_gallery' ? 'xhsImageUrls' : 'douyinImageUrls']: info.image_urls,
          channel: info.channel
        }
      : {
          ...(info.channel ? { channel: info.channel } : {}),
          ...(info.id ? { ytdlpId: info.id } : {})
        }
    const promoted = await window.api.promoteInfoResolve({
      id: result.id,
      url: info.webpage_url || result.url,
      title: result.requestedTitle || info.title || filenameFromUrl(result.url),
      format: selectedFormat,
      quality: selectedQuality,
      thumbnail: info.thumbnail,
      duration: info.duration,
      metadata
    })
    if (promoted?.error) {
      setErrorMsg(promoted.error)
      return false
    }
    readyResultsRef.current.delete(result.id)
    removeReadyId(result.id)
    return true
  }, [removeReadyId, settings.defaultVideoQuality, siteDefaults])

  const runFallbackSniff = useCallback(async (result: InfoResolveResult) => {
    if (!window.api?.sniffMedia) return false
    try {
      const sniffRes = await window.api.sniffMedia(result.url) as { data?: { media: DetectedMedia[]; pageTitle?: string }; error?: string }
      const sniffData = sniffRes?.data
      if (!sniffData?.media?.length) return false
      sniffedResultsRef.current.set(result.id, {
        id: result.id,
        pageUrl: result.url,
        pageTitle: sniffData.pageTitle || '',
        media: sniffData.media
      })
      const marked = await window.api.markInfoResolveReady({ id: result.id, title: sniffData.pageTitle || 'Detected media' })
      if (!marked?.ok) {
        sniffedResultsRef.current.delete(result.id)
        return false
      }
      if (!sniffOrderRef.current.includes(result.id)) sniffOrderRef.current.push(result.id)
      advanceDialogQueue()
      return true
    } catch {
      return false
    }
  }, [advanceDialogQueue])

  const handleResolveResult = useCallback((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return
    const result = raw as InfoResolveResult
    if (!result.id || typeof result.url !== 'string') return
    if (result.error) {
      if (shouldSniffAfterYtdlpFailure(result.url, result.error)) {
        void runFallbackSniff(result).then((handled) => {
          if (!handled) setErrorMsg(result.error || 'Failed to resolve video info')
        })
      } else {
        setErrorMsg(result.error)
      }
      return
    }
    if (result.data === undefined) return

    const rawInfo = result.data as Record<string, unknown>
    const entries = rawInfo?.entries as unknown[] | undefined
    if (Array.isArray(entries) && entries.length > 1) {
      readyResultsRef.current.set(result.id, result)
      if (result.autoStart) {
        setCollectionPickerUrl(result.url.trim())
        setShowCollectionPicker(true)
        dialogOpenRef.current = true
      } else if (!readyOrderRef.current.includes(result.id)) {
        readyOrderRef.current.push(result.id)
        refreshDialogQueueCount()
        advanceDialogQueue()
      }
      return
    }

    if (result.autoStart || !settings.showFormatDialog) {
      if (promotionInFlightRef.current.has(result.id)) return
      promotionInFlightRef.current.add(result.id)
      void promoteResolvedInfo(result).finally(() => promotionInFlightRef.current.delete(result.id))
      return
    }
    readyResultsRef.current.set(result.id, result)
    if (!readyOrderRef.current.includes(result.id)) readyOrderRef.current.push(result.id)
    refreshDialogQueueCount()
    advanceDialogQueue()
  }, [advanceDialogQueue, promoteResolvedInfo, refreshDialogQueueCount, runFallbackSniff, settings.showFormatDialog])

  useEffect(() => {
    if (!window.api?.onInfoResolveResult) return
    const unsubscribe = window.api.onInfoResolveResult(handleResolveResult)
    void window.api.getInfoResolveResults?.().then((response) => {
      const results = (response as { data?: unknown[] })?.data
      if (Array.isArray(results)) results.forEach(handleResolveResult)
    }).catch(() => undefined)
    return unsubscribe
  }, [handleResolveResult])

  const selectReadyResolve = useCallback((id: string) => {
    if (sniffedResultsRef.current.has(id)) {
      if (!openSniffResult(id)) setErrorMsg('Finish the current media selection first')
      return
    }
    if (!openReadyResult(id)) setErrorMsg('This result is not available yet; retry the task to resolve it again')
  }, [openReadyResult, openSniffResult])

  const handleUrl = useCallback(async (rawUrl: string, meta?: UrlMeta) => {
    if (!window.api) {
      setErrorMsg('App API not available')
      return
    }
    const url = rawUrl.trim()
    if (!url) return

    // Extension passes mediaType for raw CDN URLs that do not match isMediaUrl
    // (for example Douyin tos paths without ".mp4"). These remain immediate
    // direct-media downloads and do not need an info placeholder.
    const extensionDirectTypes = ['mp4', 'hls', 'webm', 'flv', 'jpeg', 'mp3'] as const
    const fromExtension =
      !!meta?.type &&
      (extensionDirectTypes as readonly string[]).includes(meta.type) &&
      /^https?:\/\//i.test(url)
    if ((isMediaUrl(url) || fromExtension) && !isYouTubeUrl(url)) {
      const rule = siteDefaults(url)
      await window.api.startDownload({
        url,
        title: meta?.title || filenameFromUrl(url),
        format: rule?.format === 'audio' ? 'mp3' : 'video',
        quality: meta?.quality || rule?.quality || settings.defaultVideoQuality,
        referer: meta?.referer,
        customHeaders: meta?.headers,
        mediaType: meta?.type
      })
      return
    }

    if (isDouyinProfileHomeUrl(url)) {
      setDouyinProfileUrl(url)
      setShowDouyinProfilePicker(true)
      dialogOpenRef.current = true
      return
    }

    if (shouldOpenCollectionPicker(url)) {
      setCollectionPickerUrl(url)
      setShowCollectionPicker(true)
      dialogOpenRef.current = true
      return
    }

    const rule = siteDefaults(url)
    const response = await window.api.startInfoResolve({
      url,
      title: meta?.title,
      format: rule?.format === 'audio' ? 'mp3' : 'video',
      quality: meta?.quality || rule?.quality || settings.defaultVideoQuality,
      metadata: {
        resolveAutoStart: meta?.autoStart === true,
        ...(meta?.type ? { mediaType: meta.type } : {})
      },
      referer: meta?.referer,
      customHeaders: meta?.headers
    })
    if (response?.error) setErrorMsg(response.error)
  }, [settings.defaultVideoQuality, siteDefaults])

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
    let meta: UrlMeta | undefined

    if (url.startsWith('ytdl://') || url.startsWith('vdownload://')) {
      try {
        const parsed = new URL(url)
        if (parsed.hostname === 'wake' || parsed.hostname === 'open') return
        url = parsed.searchParams.get('url') || ''
        const type = parsed.searchParams.get('type') || undefined
        const quality = parsed.searchParams.get('quality') || undefined
        const autoStart = parsed.searchParams.get('autoStart') === '1' ? true : undefined
        const referer = parsed.searchParams.get('referer') || undefined
        const title = parsed.searchParams.get('title') || undefined
        const headersStr = parsed.searchParams.get('headers')
        const headers = headersStr ? JSON.parse(headersStr) : undefined
        if (type || quality || autoStart || referer || title || headers) meta = { type, quality, autoStart, referer, title, headers }
      } catch {
        return
      }
    }

    if (url) await handleUrl(url, meta)
  }, [handleUrl])

  return {
    // Kept in the return shape for callers that still consume the old hook
    // contract. Ordinary resolution no longer toggles this global overlay.
    loading: false,
    loadingPhase: '' as LoadingPhase,
    errorMsg,
    showFormatDialog,
    showDouyinProfilePicker,
    douyinProfileUrl,
    showCollectionPicker,
    collectionPickerUrl,
    pendingVideoInfo,
    pendingResolverId,
    pendingEntries,
    pendingPlaylistMeta,
    sniffedMedia,
    sniffedResolveId,
    sniffedPageUrl,
    sniffedPageTitle,
    queueCount: dialogQueueCount,
    handleUrl,
    handlePaste,
    handleExternalUrl,
    clearPending,
    clearSniffed,
    clearQueue,
    selectReadyResolve,
    setShowFormatDialog,
    closeDouyinProfilePicker,
    closeCollectionPicker
  }
}
