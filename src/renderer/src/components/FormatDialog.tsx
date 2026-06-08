import { useState } from 'react'
import { X, Download, Music, Video, File, Folder } from 'lucide-react'
import type { VideoInfo, SettingsData } from '@/types'
import { formatDuration, formatViews } from '@/utils/format'
import { isDouyinProfileHomeUrl } from '@/utils/douyinBulk'
import { HoverHintWrap } from './HoverHintWrap'
import { ThumbnailImage } from './ThumbnailImage'

interface FormatDialogProps {
  videoInfo: VideoInfo
  settings: SettingsData
  onClose: () => void
  onDownload: (url: string, format: string, quality: string) => void
  queueCount?: number
  onSkipAll?: () => void
  /** Opens Preferences → Downloads and prefills the bulk URL field (Douyin profile flows). */
  onOpenPreferencesForDouyinBulk?: (homepageUrl: string) => void
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

export function FormatDialog({
  videoInfo,
  settings,
  onClose,
  onDownload,
  queueCount = 0,
  onSkipAll,
  onOpenPreferencesForDouyinBulk
}: FormatDialogProps) {
  const [activeTab, setActiveTab] = useState<TabType>('video')
  const [downloadDir, setDownloadDir] = useState(settings.downloadDir)
  const [bulkNote, setBulkNote] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const isImageGallery =
    (videoInfo._type === 'douyin_gallery' || videoInfo._type === 'xhs_gallery') &&
    Array.isArray(videoInfo.image_urls)
  const galleryCount = isImageGallery ? videoInfo.image_urls!.length : 0
  const galleryLabel = videoInfo._type === 'xhs_gallery' ? 'Xiaohongshu' : 'Douyin'
  const pageUrl = videoInfo.webpage_url || ''
  const showDouyinBulkHint = !isImageGallery && isDouyinProfileHomeUrl(pageUrl)
  const bulkConfigured = Boolean(
    (settings.douyinBulkRunPyPath ?? '').trim() && (settings.douyinBulkConfigPath ?? '').trim()
  )

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

  const handleStartDouyinBulkFromDialog = async () => {
    const url = pageUrl.trim()
    if (!url || !window.api?.startDouyinBulk || bulkBusy) return
    setBulkBusy(true)
    setBulkNote('')
    try {
      const result = await window.api.startDouyinBulk(url)
      if (result.error) {
        setBulkNote(result.error)
        return
      }
      const id = result.data?.id
      setBulkNote(id ? `Bulk job started (${id}). Open Preferences → Downloads for status.` : 'Bulk job started. Open Preferences → Downloads for status.')
    } catch (err) {
      setBulkNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBulkBusy(false)
    }
  }

  const handleOpenBulkPreferences = () => {
    const url = pageUrl.trim()
    if (!url || !onOpenPreferencesForDouyinBulk) return
    onOpenPreferencesForDouyinBulk(url)
  }

  const tabs: { id: TabType; label: string; icon: typeof Music }[] = [
    { id: 'audio', label: 'Audio', icon: Music },
    { id: 'video', label: 'Video', icon: Video },
    { id: 'other', label: 'Other', icon: File }
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[520px] bg-background rounded-xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-elevated p-5 flex gap-3 items-center relative">
          <HoverHintWrap text="Close" side="bottom" className="absolute top-3 right-3">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-control transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              <X size={16} aria-hidden />
            </button>
          </HoverHintWrap>
          <div className="w-20 h-[45px] rounded-md overflow-hidden bg-surface flex-shrink-0">
            <ThumbnailImage src={videoInfo.thumbnail} referer={pageUrl || undefined} />
          </div>
          <div className="min-w-0 pr-6">
            <p className="text-sm font-semibold text-foreground truncate">
              {videoInfo.playlist_count
                ? (videoInfo.playlist_title || videoInfo.title)
                : videoInfo.title}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {videoInfo.playlist_count
                ? <>
                    {videoInfo.channel ? `${videoInfo.channel} · ` : ''}
                    {videoInfo.playlist_count} videos
                  </>
                : <>
                    {videoInfo.channel && videoInfo.channel !== videoInfo.title ? videoInfo.channel : ''}
                    {videoInfo.channel && videoInfo.channel !== videoInfo.title && videoInfo.duration > 0 ? ' · ' : ''}
                    {videoInfo.duration > 0 && formatDuration(videoInfo.duration)}
                    {videoInfo.view_count > 0 && ` · ${formatViews(videoInfo.view_count)}`}
                  </>
              }
            </p>
          </div>
        </div>

        {/* Tabs */}
        {!isImageGallery && (
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
                  <Icon size={14} className={isActive ? 'text-foreground' : ''} />
                  {tab.label}
                </button>
              )
            })}
          </div>
        )}

        {/* Table */}
        <div className="px-5 max-h-[300px] overflow-y-auto">
          {isImageGallery ? (
            <div className="py-5 space-y-4">
              <div className="rounded-lg border border-border bg-elevated/40 px-4 py-3">
                <p className="text-sm font-medium text-foreground">{galleryLabel} image gallery</p>
                <p className="text-xs text-muted-foreground mt-1">
                  This post contains {galleryCount} image{galleryCount === 1 ? '' : 's'} and will be saved as numbered files.
                </p>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => handleDownload('video', Number(settings.defaultVideoQuality || '1080'))}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-action text-action-fg text-xs font-semibold hover:bg-action-hover transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                >
                  <Download size={13} />
                  Download images
                </button>
              </div>
            </div>
          ) : (
            <>
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
                      <span className="w-[100px] text-[13px] text-subtle-foreground">Best available</span>
                      <div className="flex-1 flex justify-end">
                        <button
                          onClick={() => handleDownload('mp4', fmt.quality)}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-action text-action-fg text-xs font-semibold hover:bg-action-hover transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
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
                      <span className="w-[100px] text-[13px] text-subtle-foreground">Best available</span>
                      <div className="flex-1 flex justify-end">
                        <button
                          onClick={() => handleDownload('mp3', fmt.quality)}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-action text-action-fg text-xs font-semibold hover:bg-action-hover transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
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
            </>
          )}
        </div>

        {/* Footer */}
        <div className="bg-elevated px-5">
          {showDouyinBulkHint && (
            <div className="border-b border-border py-3 space-y-2">
              <p className="text-xs font-medium text-foreground">Douyin profile URL</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                This page looks like a creator profile. Use the external douyin-downloader for multi-post bulk; single-post queue download uses the buttons above.
              </p>
              <div className="flex flex-wrap gap-2">
                {bulkConfigured ? (
                  <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={() => void handleStartDouyinBulkFromDialog()}
                    className="px-3 py-1.5 rounded-lg bg-action text-action-fg text-xs font-semibold hover:bg-action-hover disabled:opacity-50"
                  >
                    {bulkBusy ? 'Starting…' : 'Bulk download profile'}
                  </button>
                ) : null}
                {onOpenPreferencesForDouyinBulk ? (
                  <button
                    type="button"
                    onClick={handleOpenBulkPreferences}
                    className="px-3 py-1.5 rounded-lg border border-border bg-raised text-xs font-medium text-foreground hover:bg-control"
                  >
                    {bulkConfigured ? 'Open bulk settings' : 'Configure bulk in preferences'}
                  </button>
                ) : null}
              </div>
              {bulkNote ? <p className="text-[11px] text-muted-foreground">{bulkNote}</p> : null}
            </div>
          )}
          <div className="flex items-center gap-2 h-10">
            <Folder size={14} className="text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground truncate">{downloadDir}</span>
            <button
              onClick={handleChangeFolder}
              className="text-[11px] font-medium text-foreground hover:underline flex-shrink-0"
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
                  className="text-[13px] font-medium text-muted-foreground hover:text-foreground hover:underline"
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
