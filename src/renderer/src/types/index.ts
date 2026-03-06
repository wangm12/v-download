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
  ytdlpPath?: string
  ffmpegPath?: string
}

export interface DownloadActions {
  cancel: (id: string) => void
  pause: (id: string) => void
  retry: (id: string) => void
  remove: (id: string) => void
  removeWithFiles: (id: string) => void
  openFolder: (path: string) => void
  openFile: (path: string) => void
}
