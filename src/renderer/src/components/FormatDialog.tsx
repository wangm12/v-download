import { reusableSelection } from '@v-download/shared'
import { DownloadOptionsEditor } from './DownloadOptionsEditor'
import { initialDownloadDraft, exactFormatSelection } from './downloadOptionsModel'
import { useState } from 'react'
import { X, Download, Music, Video, Folder, ChevronDown } from 'lucide-react'
import type { VideoInfo, SettingsData } from '@/types'
import { formatDuration } from '@/utils/format'
import { isDouyinProfileHomeUrl } from '@/utils/douyinBulk'
import { DialogShell } from './ui'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { ThumbnailImage } from './ThumbnailImage'
import {
  TASK_HEADERS_PLACEHOLDER,
  TASK_PROXY_PLACEHOLDER,
  fallbackQuality,
  getPresentationCandidates,
} from './formatDialogPresentation'
import {
  applyFolderChange,
  buildTaskOverridePayload,
  isAllowedTaskProxyUrl
} from './taskOverridesPresentation'
import { useTranslation } from 'react-i18next'
import type { TaskDownloadOverrides } from './taskOverridesPresentation'

interface FormatDialogProps {
  videoInfo: VideoInfo
  settings: SettingsData
  onClose: () => void
  onDownload: (
    url: string,
    format: string,
    quality: string,
    includeNote: boolean,
    overrides?: TaskDownloadOverrides
  ) => void | Promise<void>
  queueCount?: number
  onSkipAll?: () => void
  /** Opens Preferences → Downloads and prefills the bulk URL field (Douyin profile flows). */
  onOpenPreferencesForDouyinBulk?: (homepageUrl: string) => void
  siteRule?: { format: 'best' | 'video' | 'audio'; quality: string }
}

type TabType = 'audio' | 'video'

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
  const { t } = useTranslation()
  const [draft, setDraft] = useState(() => {
    const value = initialDownloadDraft(settings)
    if (siteRule && !settings.downloadPlanLibrary?.defaultId) {
      value.selection = { ...value.selection, target: siteRule.format === 'audio' ? 'audio' : 'video', output: siteRule.format === 'audio' ? 'mp3' : 'original', maxHeight: siteRule.format === 'audio' ? 'best' : Number(siteRule.quality) || 1080, ...(siteRule.format === 'audio' ? { audioBitrate: Number(siteRule.quality) || undefined } : {}) }
    }
    return value
  })
  const activeTab: TabType = draft.selection.target
  const setActiveTab = (tab: TabType) => { setSelectedKey(null); setDraft((v) => ({ ...v, selection: { ...reusableSelection(v.selection), target: tab, output: tab === 'audio' ? 'mp3' : 'original', audioBitrate: tab === 'audio' ? Number(settings.defaultAudioQuality) || undefined : undefined, postprocess: 'none' } })) }
  const downloadDir = draft.outputDir
  const [bulkNote, setBulkNote] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const [downloadBusy, setDownloadBusy] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [queuedKeys, setQueuedKeys] = useState<Set<string>>(new Set())
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const includeNote = draft.includeNote
  const setIncludeNote = (includeNote: boolean) => setDraft((v) => ({ ...v, includeNote }))
  const [taskProxyUrl, setTaskProxyUrl] = useState('')
  const [extraHeadersText, setExtraHeadersText] = useState('')
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose)
  const videoFormatsRaw = getPresentationCandidates(videoInfo.formats, 'video', String(draft.selection.maxHeight))
  const audioFormatsRaw = getPresentationCandidates(videoInfo.formats, 'audio', settings.defaultAudioQuality, siteRule)
  const videoFormats = videoFormatsRaw.length
    ? videoFormatsRaw
    : [{ format_id: 'best', quality: fallbackQuality('video', settings.defaultVideoQuality || '1080', siteRule), kind: 'video' as const, ext: 'auto', key: 'best', recommended: true }]
  const audioFormats = audioFormatsRaw.length
    ? audioFormatsRaw
    : [{ format_id: 'best-audio', quality: fallbackQuality('audio', settings.defaultAudioQuality || '320', siteRule), kind: 'audio' as const, ext: 'auto', key: 'best-audio', recommended: true }]
  const activeFormats = activeTab === 'audio' ? audioFormats : videoFormats
  const resolvedSelectedKey = draft.selection.exact
    ? selectedKey ?? activeFormats.find((item) => item.format_id === draft.selection.exact?.formatId)?.key ?? null
    : null
  const selectedFormat = activeFormats.find((item) => item.key === resolvedSelectedKey) ?? activeFormats[0]
  const formatSize = (bytes?: number, approximate = false) => {
    if (!bytes || bytes <= 0) return t('format.sizeUnknown')
    const value = bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(2)} GB` : `${(bytes / 1048576).toFixed(1)} MB`
    return `${approximate ? '≈ ' : ''}${value}`
  }
  const isImageGallery =
    (videoInfo._type === 'douyin_gallery' || videoInfo._type === 'xhs_gallery') &&
    Array.isArray(videoInfo.image_urls)
  const isTextNote = videoInfo._type === 'text'
  const simpleSave = isImageGallery || isTextNote
  const galleryCount = isImageGallery ? videoInfo.image_urls!.length : 0
  const galleryLabel = videoInfo._type === 'xhs_gallery' ? t('format.xiaohongshu') : t('format.douyin')
  const pageUrl = videoInfo.webpage_url || ''
  const showDouyinBulkHint = !simpleSave && isDouyinProfileHomeUrl(pageUrl)
  const bulkConfigured = Boolean(
    (settings.douyinBulkRunPyPath ?? '').trim() && (settings.douyinBulkConfigPath ?? '').trim()
  )

  const handleChangeFolder = async () => {
    if (!window.api) return
    const folder = await window.api.selectDownloadFolder()
    if (!folder) return
    const next = applyFolderChange(downloadDir, folder)
    setDraft((v) => ({ ...v, outputDir: next.downloadDir }))
  }

  const taskOverrides = (): TaskDownloadOverrides =>
    buildTaskOverridePayload({
      downloadDir,
      settingsDownloadDir: settings.downloadDir,
      proxyUrl: isAllowedTaskProxyUrl(taskProxyUrl) ? taskProxyUrl : '',
      extraHeadersText
    })

  const handleDownload = async (format: string, quality: number, key: string) => {
    if (queuedKeys.has(key) || downloadBusy) return
    setDownloadBusy(true); setDownloadError('')
    try {
    const url = videoInfo.webpage_url || `https://www.youtube.com/watch?v=${videoInfo.id}`
    await onDownload(url, format, String(quality), includeNote, { ...taskOverrides(), ...(simpleSave ? {} : { selection: draft.selection, planId: draft.planId, planRevision: draft.planRevision, filenameTemplate: draft.filenameTemplate, includeNote: draft.includeNote }) })
    setQueuedKeys((previous) => new Set(previous).add(key))
    } catch (error) { setDownloadError(error instanceof Error ? error.message : String(error)) }
    finally { setDownloadBusy(false) }
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
      setBulkNote(id ? t('format.bulkStartedId', { id }) : t('format.bulkStarted'))
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
    { id: 'video', label: t('format.video'), icon: Video },
    { id: 'audio', label: t('format.audio'), icon: Music },

  ]

  const saveKey = isTextNote ? 'text-note' : isImageGallery ? 'gallery' : selectedFormat?.key
  const alreadyQueued = downloadBusy || Boolean(saveKey && queuedKeys.has(saveKey))
  const downloadSelected = () => {
    if (simpleSave) handleDownload('video', Number(settings.defaultVideoQuality || '1080'), saveKey!)
    else if (selectedFormat) handleDownload(activeTab === 'audio' ? 'mp3' : 'mp4', selectedFormat.quality, selectedFormat.key)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation">
      <DialogShell ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="format-dialog-title" className="flex max-h-[calc(100dvh-32px)] max-w-[560px] flex-col outline-none">
        <header className="flex shrink-0 items-start gap-3 border-b border-divider-subtle px-5 py-4">
          <div className="h-12 w-16 shrink-0 overflow-hidden rounded-md bg-control"><ThumbnailImage src={videoInfo.thumbnail} referer={pageUrl || undefined} /></div>
          <div className="min-w-0 flex-1"><h2 id="format-dialog-title" className="line-clamp-2 text-sm font-semibold leading-5">{videoInfo.playlist_count ? videoInfo.playlist_title || videoInfo.title : videoInfo.title}</h2>
            <p className="mt-1 truncate text-xs text-muted-foreground">{[videoInfo.channel && videoInfo.channel !== videoInfo.title ? videoInfo.channel : '', videoInfo.duration > 0 ? formatDuration(videoInfo.duration) : ''].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('format.close')} className="v-button-ghost h-9 w-9 !p-0"><X className="h-4 w-4" aria-hidden /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {!simpleSave && <div className="mb-3 flex gap-1 rounded-button bg-control p-1" role="tablist" aria-label={t('format.formatType')}>
            {tabs.map((tab, index) => {
              const Icon = tab.icon
              return <button key={tab.id} id={`format-tab-${tab.id}`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`format-panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => setActiveTab(tab.id)} onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                  event.preventDefault()
                  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
                  setActiveTab(tabs[next].id)
                  document.getElementById(`format-tab-${tabs[next].id}`)?.focus()
                }} className={`flex min-h-8 flex-1 items-center justify-center gap-2 rounded-md px-3 text-[13px] ${activeTab === tab.id ? 'bg-selection font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden />{tab.label}
              </button>
            })}
          </div>}
          {downloadError && <p role="alert" className="mb-2 text-xs text-error">{downloadError}</p>}
          {!simpleSave && <DownloadOptionsEditor value={draft} onChange={(value) => { setDraft(value); setSelectedKey(null) }} settings={settings} showFolder={false} showNote={false} />}
          <div id={simpleSave ? 'format-gallery-panel' : `format-panel-${activeTab}`} {...(simpleSave ? { role: 'region' as const, 'aria-labelledby': 'format-dialog-title' } : { role: 'tabpanel' as const, 'aria-labelledby': `format-tab-${activeTab}` })}>
            {simpleSave ? <div className="py-2">
              <p className="text-sm font-medium">{isTextNote ? t('format.textNote') : t('format.gallery', { site: galleryLabel })}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{isTextNote ? t('format.textNoteHint') : t(galleryCount === 1 ? 'format.galleryCountOne' : 'format.galleryCount', { count: galleryCount })}</p>
              {isImageGallery && <div className="mt-3 grid grid-cols-4 gap-2">{videoInfo.image_urls!.slice(0, 8).map((src, index) => <div key={index} className="aspect-square overflow-hidden rounded-md bg-control"><ThumbnailImage src={src} referer={pageUrl} /></div>)}</div>}
            </div> : <div role="radiogroup" aria-label={t('format.outputFormat')}>
              <button type="button" role="radio" aria-checked={!draft.selection.exact} onClick={() => { setSelectedKey(null); setDraft((v) => ({ ...v, selection: reusableSelection(v.selection) })) }} className={`mb-1 min-h-10 w-full rounded-button px-3 py-2 text-left text-[13px] ${!draft.selection.exact ? 'bg-selection font-medium' : 'hover:bg-control'}`}>{t('plans.automatic')}</button>
              {activeFormats.map((fmt, index) => {
                const selected = fmt.key === resolvedSelectedKey
                const exact = Boolean(fmt.filesize && fmt.filesize > 0)
                const size = formatSize(exact ? fmt.filesize : fmt.filesize_approx, !exact && Boolean(fmt.filesize_approx))
                return <button key={fmt.key} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1}
                  aria-label={t('plans.selectSource', { quality: [activeTab === 'audio' ? `${fmt.quality} kbps` : `${fmt.quality}p`, fmt.fps ? `${fmt.fps} fps` : '', fmt.vcodec && fmt.vcodec !== 'none' ? fmt.vcodec : fmt.acodec || ''].filter(Boolean).join(' · '), container: (fmt.container || fmt.ext || '').toUpperCase() })}
                  onClick={() => { setSelectedKey(fmt.key); setDraft((v) => ({ ...v, selection: exactFormatSelection(v.selection, fmt, videoInfo.webpage_url) })) }} onKeyDown={(event) => {
                    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
                    event.preventDefault()
                    const next = (index + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) + activeFormats.length) % activeFormats.length
                    setSelectedKey(activeFormats[next].key)
                    setDraft((v) => ({ ...v, selection: exactFormatSelection(v.selection, activeFormats[next], videoInfo.webpage_url) }))
                    ;(event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus()
                  }} className={`mb-1 flex min-h-14 w-full items-center gap-3 rounded-button px-3 py-2 text-left ${selected ? 'bg-selection' : 'hover:bg-control'}`}>
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-foreground' : 'border-border-strong'}`} aria-hidden>{selected && <span className="h-2 w-2 rounded-full bg-foreground" />}</span>
                  <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{t(activeTab === 'audio' ? 'plans.sourceAudio' : 'plans.sourceVideo', { quality: fmt.quality })}</span>
                    <span className="block text-xs text-muted-foreground">{[fmt.container || fmt.ext, fmt.vcodec && fmt.vcodec !== 'none' ? fmt.vcodec : fmt.acodec, fmt.fps ? `${fmt.fps} fps` : '', fmt.dynamic_range, fmt.language].filter(Boolean).join(' · ')}</span>
                    {fmt.recommended && <span className="text-xs text-muted-foreground">{t('ui.recommended')}</span>}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{size}</span>
                </button>
              })}
            </div>}
          </div>
          {!simpleSave && draft.selection.exact?.kind === 'video' && audioFormatsRaw.length > 0 && <label className="mt-3 block text-xs">{t('plans.companionAudio')}
            <select aria-label={t('plans.companionAudio')} className="v-input mt-1 w-full" value={draft.selection.exact.audioFormatId ?? ''} onChange={(event) => setDraft((value) => ({ ...value, selection: { ...value.selection, ...(audioFormatsRaw.find((audio) => audio.format_id === event.target.value)?.language ? { audioLanguage: audioFormatsRaw.find((audio) => audio.format_id === event.target.value)!.language } : {}), exact: value.selection.exact ? { ...value.selection.exact, audioFormatId: event.target.value || undefined } : undefined } }))}>
              <option value="">{t('plans.automatic')}</option>
              {audioFormatsRaw.map((audio) => <option key={audio.format_id} value={audio.format_id}>{[audio.language, audio.acodec, `${audio.quality} kbps`, audio.format_id].filter(Boolean).join(' · ')}</option>)}
            </select>
          </label>}
          {!simpleSave && draft.selection.exact && selectedFormat && <details className="v-disclosure mt-1"><summary><ChevronDown className="v-chevron h-3.5 w-3.5" aria-hidden />{t('ui.codecs')}</summary>
            <p className="pb-2 text-xs leading-relaxed text-muted-foreground">{[t('format.source', { container: (selectedFormat.container || selectedFormat.ext || 'stream').toUpperCase() }), selectedFormat.vcodec && selectedFormat.vcodec !== 'none' ? selectedFormat.vcodec : '', selectedFormat.acodec && selectedFormat.acodec !== 'none' ? selectedFormat.acodec : '', selectedFormat.width && selectedFormat.height ? `${selectedFormat.width}×${selectedFormat.height}` : ''].filter(Boolean).join(' · ')}</p>
          </details>}
          <label className="flex items-center gap-2 py-3"><input type="checkbox" checked={includeNote} onChange={(event) => setIncludeNote(event.target.checked)} className="h-4 w-4 accent-action" /><span className="text-xs">{t('format.includeNote')}</span></label>
          <details className="v-disclosure border-t border-divider-subtle">
            <summary><ChevronDown className="v-chevron h-3.5 w-3.5" aria-hidden />{t('format.advanced')}</summary>
            <div className="space-y-3 py-2">
              <label className="block space-y-1"><span className="text-xs font-medium">{t('format.taskProxy')}</span>
                <input type="url" value={taskProxyUrl} onChange={(event) => setTaskProxyUrl(event.target.value)} placeholder={TASK_PROXY_PLACEHOLDER} autoComplete="off" spellCheck={false} className="v-input" />
                <span className={`block text-xs ${taskProxyUrl.trim() && !isAllowedTaskProxyUrl(taskProxyUrl) ? 'text-error' : 'text-muted-foreground'}`}>{t(taskProxyUrl.trim() && !isAllowedTaskProxyUrl(taskProxyUrl) ? 'format.proxyInvalid' : 'format.proxyEmptyHint')}</span>
              </label>
              <label className="block space-y-1"><span className="text-xs font-medium">{t('format.taskHeaders')}</span><textarea value={extraHeadersText} onChange={(event) => setExtraHeadersText(event.target.value)} placeholder={TASK_HEADERS_PLACEHOLDER} rows={3} spellCheck={false} className="v-input" /></label>
              {showDouyinBulkHint && <div className="space-y-2 text-xs"><p className="text-muted-foreground">{t('format.douyinProfileHint')}</p>
                {bulkConfigured && <button type="button" disabled={bulkBusy} onClick={() => void handleStartDouyinBulkFromDialog()} className="v-button-secondary">{t(bulkBusy ? 'format.bulkStarting' : 'format.bulkStart')}</button>}
                {onOpenPreferencesForDouyinBulk && <button type="button" onClick={handleOpenBulkPreferences} className="v-button-ghost">{t('format.openDownloadSettings')}</button>}{bulkNote && <p>{bulkNote}</p>}
              </div>}
            </div>
          </details>
        </div>
        <footer className="shrink-0 border-t border-divider-subtle bg-surface px-5 py-4">
          <div className="mb-3 flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><Folder className="h-4 w-4 shrink-0" aria-hidden /><span className="shrink-0">{t('ui.saveTo')}</span><span className="min-w-0 flex-1 truncate" title={downloadDir}>{downloadDir.split('/').filter(Boolean).slice(-2).join('/') || downloadDir}</span><button type="button" onClick={handleChangeFolder} className="v-button-ghost !min-h-7 !px-2 !py-1">{t('format.change')}</button></div>
          <div className="flex items-center justify-end gap-2"><button type="button" onClick={onClose} className="v-button-ghost">{t('common.cancel')}</button>
            <button type="button" disabled={alreadyQueued || (isTextNote && !includeNote) || (!simpleSave && (!selectedFormat))} onClick={downloadSelected} className="v-button-primary"><Download className="h-4 w-4" aria-hidden /><span aria-live="polite">{t(alreadyQueued ? 'format.added' : isTextNote ? 'format.saveNote' : isImageGallery ? 'format.downloadImages' : 'format.downloadSelected')}</span></button>
          </div>
          {queueCount > 0 && <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{t(queueCount === 1 ? 'format.moreQueued' : 'format.moreQueuedPlural', { count: queueCount })}</span>{onSkipAll && <button type="button" onClick={onSkipAll} className="v-button-ghost !min-h-7 !py-1">{t('format.skipAll')}</button>}</div>}
        </footer>
      </DialogShell>
    </div>
  )
}
