import { memo } from 'react'
import { X, FolderOpen, Trash2, Play, RotateCcw, Pause } from 'lucide-react'
import type { Download } from '@/types'
import { useDownloadActions } from '@/contexts/DownloadActionsContext'
import { ActionButton } from './ActionButton'
import { formatDuration } from '@/utils/format'
import { cn } from '@/lib/cn'
import { ThumbnailImage } from './ThumbnailImage'
import type { SelectionModifiers } from '@/utils/selection'

interface DownloadItemProps {
  download: Download
  selected?: boolean
  onSelect?: (id: string, modifiers?: SelectionModifiers) => void
}

export const DownloadItem = memo(function DownloadItem({ download, selected = false, onSelect }: DownloadItemProps) {
  const actions = useDownloadActions()
  const { id, title, format, quality, status, progress, speed, eta, phase, thumbnail, duration, channel, error, url } = download

  const metadataParts = [channel, format, quality, duration ? formatDuration(duration) : ''].filter(Boolean)
  const metadata = metadataParts.join(' · ')

  const statusContent = () => {
    switch (status) {
      case 'downloading': {
        const phaseLabel =
          phase === 'audio' ? 'Audio' :
          phase === 'merging' ? 'Merging' :
          phase === 'video' ? 'Video' : ''
        const leftParts: string[] = []
        if (phaseLabel) leftParts.push(phaseLabel)
        leftParts.push(`${Math.round(progress)}%`)
        if (speed) leftParts.push(speed)

        const showEta = eta && eta !== '00:00' && eta !== '0:00'
        const isMerging = phase === 'merging'

        return (
          <div className="flex flex-col gap-1 w-full min-w-0 self-stretch">
            <div className="h-1 w-full rounded-full bg-control overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-300',
                  isMerging ? 'bg-progress-muted' : 'bg-progress'
                )}
                style={{ width: `${isMerging ? 100 : progress}%` }}
              />
            </div>
            <div className="flex items-center text-xs text-muted-foreground">
              <span className="tabular-nums">{leftParts.join(' · ')}</span>
              {showEta && <span className="ml-auto tabular-nums">ETA {eta}</span>}
            </div>
          </div>
        )
      }
      case 'complete':
        return (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" aria-hidden />
            Complete
          </span>
        )
      case 'queued':
        return (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-control px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" aria-hidden />
            Queued
          </span>
        )
      case 'paused':
        return (
          <span className="text-xs text-muted-foreground tabular-nums">Paused · {Math.round(progress)}%</span>
        )
      case 'error':
        return (
          <span
            className="inline-flex shrink-0 max-w-full min-w-0 items-center gap-1 rounded-full bg-error/15 px-2 py-0.5 text-[10px] font-medium text-error"
            title={error || 'Unknown error'}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" aria-hidden />
            <span className="truncate">Failed{error ? `: ${error}` : ''}</span>
          </span>
        )
      case 'interrupted':
        return (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-error/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-error">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" aria-hidden />
            Interrupted
          </span>
        )
      case 'cancelled':
        return (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-error/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-error">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" aria-hidden />
            Cancelled
          </span>
        )
      default:
        return null
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-selected={selected}
      aria-pressed={selected}
      aria-selected={selected}
      onClick={(event) => onSelect?.(id, event)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect?.(id)
        }
      }}
      className={cn(
        'v-list-row min-h-[98px] flex items-center gap-4 px-4 py-3 rounded-lg mx-1 transition-colors cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus [content-visibility:auto] [contain-intrinsic-size:98px]',
        selected
          ? 'text-foreground'
          : 'text-foreground'
      )}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (status === 'complete' && download.file_path) actions.openFile(download.file_path)
      }}
    >
      <div className="flex-shrink-0 relative w-[106px] h-[60px] rounded-lg overflow-hidden bg-surface ring-1 ring-inset ring-divider-subtle">
        <ThumbnailImage src={thumbnail} referer={url || undefined} />
        <div className="absolute inset-0 flex items-center justify-center bg-black/25">
          <Play className="w-6 h-6 text-foreground/80" fill="currentColor" />
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-1 items-start">
        <p className="text-sm font-semibold text-foreground truncate w-full">{title}</p>
        {metadata && <p className="text-xs text-muted-foreground truncate w-full">{metadata}</p>}
        {statusContent()}
      </div>

      <div className="flex-shrink-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {status === 'downloading' && (
          <>
            <ActionButton icon={Pause} title="Pause" onClick={() => actions.pause(id)} />
            <ActionButton icon={Trash2} title="Delete with files" onClick={() => actions.removeWithFiles(id)} />
          </>
        )}
        {status === 'paused' && (
          <>
            <ActionButton icon={Play} title="Resume" onClick={() => actions.retry(id)} />
            <ActionButton icon={Trash2} title="Delete with files" onClick={() => actions.removeWithFiles(id)} />
          </>
        )}
        {status === 'complete' && (
          <>
            {download.file_path && (
              <ActionButton icon={FolderOpen} title="Open folder" onClick={() => actions.openFolder(download.file_path!)} />
            )}
            <ActionButton icon={Trash2} title="Remove from list" onClick={() => actions.remove(id)} />
          </>
        )}
        {status === 'queued' && (
          <ActionButton icon={X} title="Cancel" onClick={() => actions.cancel(id)} />
        )}
        {(status === 'interrupted' || status === 'error' || status === 'cancelled') && (
          <>
            <ActionButton icon={RotateCcw} title="Retry" onClick={() => actions.retry(id)} />
            <ActionButton icon={Trash2} title="Remove" onClick={() => actions.remove(id)} />
          </>
        )}
      </div>
    </div>
  )
})
