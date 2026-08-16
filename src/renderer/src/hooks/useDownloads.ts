import { useState, useEffect, useCallback, useRef } from 'react'
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
    error_code: (t.error_code ?? t.errorCode ?? null) as Download['error_code'],
    created_at: String(t.created_at ?? t.createdAt ?? ''),
    updated_at: String(t.updated_at ?? t.updatedAt ?? '')
  }
}

function normalizeTasks(data: unknown[]): Download[] {
  return data.map((t) => normalizeTask(t as Record<string, unknown>))
}

// The main-process reporter already throttles progress to roughly this cadence.
// Matching it avoids rendering intermediate IPC events that cannot be displayed.
const PROGRESS_FLUSH_MS = 400

/** Only merge IPC fields that are actually present — never wipe title/thumbnail with undefined. */
function progressPatchFromIpc(data: Record<string, unknown>): Partial<Download> {
  const patch: Partial<Download> = {}
  if (typeof data.progress === 'number') patch.progress = data.progress
  if (typeof data.status === 'string') patch.status = data.status as DownloadStatus
  if ('speed' in data) patch.speed = (data.speed as string) || null
  if ('eta' in data) patch.eta = (data.eta as string) || null
  if ('totalSize' in data) patch.totalSize = (data.totalSize as string) || null
  if ('phase' in data) patch.phase = (data.phase as string) || null
  const filePath = data.filePath ?? data.file_path
  if (typeof filePath === 'string') patch.file_path = filePath
  if (typeof data.title === 'string' && data.title.trim()) patch.title = data.title
  if (typeof data.thumbnail === 'string') patch.thumbnail = data.thumbnail
  if (typeof data.duration === 'number') patch.duration = data.duration
  if (typeof data.channel === 'string') patch.channel = data.channel
  if (typeof data.error === 'string') patch.error = data.error
  if ('errorCode' in data || 'error_code' in data) patch.error_code = (data.errorCode ?? data.error_code ?? null) as Download['error_code']
  return patch
}

export function useDownloads() {
  const [downloads, setDownloads] = useState<Download[]>([])
  const pendingRef = useRef(new Map<string, Partial<Download>>())
  const downloadIndexRef = useRef(new Map<string, number>())
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshPromiseRef = useRef<Promise<void> | null>(null)

  const rebuildDownloadIndex = useCallback((items: Download[]) => {
    const index = new Map<string, number>()
    items.forEach((download, position) => index.set(download.id, position))
    downloadIndexRef.current = index
  }, [])

  const flushPending = useCallback(() => {
    flushTimerRef.current = null
    const batch = pendingRef.current
    if (batch.size === 0) return
    const snapshot = new Map(batch)
    batch.clear()
    setDownloads((prev) => {
      let next: Download[] | null = null
      for (const [id, updates] of snapshot) {
        let position = downloadIndexRef.current.get(id)
        if (position == null || prev[position]?.id !== id) {
          position = prev.findIndex((download) => download.id === id)
        }
        if (position < 0 || position >= prev.length) continue

        const current = next?.[position] ?? prev[position]
        const changed = Object.entries(updates).some(
          ([key, value]) => current[key as keyof Download] !== value
        )
        if (!changed) continue

        if (!next) next = prev.slice()
        next[position] = { ...current, ...updates }
      }
      if (!next) return prev
      rebuildDownloadIndex(next)
      return next
    })
  }, [rebuildDownloadIndex])

  const queueProgressUpdate = useCallback(
    (id: string, updates: Partial<Download>, immediate = false) => {
      const existing = pendingRef.current.get(id) ?? {}
      pendingRef.current.set(id, { ...existing, ...updates })
      if (immediate) {
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current)
          flushTimerRef.current = null
        }
        flushPending()
        return
      }
      if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(flushPending, PROGRESS_FLUSH_MS)
      }
    },
    [flushPending]
  )

  const removeDownload = useCallback((id: string) => {
    pendingRef.current.delete(id)
    setDownloads((prev) => {
      const next = prev.filter((d) => d.id !== id)
      if (next.length !== prev.length) rebuildDownloadIndex(next)
      return next
    })
  }, [rebuildDownloadIndex])

  const removeDownloads = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    const drop = new Set(ids)
    for (const id of drop) pendingRef.current.delete(id)
    setDownloads((prev) => {
      const next = prev.filter((d) => !drop.has(d.id))
      if (next.length !== prev.length) rebuildDownloadIndex(next)
      return next
    })
  }, [rebuildDownloadIndex])

  const updateDownload = useCallback((id: string, updates: Partial<Download>) => {
    queueProgressUpdate(id, updates, true)
  }, [queueProgressUpdate])

  const refreshDownloads = useCallback(async () => {
    if (typeof window === 'undefined' || !window.api) return
    if (refreshPromiseRef.current) return refreshPromiseRef.current
    const refresh = (async () => {
      try {
        const res = await window.api.getDownloads()
        const data = (res as { data?: unknown[] })?.data ?? res
        pendingRef.current.clear()
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current)
          flushTimerRef.current = null
        }
        const next = Array.isArray(data) ? normalizeTasks(data) : []
        rebuildDownloadIndex(next)
        setDownloads(next)
      } catch {
        /* Keep the current queue visible when a transient IPC refresh fails. */
      } finally {
        refreshPromiseRef.current = null
      }
    })()
    refreshPromiseRef.current = refresh
    return refresh
  }, [rebuildDownloadIndex])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.api) return

    void refreshDownloads()

    const unsubProgress = window.api.onDownloadProgress((data) => {
      if (data?.cleared || data?.bulkAdded || data?.bulkRemoved) {
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current)
          flushTimerRef.current = null
        }
        pendingRef.current.clear()
        void refreshDownloads()
        return
      }
      const id = data?.id as string | undefined
      if (id) {
        const status = data.status as DownloadStatus | undefined
        const terminal =
          status === 'complete' ||
          status === 'resolving' ||
          status === 'ready' ||
          status === 'error' ||
          status === 'cancelled' ||
          status === 'paused' ||
          status === 'interrupted'
        queueProgressUpdate(id, progressPatchFromIpc(data as Record<string, unknown>), terminal)
      }
    })

    const unsubNew = window.api.onNewDownload((data) => {
      if (data && typeof data === 'object') {
        const nextTask = normalizeTask(data)
        setDownloads((prev) => {
          if (prev.some((download) => download.id === nextTask.id)) return prev
          const next = [nextTask, ...prev]
          rebuildDownloadIndex(next)
          return next
        })
      }
    })

    return () => {
      unsubProgress()
      unsubNew()
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      pendingRef.current.clear()
    }
  }, [queueProgressUpdate, rebuildDownloadIndex, refreshDownloads])

  // IPC events are best-effort while the renderer is being hot-reloaded or
  // resumed from sleep. Resolver rows are durable in SQLite, so keep a small
  // reconciliation loop only while one is in a non-download state. This also
  // guarantees a timed-out background resolver cannot remain visually stuck as
  // “Resolving…” after its terminal DB update.
  useEffect(() => {
    if (!downloads.some((download) => download.status === 'resolving' || download.status === 'ready')) return
    const timer = setInterval(() => {
      void refreshDownloads()
    }, 2_000)
    return () => clearInterval(timer)
  }, [downloads, refreshDownloads])

  return { downloads, removeDownload, removeDownloads, updateDownload, refreshDownloads }
}
