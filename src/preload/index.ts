import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getVideoInfo: (url: string) => ipcRenderer.invoke('get-video-info', url),
  startDownload: (options: {
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
  }) => ipcRenderer.invoke('start-download', options),
  cancelDownload: (id: string) => ipcRenderer.invoke('cancel-download', id),
  pauseDownload: (id: string) => ipcRenderer.invoke('pause-download', id),
  deleteTask: (id: string) => ipcRenderer.invoke('delete-task', id),
  deleteTaskWithFiles: (id: string) => ipcRenderer.invoke('delete-task-with-files', id),
  deleteTasksWithFiles: (ids: string[]) => ipcRenderer.invoke('delete-tasks-with-files', ids),
  deleteTasks: (ids: string[]) => ipcRenderer.invoke('delete-tasks', ids),
  retryDownload: (id: string) => ipcRenderer.invoke('retry-download', id),
  getDownloads: () => ipcRenderer.invoke('get-downloads'),
  resumeAll: () => ipcRenderer.invoke('resume-all'),
  pauseAll: () => ipcRenderer.invoke('pause-all'),
  clearDownloads: (mode: string) => ipcRenderer.invoke('clear-downloads', mode),
  openFileLocation: (path: string) => ipcRenderer.invoke('open-file-location', path),
  openFile: (path: string) => ipcRenderer.invoke('open-file', path),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (key: string, value: unknown) => ipcRenderer.invoke('update-settings', key, value),
  applyDownloadSpeedMode: (
    mode: 'balanced' | 'turbo' | 'gentle',
    options?: { acknowledgeTurboRisk?: boolean }
  ) => ipcRenderer.invoke('apply-download-speed-mode', mode, options ?? {}),
  onDownloadProgress: (callback: (data: unknown) => void) => {
    const sub = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('download-progress', sub)
    return () => ipcRenderer.removeListener('download-progress', sub)
  },
  onNewDownload: (callback: (data: unknown) => void) => {
    const sub = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('new-download', sub)
    return () => ipcRenderer.removeListener('new-download', sub)
  },
  selectDownloadFolder: () => ipcRenderer.invoke('select-download-folder'),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  onOpenPreferences: (callback: () => void) => {
    const sub = () => callback()
    ipcRenderer.on('open-preferences', sub)
    return () => ipcRenderer.removeListener('open-preferences', sub)
  },
  closeWindow: () => ipcRenderer.invoke('close-window'),
  onSettingsChanged: (callback: () => void) => {
    const sub = () => callback()
    ipcRenderer.on('settings-changed', sub)
    return () => ipcRenderer.removeListener('settings-changed', sub)
  },
  onCookiesSynced: (callback: (data: { count: number }) => void) => {
    const sub = (_event: Electron.IpcRendererEvent, data: { count: number }) => callback(data)
    ipcRenderer.on('cookies-synced', sub)
    return () => ipcRenderer.removeListener('cookies-synced', sub)
  },
  onYtdlUrl: (callback: (url: string) => void) => {
    const sub = (_event: Electron.IpcRendererEvent, url: string) => callback(url)
    ipcRenderer.on('ytdl-url', sub)
    return () => ipcRenderer.removeListener('ytdl-url', sub)
  },
  sniffMedia: (url: string) => ipcRenderer.invoke('sniff-media', url),
  douyinProfileListPosts: (
    profileUrl: string,
    cursor?: string | null,
    limit?: number,
    firstPageMode?: 'merged' | 'api_quick' | 'html_only',
    options?: { existingAwemeIds?: string[]; abortKey?: string; browserRecovery?: boolean }
  ) =>
    ipcRenderer.invoke('douyin-profile-list-posts', {
      profileUrl,
      cursor: cursor ?? null,
      limit,
      firstPageMode,
      existingAwemeIds: options?.existingAwemeIds,
      abortKey: options?.abortKey,
      browserRecovery: options?.browserRecovery === true,
    }),
  douyinProfileListPostsAbort: (abortKey: string) =>
    ipcRenderer.invoke('douyin-profile-list-posts-abort', abortKey),
  startDownloadsBulk: (
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
  ) => ipcRenderer.invoke('start-downloads-bulk', tasks),
  startDouyinBulk: (url: string) => ipcRenderer.invoke('start-douyin-bulk', url),
  getDouyinBulkStatus: (id: string) => ipcRenderer.invoke('get-douyin-bulk-status', id),
  cancelDouyinBulk: (id: string) => ipcRenderer.invoke('cancel-douyin-bulk', id),
  runDouyinBulk: (url: string) => ipcRenderer.invoke('run-douyin-bulk', url),
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  installChromeExtension: () => ipcRenderer.invoke('install-chrome-extension'),
  requestBrowserCookieSync: () => ipcRenderer.invoke('request-browser-cookie-sync'),
  openDouyinProfileUrl: (profileUrl: string) =>
    ipcRenderer.invoke('open-douyin-profile-url', profileUrl),
  setNativeThemeSource: (source: 'dark' | 'light' | 'system') =>
    ipcRenderer.invoke('set-native-theme-source', source),
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)
