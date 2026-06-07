export interface DouyinDownloadProgress {
  percent: number
  speed?: string
  eta?: string
}

/** Track bytes over time and emit percent + speed + ETA for direct media downloads. */
export function createDouyinDownloadProgressReporter(
  contentLength: number,
  onProgress?: (p: DouyinDownloadProgress) => void
): { addBytes: (n: number) => void } {
  let downloaded = 0
  let lastTick = Date.now()
  let lastDownloaded = 0
  let lastSpeed = ''
  let lastEta = ''

  const formatSpeed = (bps: number): string => {
    if (bps >= 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(2)}MiB/s`
    if (bps >= 1024) return `${(bps / 1024).toFixed(1)}KiB/s`
    return `${Math.round(bps)}B/s`
  }

  const formatEta = (sec: number): string => {
    const s = Math.max(0, Math.round(sec))
    const m = Math.floor(s / 60)
    const r = s % 60
    return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `0:${String(r).padStart(2, '0')}`
  }

  return {
    addBytes(n: number) {
      if (!onProgress) return
      downloaded += n
      const now = Date.now()
      const elapsed = (now - lastTick) / 1000
      if (elapsed >= 0.35) {
        const bps = (downloaded - lastDownloaded) / elapsed
        lastTick = now
        lastDownloaded = downloaded
        if (bps > 0) {
          lastSpeed = formatSpeed(bps)
          if (contentLength > 0) {
            const remaining = contentLength - downloaded
            if (remaining > 0) lastEta = formatEta(remaining / bps)
          }
        }
      }
      const percent =
        contentLength > 0
          ? Math.min(100, (downloaded / contentLength) * 100)
          : downloaded > 0
            ? 1
            : 0
      onProgress({
        percent,
        speed: lastSpeed || undefined,
        eta: lastEta || undefined,
      })
    },
  }
}
