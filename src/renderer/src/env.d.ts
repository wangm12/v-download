/// <reference types="vite/client" />
import type { StartDownloadOptions } from '@v-download/shared'
import type { EngineStatus, NativeAuthAccountStatus, NativeAuthEvent } from '@/types'

type TranscodePresetId = 'mp3' | 'aac' | 'opus' | 'flac' | 'wav' | 'mp4' | 'h265' | 'vp9'

interface TranscodeProgressEvent {
  id: string
  preset: TranscodePresetId
  status: 'started' | 'progress' | 'complete' | 'error'
  percent: number
  phase?: 'transcoding' | 'complete'
  filePath?: string
  error?: string
}

interface WindowApi {
  startInfoResolve: (options: {
    url: string
    title?: string
    format?: string
    quality?: string
    metadata?: Record<string, unknown>
    referer?: string
    customHeaders?: Record<string, string>
  }) => Promise<{ data?: unknown; error?: string }>
  getInfoResolveResults: () => Promise<{ data?: Array<{ id: string; url: string; autoStart: boolean; format?: string; quality?: string; requestedTitle?: string; data?: unknown; error?: string }>; error?: string }>
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
  clearDownloads: (mode: 'all' | 'completed') => Promise<{ ok: boolean }>
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
  onInfoResolveResult: (callback: (data: { id: string; url: string; autoStart: boolean; format?: string; quality?: string; requestedTitle?: string; data?: unknown; error?: string }) => void) => () => void
  onYtdlUrl: (callback: (url: string) => void) => () => void
  onSettingsChanged: (callback: () => void) => () => void
  onCookiesSynced: (callback: (data: { count: number }) => void) => () => void
  startDouyinBulk: (url: string) => Promise<{ data?: { id: string }; error?: string }>
  getDouyinBulkStatus: (id: string) => Promise<{ data?: DouyinBulkJobStatus; error?: string }>
  cancelDouyinBulk: (id: string) => Promise<{ ok: boolean; error?: string }>
  selectDownloadFolder: () => Promise<string | undefined>
  readClipboard: () => Promise<string>
  openSettings: () => Promise<void>
  onOpenPreferences: (callback: () => void) => () => void
  onFocusDownloadSearch: (callback: () => void) => () => void
  onRefreshDownloads: (callback: () => void) => () => void
  getChromeExtensionPath?: () => Promise<{ ok: boolean; path?: string }>
  installChromeExtension?: () => Promise<{
    ok: boolean
    path?: string
    openedFolder?: boolean
    openedChrome?: boolean
    error?: string
  }>
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
  setNativeThemeSource?: (source: 'dark' | 'light' | 'system') => Promise<{ ok: boolean; error?: string }>
  getAppVersion?: () => Promise<string>
  getEngineStatus?: () => Promise<{ data?: EngineStatus[]; error?: string }>
  checkEngineUpdates?: () => Promise<{ data?: EngineStatus[]; error?: string }>
  updateEngine?: (name: 'yt-dlp' | 'ffmpeg') => Promise<{ data?: EngineStatus[]; error?: string }>
  getNativeAuthAccounts?: () => Promise<{ data?: NativeAuthAccountStatus[]; error?: string }>
  startNativeAuth?: (site: string) => Promise<{ ok: boolean; error?: string }>
  clearNativeAuth?: (site: string) => Promise<{ ok: boolean; error?: string }>
  onNativeAuthEvent?: (callback: (data: NativeAuthEvent) => void) => () => void
  platform: string
}

declare global {
  interface Window {
    api: WindowApi
  }
}

export {}
