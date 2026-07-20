import { useState, useEffect, useRef } from 'react'
import { X, Download, Music, Video, File, Folder } from 'lucide-react'
import type { VideoInfo, SettingsData } from '@/types'
import { formatDuration, formatViews } from '@/utils/format'
import { isDouyinProfileHomeUrl } from '@/utils/douyinBulk'
import { HoverHintWrap } from './HoverHintWrap'
import { ThumbnailImage } from './ThumbnailImage'
import { fallbackQuality, formatAccessibleDownloadLabel, getPresentationCandidates, hasOtherFormats } from './formatDialogPresentation'

interface FormatDialogProps {
  videoInfo: VideoInfo
  settings: SettingsData
  onClose: () => void
  onDownload: (url: string, format: string, quality: string) => void
  queueCount?: number
  onSkipAll?: () => void
  /** Opens Preferences → Downloads and prefills the bulk URL field (Douyin profile flows). */
  onOpenPreferencesForDouyinBulk?: (homepageUrl: string) => void
  siteRule?: { format: 'best' | 'video' | 'audio'; quality: string }
}

type TabType = 'audio' | 'video' | 'other'

export function FormatDialog({
  videoInfo,
  settings,
  onClose,
  onDownload,
  queueCount = 0,
  onSkipAll,
  onOpenPreferencesForDouyinBulk,
  siteRule
}: FormatDialogProps) {
  const [activeTab, setActiveTab] = useState<TabType>(siteRule?.format === 'audio' ? 'audio' : 'video')
  const [downloadDir, setDownloadDir] = useState(settings.downloadDir)
  const [bulkNote, setBulkNote] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [queuedKeys, setQueuedKeys] = useState<Set<string>>(new Set())
  const dialogRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button, input, select, [href], [tabindex]')].filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1)
      if (!focusable.length) return
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); openerRef.current?.focus() }
  }, [onClose])
  const videoFormats = getPresentationCandidates(videoInfo.formats, 'video', settings.defaultVideoQuality, siteRule)
  const audioFormats = getPresentationCandidates(videoInfo.formats, 'audio', settings.defaultAudioQuality, siteRule)
  const formatSize = (bytes?: number, approximate = false) => {
    if (!bytes || bytes <= 0) return 'Size unknown'
    const value = bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(2)} GB` : `${(bytes / 1048576).toFixed(1)} MB`
    return `${approximate ? '≈ ' : ''}${value}`
  }
  const candidateMeta = (f: NonNullable<VideoInfo['formats']>[number], audio: boolean) => {
    const exact = f.filesize && f.filesize > 0
    const size = formatSize(exact ? f.filesize : f.filesize_approx, !exact && Boolean(f.filesize_approx))
    return [`Source ${(f.container || f.ext || 'stream').toUpperCase()}`, audio ? `${Math.round(f.abr ?? f.bitrate ?? f.tbr ?? 0)} kbps` : (f.width && f.height ? `${f.width}×${f.height}` : f.height ? `${f.height}p` : ''), f.vcodec && f.vcodec !== 'none' ? f.vcodec : '', f.acodec && f.acodec !== 'none' ? f.acodec : '', size].filter(Boolean).join(' · ')
  }
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

  const handleDownload = (format: string, quality: number, key: string) => {
    if (queuedKeys.has(key)) return
    const url = videoInfo.webpage_url || `https://www.youtube.com/watch?v=${videoInfo.id}`
    onDownload(url, format, String(quality))
    setQueuedKeys((previous) => new Set(previous).add(key))
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
    ...(hasOtherFormats(videoInfo.formats) ? [{ id: 'other' as const, label: 'Other', icon: File }] : [])
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3" role="presentation">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="format-dialog-title" className="w-full max-w-[520px] max-h-[calc(100vh-24px)] bg-background rounded-xl overflow-hidden shadow-2xl flex flex-col outline-none">
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
            <p id="format-dialog-title" className="text-sm font-semibold text-foreground truncate">
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
          <div className="flex bg-surface px-5 h-10 items-center gap-0" role="tablist" aria-label="Format type">
            {tabs.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  id={`format-tab-${tab.id}`}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`format-panel-${tab.id}`}
                  tabIndex={isActive ? 0 : -1}
                  type="button"
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
        <div
          id={isImageGallery ? 'format-gallery-panel' : `format-panel-${activeTab}`}
          {...(isImageGallery ? { role: 'region' as const, 'aria-labelledby': 'format-dialog-title' } : { role: 'tabpanel' as const, 'aria-labelledby': `format-tab-${activeTab}` })}
          className="px-5 max-h-[min(300px,45vh)] overflow-y-auto min-h-0"
        >
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
                  type="button"
                  onClick={() => handleDownload('video', Number(settings.defaultVideoQuality || '1080'), 'gallery')}
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
                <span className="w-[160px] text-[11px] font-semibold text-muted-foreground">Quality</span>
                <span className="w-[100px] text-[11px] font-semibold text-muted-foreground">Details</span>
                <span className="flex-1 text-[11px] font-semibold text-muted-foreground text-right">Action</span>
              </div>
              <div className="h-px bg-border" />

              {activeTab === 'video' && (videoFormats.length ? videoFormats : [{ format_id: 'best', quality: fallbackQuality('video', settings.defaultVideoQuality || '1080', siteRule), kind: 'video' as const, ext: 'auto', key: 'best', recommended: true }]).map((fmt, index) => (
                  <div key={fmt.key || `${fmt.format_id || fmt.format || 'candidate'}-${index}`}>
                    <div className="flex flex-wrap items-center gap-2 min-h-11 px-3 py-2">
                      <span className="min-w-0 flex-1 text-[13px] font-medium text-foreground"><span className="block">{fmt.quality}p · MP4</span><span className="block text-[11px] text-subtle-foreground">{fmt.kind === 'video' ? candidateMeta(fmt, false) : 'Best available'}</span></span>
                      <div className="flex-1 flex justify-end items-center gap-2">
                        {fmt.recommended ? <span className="text-[10px] font-semibold text-foreground" aria-label="Recommended format">★ Recommended</span> : null}
                        <button
                          type="button"
                          onClick={() => handleDownload('mp4', fmt.quality, fmt.key)}
                          disabled={queuedKeys.has(fmt.key)}
                          aria-label={formatAccessibleDownloadLabel(fmt, 'MP4')}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-action text-action-fg text-xs font-semibold hover:bg-action-hover transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                        >
                          <Download size={13} />
                          <span aria-live="polite">{queuedKeys.has(fmt.key) ? 'Added' : 'Download'}</span>
                        </button>
                      </div>
                    </div>
                    <div className="h-px bg-border" />
                  </div>
                ))}

              {activeTab === 'audio' && (audioFormats.length ? audioFormats : [{ format_id: 'best-audio', quality: fallbackQuality('audio', settings.defaultAudioQuality || '320', siteRule), kind: 'audio' as const, ext: 'auto', key: 'best-audio', recommended: true }]).map((fmt, index) => (
                  <div key={fmt.key || `${fmt.format_id || fmt.format || 'candidate'}-${index}`}>
                    <div className="flex flex-wrap items-center gap-2 min-h-11 px-3 py-2">
                      <span className="min-w-0 flex-1 text-[13px] font-medium text-foreground"><span className="block">{fmt.quality} kbps · MP3</span><span className="block text-[11px] text-subtle-foreground">{fmt.kind === 'audio' ? candidateMeta(fmt, true) : 'Best available'}</span></span>
                      <div className="flex-1 flex justify-end items-center gap-2">
                        {fmt.recommended ? <span className="text-[10px] font-semibold text-foreground" aria-label="Recommended format">★ Recommended</span> : null}
                        <button
                          type="button"
                          onClick={() => handleDownload('mp3', fmt.quality, fmt.key)}
                          disabled={queuedKeys.has(fmt.key)}
                          aria-label={formatAccessibleDownloadLabel(fmt, 'MP3')}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-action text-action-fg text-xs font-semibold hover:bg-action-hover transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                        >
                          <Download size={13} />
                          <span aria-live="polite">{queuedKeys.has(fmt.key) ? 'Added' : 'Download'}</span>
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
              type="button"
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
