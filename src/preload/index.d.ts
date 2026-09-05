import type { AppResult, MediaCandidate, StartDownloadOptions } from '@v-download/shared'
export type { AppResult, MediaCandidate, StartDownloadOptions } from '@v-download/shared'

export interface InfoResolveEvent {
  id: string
  url: string
  autoStart: boolean
  format?: string
  quality?: string
  requestedTitle?: string
  data?: unknown
  error?: string
}

export interface EngineStatus {
  name: 'yt-dlp' | 'ffmpeg'
  path: string
  source: 'bundled' | 'custom' | 'system' | 'missing'
  version: string | null
  bundledVersion: string | null
  latestVersion: string | null
  updateState: 'current' | 'available' | 'unknown'
  updateMessage?: string
  canUpdate: boolean
}

export type NativeAuthSite = 'youtube' | 'douyin' | 'tiktok' | 'bilibili' | 'xiaohongshu' | 'x'

export type TranscodePresetId = 'mp3' | 'aac' | 'opus' | 'flac' | 'wav' | 'mp4' | 'h265' | 'vp9'

export interface TranscodeProgressEvent {
  id: string
  preset: TranscodePresetId
  status: 'started' | 'progress' | 'complete' | 'error'
  percent: number
  phase?: 'transcoding' | 'complete'
  filePath?: string
  error?: string
}

export interface NativeAuthAccountStatus {
  site: NativeAuthSite
  host: string
  connected: boolean
  cookieCount: number
  lastSyncedAt: string | null
}

export type NativeAuthEvent =
  | { type: 'opened'; site: NativeAuthSite }
  | { type: 'saved'; site: NativeAuthSite; account: NativeAuthAccountStatus }
  | { type: 'error'; site: NativeAuthSite; message: string }

export interface DouyinBulkJobStatus {
  id: string
  state: 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: string
  endedAt?: string
  stderrTail: string
}

export interface WindowApi {
  startInfoResolve: (options: {
    url: string
    title?: string
    format?: string
    quality?: string
    metadata?: Record<string, unknown>
    referer?: string
    customHeaders?: Record<string, string>
  }) => Promise<{ data?: unknown; error?: string }>
  getInfoResolveResults: () => Promise<{ data?: InfoResolveEvent[]; error?: string }>
  promoteInfoResolve: (options: {
    id: string
    url?: string
    title?: string
    format: string
    quality?: string
    thumbnail?: string
    duration?: number
    metadata?: Record<string, unknown>
    mediaType?: string
    referer?: string
    customHeaders?: Record<string, string>
  }) => Promise<{ data?: unknown; error?: string }>
  markInfoResolveReady: (options: { id: string; title?: string; thumbnail?: string | null; duration?: number | null }) => Promise<{ ok: boolean; error?: string }>
  listPlaylistEntries: (url: string) => Promise<{ data?: unknown; error?: string }>
  getEntryThumbnail: (pageUrl: string) => Promise<{ data?: string; error?: string }>
  openExternalUrl: (url: string) => Promise<{ ok?: boolean; error?: string }>
  fetchThumbnailDataUrl: (url: string, referer?: string) => Promise<{ data?: string; error?: string }>
  startDownload: (options: StartDownloadOptions) => Promise<{ data?: unknown; error?: string }>
  cancelDownload: (id: string) => Promise<{ cancelled: boolean }>
  pauseDownload: (id: string) => Promise<{ paused: boolean }>
  deleteTask: (id: string) => Promise<{ ok: boolean }>
  deleteTaskWithFiles: (id: string) => Promise<{ ok: boolean }>
  deleteTasksWithFiles: (ids: string[]) => Promise<{ ok: boolean; removed: number }>
  deleteTasks: (ids: string[]) => Promise<{ ok: boolean; removed: number }>
  retryDownload: (id: string) => Promise<{ retried: boolean }>
  transcodeDownload: (id: string, preset: TranscodePresetId) => Promise<{ data?: unknown; error?: string }>
  getDownloads: () => Promise<{ data: unknown[] }>
  resumeAll: () => Promise<{ ok: boolean }>
  pauseAll: () => Promise<{ ok: boolean }>
  clearDownloads: (mode: string) => Promise<{ ok: boolean }>
  openFileLocation: (path: string) => Promise<{ ok?: boolean; error?: string }>
  openFile: (path: string) => Promise<{ ok?: boolean; error?: string }>
  getSettings: () => Promise<{ data: unknown }>
  updateSettings: (key: string, value: unknown) => Promise<{ ok: boolean; error?: string }>
  getRemoteMcpLogs: (limit?: number) => Promise<{ data: Array<{
    timestamp: string
    tool: string
    category: string
    argumentSummary: string
    success: boolean
    elapsedMs: number
    errorCode?: string | null
    message: string
  }> }>
  applyDownloadSpeedMode: (
    mode: 'balanced' | 'turbo' | 'gentle',
    options?: { acknowledgeTurboRisk?: boolean }
  ) => Promise<{ ok: boolean; error?: string }>
  onDownloadProgress: (callback: (data: Record<string, unknown>) => void) => () => void
  onTranscodeProgress: (callback: (data: TranscodeProgressEvent) => void) => () => void
  onNewDownload: (callback: (data: Record<string, unknown>) => void) => () => void
  onInfoResolveResult: (callback: (data: InfoResolveEvent) => void) => () => void
  onYtdlUrl: (callback: (url: string) => void) => () => void
  onSettingsChanged: (callback: () => void) => () => void
  selectDownloadFolder: () => Promise<string | undefined>
  readClipboard: () => Promise<string>
  getChromeExtensionPath: () => Promise<{ ok: boolean; path?: string }>
  installChromeExtension: () => Promise<{
    ok: boolean
    path?: string
    openedFolder?: boolean
    openedChrome?: boolean
    error?: string
  }>
  openSettings: () => Promise<void>
  onOpenPreferences: (callback: () => void) => () => void
  onFocusDownloadSearch: (callback: () => void) => () => void
  onRefreshDownloads: (callback: () => void) => () => void
  onOpenUrls: (callback: () => void) => () => void
  onOpenClearDownloads: (callback: () => void) => () => void
  onCookiesSynced?: (callback: (data: { count: number }) => void) => () => void
  requestBrowserCookieSync?: () => Promise<{
    ok: boolean
    openedBrowser?: boolean
    landingUrl?: string
    message?: string
    error?: string
  }>
  openDouyinProfileUrl?: (profileUrl: string) => Promise<{
    ok: boolean
    openedIn?: string
    url?: string
    error?: string
  }>
  setNativeThemeSource: (source: 'dark' | 'light' | 'system') => Promise<{ ok: boolean; error?: string }>
  getAppVersion: () => Promise<string>
  getEngineStatus?: () => Promise<{ data?: EngineStatus[]; error?: string }>
  checkEngineUpdates?: () => Promise<{ data?: EngineStatus[]; error?: string }>
  updateEngine?: (name: 'yt-dlp' | 'ffmpeg') => Promise<{ data?: EngineStatus[]; error?: string }>
  getNativeAuthAccounts?: () => Promise<{ data?: NativeAuthAccountStatus[]; error?: string }>
  startNativeAuth?: (site: string) => Promise<{ ok: boolean; error?: string }>
  clearNativeAuth?: (site: string) => Promise<{ ok: boolean; error?: string }>
  onNativeAuthEvent?: (callback: (data: NativeAuthEvent) => void) => () => void
  getUpdateStatus: () => Promise<{ state: 'disabled' | 'idle' | 'checking' | 'available' | 'downloaded' | 'error'; version?: string; error?: string }>
  onUpdateStatus: (callback: (data: unknown) => void) => () => void
  douyinProfileListPosts?: (
    profileUrl: string,
    cursor?: string | null,
    limit?: number,
    firstPageMode?: 'merged' | 'api_quick' | 'html_only',
    options?: { existingAwemeIds?: string[]; abortKey?: string; browserRecovery?: boolean }
  ) => Promise<{ data?: unknown; error?: string }>
  douyinProfileListPostsAbort?: (abortKey: string) => Promise<{ ok: boolean }>
  startDownloadsBulk?: (
    tasks: Array<{
      url: string
      title: string
      format?: string
      quality?: string
      thumbnail?: string
      duration?: number
      metadata?: Record<string, unknown>
      playlistId?: string
      playlistIndex?: number
      playlistTitle?: string
    }>
  ) => Promise<{ data?: { count: number; ids: string[] }; error?: string }>
  startDouyinBulk?: (url: string) => Promise<{ data?: { id: string }; error?: string }>
  getDouyinBulkStatus?: (id: string) => Promise<{ data?: DouyinBulkJobStatus; error?: string }>
  cancelDouyinBulk?: (id: string) => Promise<{ ok: boolean; error?: string }>
  platform: NodeJS.Platform
}

declare global {
  interface Window {
    api: WindowApi
  }
}
