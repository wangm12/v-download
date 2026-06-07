import type { ChildProcess } from 'child_process'

/** Progress snapshot emitted by yt-dlp or ffmpeg download engines. */
export interface DownloadProgress {
  percent: number
  speed: string
  eta: string
  downloaded: string
  total: string
  phase: 'video' | 'audio' | 'merging' | ''
}

/** Subprocess-backed download handle (yt-dlp or ffmpeg). */
export interface DownloadProcess {
  process: ChildProcess
  onProgress: (cb: (progress: DownloadProgress) => void) => void
  cancel: () => void
  getStderr: () => string
  getDestinations: () => string[]
}
