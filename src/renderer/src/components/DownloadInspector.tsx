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
  LoaderCircle
} from 'lucide-react'
import type { Download, DownloadActions } from '@/types'
import type { DownloadErrorCode } from '@v-download/shared'
import { useDownloadActions } from '@/contexts/DownloadActionsContext'
import { formatDuration, formatFileSize } from '@/utils/format'
import { cn } from '@/lib/cn'
import { ThumbnailImage } from './ThumbnailImage'
import { StatusPill } from './ui'
import {
  DOWNLOAD_DETAILS_LABEL,
  DOWNLOAD_DETAILS_RAIL_CLASS,
  getInspectorStatCells,
  revealFolderLabel
} from './downloadInspectorPresentation'
import { getStatusLabel, getStatusTone } from './statusPresentation'

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
  return <StatusPill tone={getStatusTone(status)}>{getStatusLabel(status)}</StatusPill>
}

interface DownloadInspectorProps {
  download: Download | null
  downloadDir: string
  onSyncBrowserCookies?: () => void
  onClose?: () => void
}

export function DownloadInspector({ download, downloadDir, onSyncBrowserCookies, onClose }: DownloadInspectorProps) {
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
      aria-label={DOWNLOAD_DETAILS_LABEL}
      tabIndex={-1}
    >
      <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-border pb-3">
        <h2 className="min-w-0 truncate text-[15px] font-semibold text-foreground">{DOWNLOAD_DETAILS_LABEL}</h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-button text-muted-foreground transition-colors hover:bg-control hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          aria-label="Close download details"
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
  const [showSafeDetails, setShowSafeDetails] = useState(false)
  const [showErrorDetails, setShowErrorDetails] = useState(false)
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
  const btn =
    'w-full min-h-11 flex items-center justify-center gap-2 py-2 px-3 rounded-button text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar'
  const btnPrimary = `${btn} bg-action text-action-fg hover:bg-action-hover`
  const btnSecondary = `${btn} border border-border bg-control text-foreground hover:bg-state-active-bg`
  const btnDanger = `${btn} border border-dashed border-border-strong bg-control text-foreground hover:bg-surface-hover`
  const statCells = getInspectorStatCells({
    durationLabel: duration != null ? formatDuration(duration) : null,
    sizeLabel: file_size != null ? formatFileSize(file_size) : null,
    formatLabel: [format, quality].filter(Boolean).join(' · ') || null
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

  return (
    <div
      className={cn('flex min-h-0 min-w-0 flex-1 flex-col gap-4', 'animate-panel-fade-in motion-reduce:animate-none')}
    >
      <div className="aspect-video w-full overflow-hidden rounded-card bg-raised ring-1 ring-inset ring-divider-subtle shrink-0">
        <ThumbnailImage src={thumbnail} referer={url || undefined} />
      </div>

      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground leading-snug break-words">{title}</h2>
        {channel ? <p className="text-xs text-muted-foreground mt-1.5 break-words">{channel}</p> : null}
        <div className="mt-2">
          <InspectorStatusPill status={status} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {statCells.map((cell) => (
          <div key={cell.label} className="rounded-lg bg-control px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-tertiary-foreground">{cell.label}</p>
            <p className="mt-1 text-xs font-medium text-foreground tabular-nums break-words">{cell.value}</p>
          </div>
        ))}
      </div>

      {status === 'downloading' && (
        <div>
          <div className="h-1.5 w-full rounded-full bg-control overflow-hidden mb-2">
            <div
              className="h-full rounded-full bg-progress transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {phase ? `${phase} · ` : ''}
            {Math.round(progress)}%
            {speed ? ` · ${speed}` : ''}
            {eta && eta !== '00:00' && eta !== '0:00' ? ` · ETA ${eta}` : ''}
          </p>
        </div>
      )}

      {(status === 'error' || status === 'interrupted' || status === 'cancelled') && error && (
        <div className="rounded-button border border-dashed border-border-strong bg-state-error-bg p-3">
          <p className="text-xs font-medium text-foreground">Needs attention</p>
          {showErrorDetails ? (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{error}</p>
          ) : null}
          <button
            type="button"
            className="mt-2 text-xs font-medium text-foreground underline underline-offset-2 hover:no-underline"
            onClick={() => setShowErrorDetails((value) => !value)}
            aria-expanded={showErrorDetails}
          >
            {showErrorDetails ? 'Hide details' : 'Show details'}
          </button>
        </div>
      )}

      {status === 'error' && error_code && (
        <p className="text-xs text-muted-foreground" role="status">
          {recoveryAction === 'open-settings' && 'Recovery: Open settings and configure yt-dlp.'}
          {recoveryAction === 'sync-cookies' && 'Recovery: Sync browser cookies.'}
          {recoveryAction === 'open-source' && 'Recovery: Open source in your browser.'}
          {recoveryAction === 'retry' && 'Recovery: Retry the download.'}
        </p>
      )}

      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-tertiary-foreground mb-1">Destination</p>
        <p className="text-xs text-muted-foreground break-all leading-snug">{file_path || downloadDir || '—'}</p>
      </div>

      <div className="text-[10px] uppercase tracking-wider text-tertiary-foreground mb-1">Source</div>
      <button
        type="button"
        className="text-left text-xs text-muted-foreground hover:text-foreground flex items-start gap-1 break-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus rounded"
        onClick={() => window.api?.openExternalUrl(url)}
      >
        <ExternalLink className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
        <span className="underline-offset-2 hover:underline">{showSafeDetails ? url : (() => { try { return new URL(url).origin + new URL(url).pathname } catch { return 'Source page' } })()}</span>
      </button>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="text-left text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus rounded"
          onClick={() => setShowSafeDetails((v) => !v)}
          aria-expanded={showSafeDetails}
        >
          {showSafeDetails ? 'Hide link details' : 'Show link details'}
        </button>
        <button
          type="button"
          className="text-left text-xs font-medium text-foreground underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus rounded"
          onClick={() => void navigator.clipboard.writeText(url)}
        >
          Copy source link
        </button>
      </div>

      <div className="flex flex-col gap-2 mt-auto pt-2 border-t border-border">
        {status === 'complete' && file_path && (
          <>
            <button type="button" className={btnPrimary} onClick={() => actions.openFile(file_path)}>
              <File className="w-4 h-4 shrink-0" aria-hidden />
              Open file
            </button>
            <button type="button" className={btnSecondary} onClick={() => actions.openFolder(file_path)}>
              <FolderOpen className="w-4 h-4 shrink-0" aria-hidden />
              {folderLabel}
            </button>
            <div className="rounded-button border border-border bg-control p-3">
              <label htmlFor={`transcode-preset-${id}`} className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-tertiary-foreground">
                Create converted copy
              </label>
              <div className="flex flex-col gap-2">
                <select
                  id={`transcode-preset-${id}`}
                  value={transcodePreset}
                  onChange={(event) => setTranscodePreset(event.target.value as TranscodePresetId)}
                  disabled={isTranscoding}
                  className="min-h-10 w-full rounded-button border border-border bg-sidebar px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                >
                  {TRANSCODE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
                <button type="button" className={btnSecondary} onClick={() => void startTranscode()} disabled={isTranscoding}>
                  {isTranscoding ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden /> : null}
                  {isTranscoding ? `Converting ${Math.round(transcodeState?.percent ?? 0)}%` : 'Convert copy'}
                </button>
              </div>
              {transcodeState?.status === 'complete' && (
                <p className="mt-2 text-xs text-foreground" role="status">Converted copy created.</p>
              )}
              {transcodeState?.status === 'error' && transcodeState.error && (
                <p className="mt-2 text-xs leading-relaxed text-foreground" role="alert">{transcodeState.error}</p>
              )}
            </div>
            <button type="button" className={btnDanger} onClick={() => actions.remove(id)}>
              <Trash2 className="w-4 h-4 shrink-0" aria-hidden />
              Remove from list
            </button>
          </>
        )}

        {status === 'complete' && !file_path && (
          <button type="button" className={btnDanger} onClick={() => actions.remove(id)}>
            <Trash2 className="w-4 h-4 shrink-0" aria-hidden />
            Remove from list
          </button>
        )}

        {status === 'downloading' && (
          <>
            <button type="button" className={btnSecondary} onClick={() => actions.pause(id)}>
              <Pause className="w-4 h-4 shrink-0" aria-hidden />
              Pause
            </button>
            <button type="button" className={btnDanger} onClick={() => actions.removeWithFiles(id)}>
              <Trash2 className="w-4 h-4 shrink-0" aria-hidden />
              Delete with files
            </button>
          </>
        )}

        {status === 'paused' && (
          <>
            <button type="button" className={btnPrimary} onClick={() => actions.retry(id)}>
              <Play className="w-4 h-4 shrink-0" aria-hidden />
              Resume
            </button>
            <button type="button" className={btnDanger} onClick={() => actions.removeWithFiles(id)}>
              <Trash2 className="w-4 h-4 shrink-0" aria-hidden />
              Delete with files
            </button>
          </>
        )}

        {status === 'queued' && (
          <button type="button" className={btnDanger} onClick={() => actions.cancel(id)}>
            <Trash2 className="w-4 h-4 shrink-0" aria-hidden />
            Cancel
          </button>
        )}

        {(status === 'interrupted' || status === 'error' || status === 'cancelled') && (
          <>
            <button type="button" className={btnPrimary} onClick={() => actions.retry(id)}>
              <RotateCcw className="w-4 h-4 shrink-0" aria-hidden />
              Retry now
            </button>
            {onSyncBrowserCookies && recoveryAction === 'sync-cookies' && (
              <button type="button" className={btnSecondary} onClick={onSyncBrowserCookies}>
                <RefreshCw className="w-4 h-4 shrink-0" aria-hidden />
                Sync browser cookies
              </button>
            )}
            {recoveryAction === 'open-settings' && <button type="button" aria-label="Open settings" className={btnSecondary} onClick={() => window.api?.openSettings()}>Open settings</button>}
            {recoveryAction === 'open-source' && <button type="button" aria-label="Open source" className={btnSecondary} onClick={() => window.api?.openExternalUrl(url)}>Open source</button>}
            <button type="button" className={btnDanger} onClick={() => actions.remove(id)}>
              <Trash2 className="w-4 h-4 shrink-0" aria-hidden />
              Remove
            </button>
          </>
        )}
      </div>
    </div>
  )
}
