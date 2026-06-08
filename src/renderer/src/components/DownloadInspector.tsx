import {
  FolderOpen,
  File,
  RotateCcw,
  Trash2,
  Pause,
  Play,
  RefreshCw,
  ExternalLink
} from 'lucide-react'
import type { Download, DownloadActions } from '@/types'
import { useDownloadActions } from '@/contexts/DownloadActionsContext'
import { formatDuration, formatFileSize } from '@/utils/format'
import { cn } from '@/lib/cn'
import { ThumbnailImage } from './ThumbnailImage'

function statusLabel(status: Download['status']): string {
  switch (status) {
    case 'complete':
      return 'Complete'
    case 'downloading':
      return 'Downloading'
    case 'queued':
      return 'Queued'
    case 'paused':
      return 'Paused'
    case 'error':
      return 'Failed'
    case 'interrupted':
      return 'Interrupted'
    case 'cancelled':
      return 'Cancelled'
    default:
      return status
  }
}

function StatusPill({ status }: { status: Download['status'] }) {
  const failed = status === 'error' || status === 'interrupted' || status === 'cancelled'
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        status === 'complete' &&
          'border-emerald-500/40 bg-emerald-950/55 text-emerald-100',
        status === 'downloading' && 'border-white/[0.18] bg-state-active-bg text-foreground',
        (status === 'queued' || status === 'paused') && 'border-white/[0.14] bg-state-queued-bg text-foreground',
        failed && 'border-red-500/45 bg-red-950/55 text-red-200'
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          status === 'complete' && 'bg-emerald-400',
          failed && 'bg-red-400',
          !failed && status !== 'complete' && 'bg-foreground'
        )}
        aria-hidden
      />
      {statusLabel(status)}
    </span>
  )
}

interface DownloadInspectorProps {
  download: Download | null
  downloadDir: string
  onSyncBrowserCookies?: () => void
}

export function DownloadInspector({ download, downloadDir, onSyncBrowserCookies }: DownloadInspectorProps) {
  const actions = useDownloadActions()

  const asideShell = cn(
    'flex h-full min-h-0 w-[328px] shrink-0 flex-col self-stretch border-l border-border bg-sidebar',
    'items-stretch gap-4 overflow-y-auto overflow-x-hidden px-4 py-4'
  )

  return (
    <aside
      className={asideShell}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      aria-label="Inspector"
    >
      {!download ? (
        <div
          className={cn(
            'flex min-h-0 min-w-0 flex-1 flex-col',
            'animate-panel-fade-in motion-reduce:animate-none'
          )}
        >
          <h2 className="text-[15px] font-semibold text-foreground mb-3">Inspector</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Select a download to see output format, destination, and actions. Paste a URL, drop a link on the queue, or
            use the browser companion for logged-in pages.
          </p>
          <div className="rounded-card border border-border bg-raised/40 p-3 mt-auto">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-tertiary-foreground mb-1">
              Save location
            </p>
            <p className="text-xs text-muted-foreground break-all leading-snug">{downloadDir || 'Not set'}</p>
          </div>
        </div>
      ) : (
        <InspectorDetailBody download={download} downloadDir={downloadDir} actions={actions} onSyncBrowserCookies={onSyncBrowserCookies} />
      )}
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
  const { id, title, format, quality, status, progress, speed, eta, phase, thumbnail, duration, channel, error, file_path, file_size, url } =
    download
  const meta = [channel, format, quality, duration != null ? formatDuration(duration) : ''].filter(Boolean).join(' · ')

  const btn =
    'w-full flex items-center justify-center gap-2 py-2 px-3 rounded-button text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar'
  const btnPrimary = `${btn} bg-action text-action-fg hover:bg-action-hover`
  const btnSecondary = `${btn} border border-border bg-control text-foreground hover:bg-state-active-bg`
  const btnDanger = `${btn} border border-dashed border-border-strong text-foreground hover:bg-state-error-bg`

  return (
    <div
      className={cn('flex min-h-0 min-w-0 flex-1 flex-col gap-4', 'animate-panel-fade-in motion-reduce:animate-none')}
    >
      <div className="aspect-video w-full rounded-card overflow-hidden bg-raised border border-border shrink-0">
        <ThumbnailImage src={thumbnail} referer={url || undefined} />
      </div>

      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground leading-snug break-words">{title}</h2>
        {meta && <p className="text-xs text-muted-foreground mt-1.5 break-words">{meta}</p>}
        <div className="mt-2">
          <StatusPill status={status} />
        </div>
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

      {file_size != null && status === 'complete' && (
        <p className="text-xs text-muted-foreground">Size · {formatFileSize(file_size)}</p>
      )}

      {(status === 'error' || status === 'interrupted' || status === 'cancelled') && error && (
        <p className="text-xs text-muted-foreground border border-dashed border-border-strong rounded-lg p-2 leading-relaxed">
          {error}
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
        onClick={() => window.open(url, '_blank')}
      >
        <ExternalLink className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
        <span className="underline-offset-2 hover:underline">{url}</span>
      </button>

      <div className="flex flex-col gap-2 mt-auto pt-2 border-t border-border">
        {status === 'complete' && file_path && (
          <>
            <button type="button" className={btnPrimary} onClick={() => actions.openFile(file_path)}>
              <File className="w-4 h-4 shrink-0" aria-hidden />
              Open file
            </button>
            <button type="button" className={btnSecondary} onClick={() => actions.openFolder(file_path)}>
              <FolderOpen className="w-4 h-4 shrink-0" aria-hidden />
              Reveal in Finder
            </button>
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
            {onSyncBrowserCookies && (
              <button type="button" className={btnSecondary} onClick={onSyncBrowserCookies}>
                <RefreshCw className="w-4 h-4 shrink-0" aria-hidden />
                Sync browser cookies
              </button>
            )}
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
