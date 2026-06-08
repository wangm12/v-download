interface StartDownloadOptions {
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
}

interface WindowApi {
  getVideoInfo: (url: string) => Promise<{ data?: unknown; error?: string }>
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
  getDownloads: () => Promise<{ data: unknown[] }>
  resumeAll: () => Promise<{ ok: boolean }>
  pauseAll: () => Promise<{ ok: boolean }>
  clearDownloads: (mode: 'all' | 'completed') => Promise<{ ok: boolean }>
  openFileLocation: (path: string) => Promise<{ ok?: boolean; error?: string }>
  openFile: (path: string) => Promise<{ ok?: boolean; error?: string }>
  getSettings: () => Promise<{ data: unknown }>
  updateSettings: (key: string, value: unknown) => Promise<{ ok: boolean }>
  applyDownloadSpeedMode: (
    mode: 'balanced' | 'turbo' | 'gentle',
    options?: { acknowledgeTurboRisk?: boolean }
  ) => Promise<{ ok: boolean; error?: string }>
  onDownloadProgress: (callback: (data: Record<string, unknown>) => void) => () => void
  onNewDownload: (callback: (data: Record<string, unknown>) => void) => () => void
  onYtdlUrl: (callback: (url: string) => void) => () => void
  onSettingsChanged: (callback: () => void) => () => void
  onCookiesSynced: (callback: (data: { count: number }) => void) => () => void
  selectDownloadFolder: () => Promise<string | undefined>
  readClipboard: () => Promise<string>
  openSettings: () => Promise<void>
  onOpenPreferences: (callback: () => void) => () => void
  closeWindow: () => Promise<void>
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
  sniffMedia?: (url: string) => Promise<{ data?: unknown; error?: string }>
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
  platform: NodeJS.Platform
}

declare global {
  interface Window {
    api: WindowApi
  }
}

export {}
