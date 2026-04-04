import { useState } from 'react'
import { X, Download, Music, Video, File, Folder } from 'lucide-react'
import type { VideoInfo, SettingsData } from '@/types'
import { formatDuration, formatViews } from '@/utils/format'

interface FormatDialogProps {
  videoInfo: VideoInfo
  settings: SettingsData
  onClose: () => void
  onDownload: (url: string, format: string, quality: string) => void
  queueCount?: number
  onSkipAll?: () => void
}

const VIDEO_FORMATS = [
  { label: '1080p (.mp4)', quality: 1080 },
  { label: '720p (.mp4)', quality: 720 },
  { label: '360p (.mp4)', quality: 360 },
  { label: '240p (.mp4)', quality: 240 },
  { label: '144p (.mp4)', quality: 144 }
]

const AUDIO_FORMATS = [
  { label: 'MP3 (320kbps)', quality: 320 },
  { label: 'MP3 (128kbps)', quality: 128 }
]

type TabType = 'audio' | 'video' | 'other'

export function FormatDialog({ videoInfo, settings, onClose, onDownload, queueCount = 0, onSkipAll }: FormatDialogProps) {
  const [activeTab, setActiveTab] = useState<TabType>('video')
  const [downloadDir, setDownloadDir] = useState(settings.downloadDir)

  const handleChangeFolder = async () => {
    if (!window.api) return
    const folder = await window.api.selectDownloadFolder()
    if (folder) {
      setDownloadDir(folder)
      await window.api.updateSettings('downloadDir', folder)
    }
  }

  const handleDownload = (format: string, quality: number) => {
    const url = videoInfo.webpage_url || `https://www.youtube.com/watch?v=${videoInfo.id}`
    onDownload(url, format, String(quality))
  }

  const tabs: { id: TabType; label: string; icon: typeof Music }[] = [
    { id: 'audio', label: 'Audio', icon: Music },
    { id: 'video', label: 'Video', icon: Video },
    { id: 'other', label: 'Other', icon: File }
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[520px] bg-background rounded-xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-elevated p-5 flex gap-3 items-center relative">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1 rounded-md hover:bg-border transition-colors"
          >
            <X size={16} className="text-muted-foreground" />
          </button>
          <div className="w-20 h-[45px] rounded-md overflow-hidden bg-surface flex-shrink-0">
            {videoInfo.thumbnail ? (
              <img src={videoInfo.thumbnail} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-r from-accent-indigo to-accent-coral" />
            )}
          </div>
          <div className="min-w-0 pr-6">
            <p className="text-sm font-semibold text-foreground truncate">
              {videoInfo.channel || videoInfo.title}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {videoInfo.playlist_count
                ? `${videoInfo.playlist_count} videos`
                : <>
                    {videoInfo.title !== videoInfo.channel ? videoInfo.title : ''}
                    {videoInfo.duration > 0 && ` · ${formatDuration(videoInfo.duration)}`}
                    {videoInfo.view_count > 0 && ` · ${formatViews(videoInfo.view_count)}`}
                  </>
              }
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex bg-surface px-5 h-10 items-center gap-0">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-5 py-2 text-[13px] transition-colors rounded-t-lg ${
                  isActive
                    ? 'bg-background font-semibold text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon size={14} className={isActive ? 'text-accent-indigo' : ''} />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Table */}
        <div className="px-5 max-h-[300px] overflow-y-auto">
          <div className="flex items-center h-9 px-3">
            <span className="w-[160px] text-[11px] font-semibold text-muted-foreground">File type</span>
            <span className="w-[100px] text-[11px] font-semibold text-muted-foreground">Format</span>
            <span className="flex-1 text-[11px] font-semibold text-muted-foreground text-right">Action</span>
          </div>
          <div className="h-px bg-border" />

          {activeTab === 'video' &&
            VIDEO_FORMATS.map((fmt) => (
              <div key={fmt.quality}>
                <div className="flex items-center h-11 px-3">
                  <span className="w-[160px] text-[13px] font-medium text-foreground">{fmt.label}</span>
                  <span className="w-[100px] text-[13px] text-subtle-foreground">Auto</span>
                  <div className="flex-1 flex justify-end">
                    <button
                      onClick={() => handleDownload('mp4', fmt.quality)}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-accent-indigo text-background text-xs font-semibold hover:bg-accent-indigo-dark transition-all"
                    >
                      <Download size={13} />
                      Download
                    </button>
                  </div>
                </div>
                <div className="h-px bg-border" />
              </div>
            ))}

          {activeTab === 'audio' &&
            AUDIO_FORMATS.map((fmt) => (
              <div key={fmt.quality}>
                <div className="flex items-center h-11 px-3">
                  <span className="w-[160px] text-[13px] font-medium text-foreground">{fmt.label}</span>
                  <span className="w-[100px] text-[13px] text-subtle-foreground">Auto</span>
                  <div className="flex-1 flex justify-end">
                    <button
                      onClick={() => handleDownload('mp3', fmt.quality)}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-accent-indigo text-background text-xs font-semibold hover:bg-accent-indigo-dark transition-all"
                    >
                      <Download size={13} />
                      Download
                    </button>
                  </div>
                </div>
                <div className="h-px bg-border" />
              </div>
            ))}

          {activeTab === 'other' && (
            <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
              No other formats available
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-elevated px-5">
          <div className="flex items-center gap-2 h-10">
            <Folder size={14} className="text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground truncate">{downloadDir}</span>
            <button
              onClick={handleChangeFolder}
              className="text-[11px] font-medium text-accent-indigo hover:underline flex-shrink-0"
            >
              Change
            </button>
          </div>
          {queueCount > 0 && (
            <div className="flex items-center justify-between pb-3 pt-1">
              <span className="text-[13px] font-medium text-foreground">
                +{queueCount} more video{queueCount > 1 ? 's' : ''} queued
              </span>
              {onSkipAll && (
                <button
                  onClick={onSkipAll}
                  className="text-[13px] font-medium text-accent-coral hover:underline"
                >
                  Skip All
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
