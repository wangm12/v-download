import { useState, useCallback, useRef } from 'react'
import type { VideoInfo, SettingsData } from '@/types'
import { extractUrlFromClipboard, isMediaUrl, isYouTubeUrl, filenameFromUrl } from '@/utils/youtube'
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

export function useUrlHandler(settings: SettingsData) {
  const [loading, setLoading] = useState(false)
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>('')
  const [errorMsg, setErrorMsg] = useState('')
  const [showFormatDialog, setShowFormatDialog] = useState(false)
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
    setPendingVideoInfo(null)
    setPendingEntries(null)
    setPendingPlaylistMeta(null)
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
      if (isMediaUrl(url) && !isYouTubeUrl(url)) {
        const title = meta?.title || filenameFromUrl(url)
        await window.api.startDownload({
          url,
          title,
          format: 'video',
          quality: settings.defaultVideoQuality,
          referer: meta?.referer,
          customHeaders: meta?.headers,
          mediaType: meta?.type
        })
        return
      }

      const res = await window.api.getVideoInfo(url)
      const resObj = res as { data?: unknown; error?: string }
      if (resObj?.error) {
        const err = resObj.error
        if (err.includes('Unsupported URL')) {
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
              const msg = 'No media streams found on this page'
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

      if (Array.isArray(entries) && entries.length > 0) {
        const allEntries = entries.map((e) => {
          const eo = e as Record<string, unknown>
          return {
            id: String(eo.id ?? ''),
            title: String(eo.title ?? ''),
            thumbnail: String(eo.thumbnail ?? ''),
            duration: Number(eo.duration ?? 0),
            channel: String(eo.channel ?? ''),
            view_count: Number(eo.view_count ?? 0),
            webpage_url: String(eo.webpage_url ?? eo.url ?? '')
          } as VideoInfo
        })
        const playlistChannel = String(infoObj.playlist_channel ?? allEntries[0]?.channel ?? '')
        const playlistTitle = String(infoObj.playlist_title ?? (playlistChannel || 'Playlist'))

        if (settings.showFormatDialog) {
          const summary: VideoInfo = {
            ...allEntries[0],
            title: playlistTitle,
            channel: playlistChannel,
            playlist_title: playlistTitle,
            playlist_count: allEntries.length
          }
          setPendingVideoInfo(summary)
          setPendingEntries(allEntries)
          setPendingPlaylistMeta({ title: playlistTitle, url })
          setShowFormatDialog(true)
          dialogOpenRef.current = true
        } else {
          for (let i = 0; i < allEntries.length; i++) {
            const entry = allEntries[i]
            const videoUrl = entry.webpage_url || `https://www.youtube.com/watch?v=${entry.id}`
            await window.api.startDownload({
              url: videoUrl,
              title: entry.title,
              format: 'video',
              quality: settings.defaultVideoQuality,
              thumbnail: entry.thumbnail,
              duration: entry.duration,
              playlistId: playlistTitle,
              playlistIndex: i,
              playlistTitle
            })
          }
        }
      } else {
        const videoInfo: VideoInfo = {
          id: String(infoObj?.id ?? ''),
          title: String(infoObj?.title ?? ''),
          thumbnail: String(infoObj?.thumbnail ?? ''),
          duration: Number(infoObj?.duration ?? 0),
          channel: String(infoObj?.channel ?? ''),
          view_count: Number(infoObj?.view_count ?? 0),
          webpage_url: String(infoObj?.webpage_url ?? infoObj?.url ?? url)
        }

        if (settings.showFormatDialog) {
          setPendingVideoInfo(videoInfo)
          setPendingEntries(null)
          setPendingPlaylistMeta(null)
          setShowFormatDialog(true)
          dialogOpenRef.current = true
        } else {
          await window.api.startDownload({
            url,
            title: videoInfo.title,
            format: 'video',
            quality: settings.defaultVideoQuality,
            thumbnail: videoInfo.thumbnail,
            duration: videoInfo.duration
          })
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
  }, [settings.showFormatDialog, settings.defaultVideoQuality, scheduleAutoAdvance])

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
      if (text.trim()) setErrorMsg('Not a valid URL (paste an HTTP link)')
      return
    }
    await handleUrl(url)
  }, [handleUrl])

  const handleExternalUrl = useCallback(async (rawUrl: string) => {
    let url = rawUrl
    let meta: { type?: string; referer?: string; title?: string; headers?: Record<string, string> } | undefined

    if (url.startsWith('ytdl://')) {
      try {
        const parsed = new URL(url)
        url = decodeURIComponent(parsed.searchParams.get('url') || '')
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
    setShowFormatDialog
  }
}
