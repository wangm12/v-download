export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'complete'
  | 'error'
  | 'interrupted'
  | 'cancelled'
  | 'paused'

export interface Download {
  id: string
  url: string
  title: string
  format: string
  quality: string
  status: DownloadStatus
  progress: number
  speed: string | null
  eta: string | null
  totalSize: string | null
  phase: string | null
  file_path: string | null
  file_size: number | null
  thumbnail: string | null
  duration: number | null
  channel: string | null
  playlist_id: string | null
  playlist_index: number | null
  error: string | null
  created_at: string
  updated_at: string
}

export interface Playlist {
  id: string
  url: string
  title: string
  type: string
  total_count: number
  completed_count: number
  output_dir: string
  created_at: string
  updated_at: string
  downloads?: Download[]
}

export interface VideoInfo {
  id: string
  title: string
  thumbnail: string
  duration: number
  channel: string
  view_count: number
  webpage_url: string
  _type?: string
  playlist_title?: string
  playlist_count?: number
  /** Douyin / Xiaohongshu image note — passed through format dialog for gallery metadata */
  image_urls?: string[]
}

export interface SettingsData {
  downloadDir: string
  concurrency: number
  showFormatDialog: boolean
  playlistSubfolder: boolean
  defaultVideoQuality: string
  defaultAudioQuality: string
  sleepInterval: number
  cookiesPath?: string
  /** yt-dlp `--cookies-from-browser` value for Douyin (chrome, brave, edge, …). */
  cookiesFromBrowser?: string
  /** Patched Chromium (CloakBrowser) for Douyin page hydration instead of Electron. */
  douyinUseCloakBrowser?: boolean
  /** YouTube list/channel URLs: one yt-dlp job vs one task per video. */
  youtubePlaylistMode?: 'native' | 'fanout'
  youtubePlaylistSleepRequests?: number
  youtubePlaylistMaxDownloads?: number
  /** Path to douyin-downloader `run.py` (optional bulk helper). */
  douyinBulkRunPyPath?: string
  douyinBulkConfigPath?: string
  /** Optional `-p` override for douyin-downloader; empty uses `downloadDir`. */
  douyinBulkOutputPath?: string
  /** `-t` thread count for douyin-downloader (1–32). */
  douyinBulkThreads?: number
  /** Pass `--show-warnings` to the bulk CLI for more stderr detail. */
  douyinBulkVerboseWarnings?: boolean
  ytdlpPath?: string
  ffmpegPath?: string
  /** Engine for sniffed/extension direct URLs (HLS, mp4, …). */
  directMediaEngine?: 'auto' | 'ffmpeg' | 'ytdlp'
  /** yt-dlp `--concurrent-fragments` for fragmented streams (HLS/DASH/ISM) on all yt-dlp jobs when > 1. */
  concurrentFragments?: number
  /** Preset last applied from Preferences (balanced / turbo / gentle). */
  downloadSpeedMode?: 'balanced' | 'turbo' | 'gentle'
  /** User has confirmed the Turbo risk notice at least once. */
  turboRiskAcknowledged?: boolean
  /** Optional yt-dlp `--downloader` name (e.g. aria2c). Empty = built-in. */
  ytdlpExternalDownloader?: string
}

export interface PlaylistEntryRow {
  id: string
  title: string
  channel: string
  thumbnail: string
  duration: number
  pageUrl: string
  playlistIndex?: number
}

export interface PlaylistListResult {
  items: PlaylistEntryRow[]
  playlistTitle: string
  playlistChannel: string
  sourceUrl: string
}

export type DouyinProfileMediaType = 'video' | 'note' | 'gallery'

export interface DouyinProfilePostRow {
  awemeId: string
  mediaType: DouyinProfileMediaType
  title: string
  author: string
  cover: string
  durationSec?: number
  imageCount?: number
  pageUrl: string
}

export type DouyinProfileListErrorCode =
  | 'INVALID_URL'
  | 'COOKIE_REQUIRED'
  | 'ANTI_BOT'
  | 'PRIVATE_OR_EMPTY'
  | 'UNSUPPORTED_LAYOUT'
  | 'TIMEOUT'
  | 'LOAD_MORE_FAILED'
  | 'PAGINATION_RESTRICTED'

export type DouyinProfileListResult =
  | {
      ok: true
      items: DouyinProfilePostRow[]
      cursor: string | null
      hasMore: boolean
      source: 'html' | 'chromium' | 'api' | 'merged' | 'browser_recovery'
      warnings?: string[]
    }
  | {
      ok: false
      code: DouyinProfileListErrorCode
      message: string
    }

export interface DouyinBulkJobStatus {
  id: string
  state: 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: string
  endedAt?: string
  stderrTail: string
}

export interface DownloadActions {
  cancel: (id: string) => void
  pause: (id: string) => void
  retry: (id: string) => void
  remove: (id: string) => void
  removeWithFiles: (id: string) => void
  removeMany: (ids: string[]) => void
  removeManyWithFiles: (ids: string[]) => void
  openFolder: (path: string) => void
  openFile: (path: string) => void
}
