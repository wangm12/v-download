export {
  type ChromeSyncedCookie,
  type BuildNetscapeCookieFileOptions,
  toNetscapeLine,
  buildNetscapeCookieFile,
} from './netscape-cookies.js'
export { COOKIE_SYNC_DOMAINS, type CookieSyncDomain } from './cookie-sync-domains.js'
export type { DownloadErrorCode, DownloadRecoveryAction } from './download-errors.js'

export type QueueSpeedMode = 'balanced' | 'turbo' | 'gentle'
export interface QueueConcurrencyPolicy {
  individualLimit: number
  collectionLimit: number
  activeCollectionLimit: number
  theoreticalMax: number
}
export function getQueueConcurrencyPolicy(mode: QueueSpeedMode): QueueConcurrencyPolicy {
  const limit = mode === 'gentle' ? 1 : 3
  return { individualLimit: limit, collectionLimit: limit, activeCollectionLimit: limit, theoreticalMax: mode === 'gentle' ? 2 : 12 }
}
import type { DownloadErrorCode } from './download-errors.js'
export const DOWNLOAD_ERROR_ACTIONS: Record<DownloadErrorCode, 'retry' | 'sync-cookies' | 'open-source' | 'open-settings'> = {
  ENGINE_MISSING: 'open-settings', PO_TOKEN_REQUIRED: 'retry', AUTH_REQUIRED: 'sync-cookies',
  BROWSER_REQUIRED: 'sync-cookies', NETWORK_RETRYABLE: 'retry', STORAGE_UNAVAILABLE: 'open-settings', UNSUPPORTED: 'open-source', DRM_PROTECTED: 'open-source'
}

export type AppResult<T> = { data: T; error?: never } | { data?: never; error: string }

export type MediaCandidate = {
  id?: string
  formatId?: string
  url: string
  pageUrl?: string
  source?: 'yt-dlp' | 'ffmpeg' | 'sniffer' | 'extension'
  format?: string
  quality?: string
  type?: string
  mimeType?: string
  width?: number
  height?: number
  bitrate?: number
  container?: string
  codec?: string
  fileSize?: number
  approximateSize?: number
  protocol?: 'http' | 'https' | 'hls' | 'dash' | 'file' | 'unknown'
  hasAudio?: boolean
  hasVideo?: boolean
  confidence?: number
  headers?: Record<string, string>
}

export interface StartDownloadOptions {
  url: string
  title: string
  format: string
  quality?: string
  outputDir?: string
  thumbnail?: string
  duration?: number
  metadata?: Record<string, unknown>
  playlistId?: string
  playlistIndex?: number
  isPlaylist?: boolean
  playlistTitle?: string
  mediaType?: string
  referer?: string
  customHeaders?: Record<string, string>
  candidates?: MediaCandidate[]
}

export type DownloadStatus = 'queued' | 'downloading' | 'complete' | 'error' | 'interrupted' | 'cancelled' | 'paused'

export interface DownloadTask {
  id: string
  url: string
  title: string
  format: string
  quality: string
  status: DownloadStatus
  progress: number
  filePath: string | null
  thumbnail: string | null
  duration: number | null
  metadata: Record<string, unknown>
  playlistId: string | null
  playlistIndex: number | null
  error: string | null
  errorCode?: import('./download-errors.js').DownloadErrorCode | null
  createdAt: string
  updatedAt: string
}

export interface DownloadRequest {
  url: string
  type?: string
  referer?: string
  headers?: Record<string, string>
  title?: string
  candidates?: MediaCandidate[]
}
