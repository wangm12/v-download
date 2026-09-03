import { useState, useEffect, useRef } from 'react'
import { X, Download, Music, Video, File, Folder } from 'lucide-react'
import type { VideoInfo, SettingsData } from '@/types'
import { formatDuration, formatViews } from '@/utils/format'
import { isDouyinProfileHomeUrl } from '@/utils/douyinBulk'
import { HoverHintWrap } from './HoverHintWrap'
import { ThumbnailImage } from './ThumbnailImage'
import { fallbackQuality, formatAccessibleDownloadLabel, getDefaultSelectedKey, getPresentationCandidates, hasOtherFormats } from './formatDialogPresentation'

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
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
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
  const videoFormatsRaw = getPresentationCandidates(videoInfo.formats, 'video', settings.defaultVideoQuality, siteRule)
  const audioFormatsRaw = getPresentationCandidates(videoInfo.formats, 'audio', settings.defaultAudioQuality, siteRule)
  const videoFormats = videoFormatsRaw.length
    ? videoFormatsRaw
    : [{ format_id: 'best', quality: fallbackQuality('video', settings.defaultVideoQuality || '1080', siteRule), kind: 'video' as const, ext: 'auto', key: 'best', recommended: true }]
  const audioFormats = audioFormatsRaw.length
    ? audioFormatsRaw
    : [{ format_id: 'best-audio', quality: fallbackQuality('audio', settings.defaultAudioQuality || '320', siteRule), kind: 'audio' as const, ext: 'auto', key: 'best-audio', recommended: true }]
  const activeFormats = activeTab === 'audio' ? audioFormats : videoFormats
  const resolvedSelectedKey = selectedKey && activeFormats.some((item) => item.key === selectedKey)
    ? selectedKey
    : getDefaultSelectedKey(activeFormats)
  const selectedFormat = activeFormats.find((item) => item.key === resolvedSelectedKey) ?? activeFormats[0]
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
  const isTextNote = videoInfo._type === 'text'
  const simpleSave = isImageGallery || isTextNote
  const galleryCount = isImageGallery ? videoInfo.image_urls!.length : 0
  const galleryLabel = videoInfo._type === 'xhs_gallery' ? 'Xiaohongshu' : 'Douyin'
  const pageUrl = videoInfo.webpage_url || ''
  const showDouyinBulkHint = !simpleSave && isDouyinProfileHomeUrl(pageUrl)
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
      setBulkNote(id ? `Bulk job started (${id}). Open Preferences → Advanced for status.` : 'Bulk job started. Open Preferences → Advanced for status.')
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
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="format-dialog-title" className="w-full max-w-[520px] max-h-[calc(100vh-24px)] bg-background rounded-panel overflow-hidden shadow-2xl ring-1 ring-inset ring-divider-strong flex flex-col outline-none">
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
        {!simpleSave && (
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
          id={simpleSave ? 'format-gallery-panel' : `format-panel-${activeTab}`}
          {...(simpleSave ? { role: 'region' as const, 'aria-labelledby': 'format-dialog-title' } : { role: 'tabpanel' as const, 'aria-labelledby': `format-tab-${activeTab}` })}
          className="px-5 max-h-[min(300px,45vh)] overflow-y-auto min-h-0"
        >
          {isTextNote ? (
            <div className="py-5 space-y-4">
              <div className="rounded-button bg-control px-4 py-3 ring-1 ring-inset ring-divider-subtle">
                <p className="text-sm font-medium text-foreground">Text note</p>
                <p className="text-xs text-muted-foreground mt-1">
                  This post has no video or images. V-Download will save the title and caption as Markdown.
                </p>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => handleDownload('video', Number(settings.defaultVideoQuality || '1080'), 'text-note')}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-action text-action-fg text-xs font-semibold hover:bg-action-hover transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                >
                  <Download size={13} />
                  Save note
                </button>
              </div>
            </div>
          ) : isImageGallery ? (
            <div className="py-5 space-y-4">
              <div className="rounded-button bg-control px-4 py-3 ring-1 ring-inset ring-divider-subtle">
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
                <span className="w-[160px] text-xs font-semibold text-muted-foreground">Quality</span>
                <span className="flex-1 text-xs font-semibold text-muted-foreground">Details</span>
              </div>
              <div className="h-px bg-divider-subtle" />

              {activeTab === 'other' ? (
                <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
                  No other formats available
                </div>
              ) : (
                <div role="radiogroup" aria-label="Output format">
                {activeFormats.map((fmt, index) => {
                  const selected = fmt.key === resolvedSelectedKey
                  const audio = activeTab === 'audio'
                  return (
                    <div key={fmt.key || `${fmt.format_id || fmt.format || 'candidate'}-${index}`}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={formatAccessibleDownloadLabel(fmt, audio ? 'MP3' : 'MP4')}
                        onClick={() => setSelectedKey(fmt.key)}
                        className={`flex w-full flex-wrap items-center gap-2 min-h-11 px-3 py-2 text-left rounded-md ${
                          selected ? 'bg-selection ring-1 ring-inset ring-border-strong' : 'hover:bg-control'
                        }`}
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                            selected ? 'border-foreground' : 'border-border-strong'
                          }`}
                          aria-hidden
                        >
                          {selected ? <span className="h-2 w-2 rounded-full bg-foreground" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 text-[13px] font-medium text-foreground">
                          <span className="block">{audio ? `${fmt.quality} kbps · MP3` : `${fmt.quality}p · MP4`}</span>
                          <span className="block text-xs text-subtle-foreground">
                            {fmt.kind === 'audio' || fmt.kind === 'video' ? candidateMeta(fmt, audio) : 'Best available'}
                          </span>
                        </span>
                        {fmt.recommended ? (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground" aria-label="Recommended format">
                            Recommended
                          </span>
                        ) : null}
                      </button>
                      <div className="h-px bg-divider-subtle" />
                    </div>
                  )
                })}
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
              <p className="text-xs text-muted-foreground leading-relaxed">
                This page looks like a creator profile. Use the external douyin-downloader for multi-post bulk; single-post queue download uses Download selected below.
              </p>
              <div className="flex flex-wrap gap-2">
                {bulkConfigured ? (
                  <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={() => void handleStartDouyinBulkFromDialog()}
                    className="px-3 py-1.5 rounded-lg border border-border bg-raised text-xs font-medium text-foreground hover:bg-control disabled:opacity-50"
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
                    {bulkConfigured ? 'Open download settings' : 'Configure in download settings'}
                  </button>
                ) : null}
              </div>
              {bulkNote ? <p className="text-[11px] text-muted-foreground">{bulkNote}</p> : null}
            </div>
          )}
          {!simpleSave && activeTab !== 'other' ? (
            <div className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <Folder size={14} className="text-muted-foreground" />
                <span className="text-xs text-muted-foreground truncate">{downloadDir}</span>
                <button
                  type="button"
                  onClick={handleChangeFolder}
                  className="text-xs font-medium text-foreground hover:underline flex-shrink-0"
                >
                  Change
                </button>
              </div>
              <button
                type="button"
                disabled={!selectedFormat || queuedKeys.has(selectedFormat.key)}
                onClick={() => selectedFormat && handleDownload(activeTab === 'audio' ? 'mp3' : 'mp4', selectedFormat.quality, selectedFormat.key)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-action text-action-fg text-xs font-semibold hover:bg-action-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              >
                <Download size={13} />
                <span aria-live="polite">{selectedFormat && queuedKeys.has(selectedFormat.key) ? 'Added' : 'Download selected'}</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 h-10">
              <Folder size={14} className="text-muted-foreground" />
              <span className="text-xs text-muted-foreground truncate">{downloadDir}</span>
              <button
                type="button"
                onClick={handleChangeFolder}
                className="text-xs font-medium text-foreground hover:underline flex-shrink-0"
              >
                Change
              </button>
            </div>
          )}
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
