import { useState, useCallback } from 'react'
import type { VideoInfo, SettingsData } from '@/types'
import { YOUTUBE_URL_REGEX, extractUrlFromClipboard } from '@/utils/youtube'

interface PendingPlaylistMeta {
  title?: string
  url: string
}

export function useUrlHandler(settings: SettingsData) {
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [showFormatDialog, setShowFormatDialog] = useState(false)
  const [pendingVideoInfo, setPendingVideoInfo] = useState<VideoInfo | null>(null)
  const [pendingEntries, setPendingEntries] = useState<VideoInfo[] | null>(null)
  const [pendingPlaylistMeta, setPendingPlaylistMeta] = useState<PendingPlaylistMeta | null>(null)

  const clearPending = useCallback(() => {
    setShowFormatDialog(false)
    setPendingVideoInfo(null)
    setPendingEntries(null)
    setPendingPlaylistMeta(null)
  }, [])

  const handleUrl = useCallback(async (url: string) => {
    if (loading) return
    if (!window.api) {
      setErrorMsg('App API not available')
      return
    }

    setErrorMsg('')
    setLoading(true)
    try {
      const res = await window.api.getVideoInfo(url)
      const resObj = res as { data?: unknown; error?: string }
      if (resObj?.error) {
        setErrorMsg(resObj.error)
        setLoading(false)
        return
      }
      const info = resObj?.data ?? res
      if (!info) {
        setErrorMsg('Failed to fetch video info')
        setLoading(false)
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
      setErrorMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [loading, settings.showFormatDialog, settings.defaultVideoQuality])

  const handlePaste = useCallback(async () => {
    if (loading || !window.api) return
    const text = await window.api.readClipboard()
    const url = extractUrlFromClipboard(text)
    if (!url) {
      if (text.trim()) setErrorMsg('Not a valid YouTube URL')
      return
    }
    await handleUrl(url)
  }, [loading, handleUrl])

  const handleExternalUrl = useCallback(async (rawUrl: string) => {
    let url = rawUrl
    if (url.startsWith('ytdl://')) {
      try {
        const parsed = new URL(url)
        url = decodeURIComponent(parsed.searchParams.get('url') || '')
      } catch {
        return
      }
    }
    if (!url || !YOUTUBE_URL_REGEX.test(url)) return
    handleUrl(url)
  }, [handleUrl])

  return {
    loading,
    errorMsg,
    showFormatDialog,
    pendingVideoInfo,
    pendingEntries,
    pendingPlaylistMeta,
    handleUrl,
    handlePaste,
    handleExternalUrl,
    clearPending,
    setShowFormatDialog
  }
}
