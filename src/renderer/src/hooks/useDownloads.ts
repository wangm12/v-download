import { useState, useEffect, useCallback } from 'react'
import type { Download, DownloadStatus } from '@/types'

function normalizeTask(t: Record<string, unknown>): Download {
  return {
    id: String(t.id ?? ''),
    url: String(t.url ?? ''),
    title: String(t.title ?? ''),
    format: String(t.format ?? ''),
    quality: String(t.quality ?? ''),
    status: (t.status as DownloadStatus) ?? 'queued',
    progress: Number(t.progress ?? 0),
    speed: (t.speed as string) || null,
    eta: (t.eta as string) || null,
    totalSize: (t.totalSize as string) || null,
    phase: (t.phase as string) || null,
    file_path: (t.file_path ?? t.filePath) as string | null,
    file_size: (t.file_size ?? t.fileSize) as number | null,
    thumbnail: (t.thumbnail ?? null) as string | null,
    duration: (t.duration ?? null) as number | null,
    channel: (t.channel ?? (t.metadata as Record<string, unknown>)?.channel ?? null) as string | null,
    playlist_id: (t.playlist_id ?? t.playlistId ?? null) as string | null,
    playlist_index: (t.playlist_index ?? t.playlistIndex ?? null) as number | null,
    error: (t.error ?? null) as string | null,
    created_at: String(t.created_at ?? t.createdAt ?? ''),
    updated_at: String(t.updated_at ?? t.updatedAt ?? '')
  }
}

function normalizeTasks(data: unknown[]): Download[] {
  return data.map((t) => normalizeTask(t as Record<string, unknown>))
}

export function useDownloads() {
  const [downloads, setDownloads] = useState<Download[]>([])

  const removeDownload = useCallback((id: string) => {
    setDownloads((prev) => prev.filter((d) => d.id !== id))
  }, [])

  const updateDownload = useCallback((id: string, updates: Partial<Download>) => {
    setDownloads((prev) =>
      prev.map((d) => (d.id === id ? { ...d, ...updates } : d))
    )
  }, [])

  const refreshDownloads = useCallback(async () => {
    if (typeof window !== 'undefined' && window.api) {
      const res = await window.api.getDownloads()
      const data = (res as { data?: unknown[] })?.data ?? res
      setDownloads(Array.isArray(data) ? normalizeTasks(data) : [])
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.api) return

    window.api.getDownloads().then((res) => {
      const data = (res as { data?: unknown[] })?.data ?? res
      setDownloads(Array.isArray(data) ? normalizeTasks(data) : [])
    })

    const unsubProgress = window.api.onDownloadProgress((data) => {
      if (data?.cleared) {
        window.api.getDownloads().then((res) => {
          const arr = (res as { data?: unknown[] })?.data ?? res
          setDownloads(Array.isArray(arr) ? normalizeTasks(arr) : [])
        })
        return
      }
      const id = data?.id as string | undefined
      if (id) {
        const filePath = (data.filePath ?? data.file_path) as string | null | undefined
        setDownloads((prev) =>
          prev.map((d) =>
            d.id === id
              ? {
                  ...d,
                  progress: (data.progress as number) ?? d.progress,
                  status: (data.status as DownloadStatus) ?? d.status,
                  speed: (data.speed as string) || null,
                  eta: (data.eta as string) || null,
                  totalSize: (data.totalSize as string) || d.totalSize,
                  phase: (data.phase as string) || d.phase,
                  file_path: filePath ?? d.file_path,
                  title: (data.title as string) || d.title,
                  thumbnail: (data.thumbnail as string) || d.thumbnail,
                  error: (data.error as string) ?? d.error
                }
              : d
          )
        )
      }
    })

    const unsubNew = window.api.onNewDownload((data) => {
      if (data && typeof data === 'object') {
        setDownloads((prev) => [normalizeTask(data), ...prev])
      }
    })

    return () => {
      unsubProgress()
      unsubNew()
    }
  }, [])

  return { downloads, removeDownload, updateDownload, refreshDownloads }
}
