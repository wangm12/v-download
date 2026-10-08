import { useEffect, useRef, useState } from 'react'
import {
  FolderOpen,
  File,
  RotateCcw,
  Trash2,
  Pause,
  Play,
  RefreshCw,
  ExternalLink,
  LoaderCircle,
  ChevronDown,
  Download as DownloadAgainIcon
} from 'lucide-react'
import type { Download, DownloadActions } from '@/types'
import type { DownloadErrorCode } from '@v-download/shared'
import { useDownloadActions } from '@/contexts/DownloadActionsContext'
import { formatDuration, formatFileSize } from '@/utils/format'
import { cn } from '@/lib/cn'
import { ThumbnailImage } from './ThumbnailImage'
import { StatusPill } from './ui'
import { ActionMenu } from './ui/ActionMenu'
import {
  DOWNLOAD_DETAILS_RAIL_CLASS,
  getInspectorStatCells,
  revealFolderLabel
} from './downloadInspectorPresentation'
import { useTranslation } from 'react-i18next'
import { getStatusTone } from './statusPresentation'

type TranscodePresetId = 'mp3' | 'aac' | 'opus' | 'flac' | 'wav' | 'mp4' | 'h265' | 'vp9'

const TRANSCODE_OPTIONS: Array<{ id: TranscodePresetId; label: string }> = [
  { id: 'mp3', label: 'Extract MP3' },
  { id: 'aac', label: 'Extract AAC' },
  { id: 'opus', label: 'Extract Opus' },
  { id: 'flac', label: 'Extract FLAC' },
  { id: 'wav', label: 'Extract WAV' },
  { id: 'mp4', label: 'H.264 MP4' },
  { id: 'h265', label: 'H.265 MP4' },
  { id: 'vp9', label: 'VP9 WebM' },
]

// Keep renderer recovery behavior safe across the CJS shared-package boundary.
// The shared package still exposes the additive public mapping for consumers,
// but the renderer does not rely on a runtime named export that Vite may not
// statically discover from CommonJS.
const DOWNLOAD_ERROR_ACTIONS: Record<DownloadErrorCode, 'retry' | 'sync-cookies' | 'open-source' | 'open-settings'> = {
  ENGINE_MISSING: 'open-settings',
  PO_TOKEN_REQUIRED: 'retry',
  AUTH_REQUIRED: 'sync-cookies',
  BROWSER_REQUIRED: 'sync-cookies',
  NETWORK_RETRYABLE: 'retry',
  STORAGE_UNAVAILABLE: 'open-settings',
  UNSUPPORTED: 'open-source',
  DRM_PROTECTED: 'open-source',
}

function InspectorStatusPill({ status }: { status: Download['status'] }) {
  const { t } = useTranslation()
  const key = status === 'error' ? 'status.error' : `status.${status}`
  return <StatusPill tone={getStatusTone(status)}>{t(key)}</StatusPill>
}

interface DownloadInspectorProps {
  download: Download | null
  downloadDir: string
  onSyncBrowserCookies?: () => void
  onClose?: () => void
}

export function DownloadInspector({ download, downloadDir, onSyncBrowserCookies, onClose }: DownloadInspectorProps) {
  const { t } = useTranslation()
  const actions = useDownloadActions()
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!download) return
    panelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [download?.id, onClose])

  if (!download) return null

  const asideShell = cn(
    'z-30 flex min-h-0 flex-col items-stretch gap-4 overflow-y-auto overflow-x-hidden border-border bg-sidebar px-4 py-4 shadow-xl',
    'absolute inset-y-0 right-0 w-[min(328px,calc(100vw-24px))] border-l',
    DOWNLOAD_DETAILS_RAIL_CLASS,
    'animate-panel-fade-in motion-reduce:animate-none'
  )

  return (
    <aside
      ref={panelRef}
      className={asideShell}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      aria-label={t('inspector.details')}
      tabIndex={-1}
    >
      <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-border pb-3">
        <h2 className="min-w-0 truncate text-[15px] font-semibold text-foreground">{t('inspector.details')}</h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-button text-muted-foreground transition-colors hover:bg-control hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          aria-label={t('inspector.close')}
        >
          <span aria-hidden className="text-xl leading-none">×</span>
        </button>
      </div>
      <InspectorDetailBody key={download.id} download={download} downloadDir={downloadDir} actions={actions} onSyncBrowserCookies={onSyncBrowserCookies} />
    </aside>
  )
}

function InspectorDetailBody({
  download,
  downloadDir,
  actions,
  onSyncBrowserCookies
}: {
  download: Download
  downloadDir: string
  actions: DownloadActions
  onSyncBrowserCookies?: () => void
}) {
  const { t } = useTranslation()
  const [transcodePreset, setTranscodePreset] = useState<TranscodePresetId>('mp4')
  const [transcodeState, setTranscodeState] = useState<{
    status: 'started' | 'progress' | 'complete' | 'error'
    percent: number
    error?: string
  } | null>(null)
  const { id, title, format, quality, status, progress, speed, eta, phase, thumbnail, duration, channel, error, error_code, file_path, file_size, url } =
    download
  const recoveryAction = error_code ? DOWNLOAD_ERROR_ACTIONS[error_code] : null

  const folderLabel = revealFolderLabel(typeof window !== 'undefined' ? window.api?.platform : undefined)
  const btnPrimary = 'v-button-primary w-full'
  const btnSecondary = 'v-button-secondary w-full'
  const formatLabel = format === 'video' ? t('format.video') : format === 'audio' ? t('format.audio') : format
  const statCells = getInspectorStatCells({
    durationLabel: duration != null && duration > 0 ? formatDuration(duration) : null,
    sizeLabel: file_size != null && file_size > 0 ? formatFileSize(file_size) : null,
    formatLabel: [formatLabel, quality].filter(Boolean).join(' · ') || null
  })
  const isTranscoding = transcodeState?.status === 'started' || transcodeState?.status === 'progress'

  useEffect(() => {
    setTranscodeState(null)
    const unsubscribe = window.api.onTranscodeProgress((event) => {
      if (event.id !== id) return
      setTranscodeState({
        status: event.status,
        percent: event.percent,
        error: event.error,
      })
    })
    return unsubscribe
  }, [id])

  const startTranscode = async () => {
    if (isTranscoding || !file_path) return
    setTranscodeState({ status: 'started', percent: 0 })
    const result = await window.api.transcodeDownload(id, transcodePreset)
    if (result.error) {
      setTranscodeState({ status: 'error', percent: 0, error: result.error })
    }
  }

  const recoveryLabel = t(recoveryAction === 'sync-cookies' && onSyncBrowserCookies ? 'inspector.syncCookies' : recoveryAction === 'open-settings' ? 'inspector.openSettings' : recoveryAction === 'open-source' ? 'inspector.openSource' : 'inspector.retry')
  const recover = () => {
    if (recoveryAction === 'sync-cookies' && onSyncBrowserCookies) onSyncBrowserCookies()
    else if (recoveryAction === 'open-settings') void window.api?.openSettings()
    else if (recoveryAction === 'open-source') void window.api?.openExternalUrl(url)
    else actions.retry(id)
  }
  let sourceHost = t('inspector.sourcePage')
  try { sourceHost = new URL(url).hostname.replace(/^www\./, '') } catch { /* legacy URLs */ }
  const destination = file_path || downloadDir
  const fileName = file_path?.split('/').pop()
  const folderName = (file_path ? file_path.slice(0, file_path.lastIndexOf('/')) : downloadDir).split('/').filter(Boolean).slice(-2).join('/')

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <div className="aspect-video w-full shrink-0 overflow-hidden rounded-card bg-control"><ThumbnailImage src={thumbnail} referer={url || undefined} /></div>
      <div className="min-w-0"><h2 className="break-words text-sm font-semibold leading-snug">{title}</h2>{channel && <p className="mt-1 text-xs text-muted-foreground">{channel}</p>}<div className="mt-2"><InspectorStatusPill status={status} /></div></div>
      {statCells.length > 0 && <dl className="flex flex-wrap gap-x-5 gap-y-2">
        {statCells.map((cell) => <div key={cell.label}><dt className="text-xs text-muted-foreground">{t(cell.label === 'Duration' ? 'inspector.duration' : cell.label === 'Size' ? 'inspector.size' : 'inspector.format')}</dt><dd className="mt-1 text-xs font-medium tabular-nums">{cell.value}</dd></div>)}
      </dl>}
      {status === 'downloading' && <div><div className="mb-2 h-1.5 overflow-hidden rounded-full bg-control"><div className="h-full rounded-full bg-progress transition-all duration-300" style={{ width: `${progress}%` }} /></div>
        <p className="text-xs tabular-nums text-muted-foreground">{phase ? `${t(`status.${phase}`)} · ` : ''}{Math.round(progress)}%{speed ? ` · ${speed}` : ''}{eta && eta !== '00:00' && eta !== '0:00' ? ` · ${t('queue.eta', { eta })}` : ''}</p>
      </div>}
      {status === 'error' && error_code && <p className="text-xs leading-relaxed text-muted-foreground" role="status">{t(error_code === 'STORAGE_UNAVAILABLE' ? 'ui.recoveryStorage' : recoveryAction === 'open-settings' ? 'inspector.recoverySettings' : recoveryAction === 'sync-cookies' ? 'inspector.recoveryCookies' : recoveryAction === 'open-source' ? 'inspector.recoverySource' : 'inspector.recoveryRetry')}</p>}
      <div className="space-y-2">
        {status === 'complete' && file_path && <><button type="button" className={btnPrimary} onClick={() => actions.openFile(file_path)}><File className="h-4 w-4" aria-hidden />{t('inspector.openFile')}</button><button type="button" className={btnSecondary} onClick={() => actions.openFolder(file_path)}><FolderOpen className="h-4 w-4" aria-hidden />{t(folderLabel === 'Reveal in Finder' ? 'inspector.revealFinder' : 'inspector.revealFolder')}</button></>}
        {status === 'complete' && !file_path && <button type="button" className={btnPrimary} onClick={() => actions.downloadAgain(download)}><DownloadAgainIcon className="h-4 w-4" aria-hidden />{t('inspector.downloadAgain')}</button>}
        {status === 'downloading' && <button type="button" className={btnPrimary} onClick={() => actions.pause(id)}><Pause className="h-4 w-4" aria-hidden />{t('inspector.pause')}</button>}
        {status === 'paused' && <button type="button" className={btnPrimary} onClick={() => actions.retry(id)}><Play className="h-4 w-4" aria-hidden />{t('inspector.resume')}</button>}
        {status === 'queued' && <button type="button" className={btnSecondary} onClick={() => actions.cancel(id)}>{t('inspector.cancel')}</button>}
        {(status === 'error' || status === 'interrupted' || status === 'cancelled') && <>
          <button type="button" className={btnPrimary} onClick={recover}><RefreshCw className="h-4 w-4" aria-hidden />{recoveryLabel}</button>
          {recoveryAction && recoveryAction !== 'retry' && <button type="button" className={btnSecondary} onClick={() => actions.retry(id)}><RotateCcw className="h-4 w-4" aria-hidden />{t('inspector.retry')}</button>}
        </>}
      </div>
      {error && (status === 'error' || status === 'interrupted' || status === 'cancelled') && <details className="v-disclosure"><summary><ChevronDown className="v-chevron h-3.5 w-3.5" aria-hidden />{t('ui.rawError')}</summary><p className="max-h-40 overflow-y-auto break-words py-2 text-xs leading-relaxed text-muted-foreground">{error}</p></details>}
      {destination && <div className="min-w-0"><p className="mb-1 text-xs text-muted-foreground">{t('inspector.destination')}</p>{fileName && <p className="truncate text-xs" title={file_path || undefined}>{fileName}</p>}<p className="mt-1 truncate text-xs text-muted-foreground" title={destination}>{folderName}</p></div>}
      <div><p className="mb-1 text-xs text-muted-foreground">{t('inspector.source')}</p><button type="button" onClick={() => window.api?.openExternalUrl(url)} className="inline-flex items-center gap-2 rounded text-xs hover:underline"><ExternalLink className="h-3.5 w-3.5" aria-hidden />{sourceHost}</button>
        <details className="v-disclosure mt-1"><summary><ChevronDown className="v-chevron h-3.5 w-3.5" aria-hidden />{t('inspector.showLink')}</summary><p className="select-text break-all py-2 text-xs text-muted-foreground">{url}</p><button type="button" onClick={() => void navigator.clipboard.writeText(url)} className="v-button-secondary">{t('inspector.copySource')}</button></details>
      </div>
      {status === 'complete' && file_path && <details className="v-disclosure border-t border-divider-subtle pt-2"><summary><ChevronDown className="v-chevron h-3.5 w-3.5" aria-hidden />{t('inspector.createConvertedCopy')}</summary>
        <p className="my-2 text-xs text-muted-foreground">{t('ui.convertHint')}</p>
        <label htmlFor={`transcode-preset-${id}`} className="sr-only">{t('inspector.createConvertedCopy')}</label>
        <select id={`transcode-preset-${id}`} value={transcodePreset} onChange={(event) => setTranscodePreset(event.target.value as TranscodePresetId)} disabled={isTranscoding} className="v-input mb-2">
          {TRANSCODE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{t(option.id === 'mp3' ? 'inspector.extractMp3' : option.id === 'aac' ? 'inspector.extractAac' : option.id === 'opus' ? 'inspector.extractOpus' : option.id === 'flac' ? 'inspector.extractFlac' : option.id === 'wav' ? 'inspector.extractWav' : option.id === 'mp4' ? 'inspector.h264Mp4' : option.id === 'h265' ? 'inspector.h265Mp4' : 'inspector.vp9Webm')}</option>)}
        </select>
        <button type="button" className={btnSecondary} onClick={() => void startTranscode()} disabled={isTranscoding}>{isTranscoding && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}{t('inspector.convertCopy')}</button>
      </details>}
      {isTranscoding && <p className="text-xs" role="status">{t('inspector.converting', { percent: Math.round(transcodeState?.percent ?? 0) })}</p>}
      {transcodeState?.status === 'complete' && <p className="text-xs text-success" role="status">{t('inspector.convertedCreated')}</p>}
      {transcodeState?.status === 'error' && transcodeState.error && <p className="text-xs text-error" role="alert">{transcodeState.error}</p>}
      {status !== 'queued' && <div className="mt-auto flex justify-end border-t border-divider-subtle pt-2"><ActionMenu actions={[
        ...(status === 'complete' && file_path ? [{ label: t('inspector.downloadAgain'), onSelect: () => actions.downloadAgain(download) }] : []),
        { label: t('inspector.removeFromList'), onSelect: () => actions.remove(id), destructive: true },
        ...(['downloading', 'paused'].includes(status) ? [{ label: t('inspector.deleteWithFiles'), onSelect: () => actions.removeWithFiles(id), destructive: true }] : [])
      ]} /></div>}
    </div>
  )
}
