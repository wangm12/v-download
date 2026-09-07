import { memo } from 'react'
import { X, FolderOpen, Trash2, Play, RotateCcw, Pause, Loader2, Download as DownloadAgainIcon } from 'lucide-react'
import type { Download } from '@/types'
import { useDownloadActions } from '@/contexts/DownloadActionsContext'
import { ActionButton } from './ActionButton'
import { formatDuration } from '@/utils/format'
import { cn } from '@/lib/cn'
import { ThumbnailImage } from './ThumbnailImage'
import { StatusPill } from './ui'
import { revealFolderLabel } from './downloadInspectorPresentation'
import { getStatusTone } from './statusPresentation'
import { useTranslation } from 'react-i18next'
import type { SelectionModifiers } from '@/utils/selection'

const folderActionLabel = revealFolderLabel(typeof window !== 'undefined' ? window.api?.platform : undefined)

interface DownloadItemProps {
  download: Download
  selected?: boolean
  onSelect?: (id: string, modifiers?: SelectionModifiers) => void
  onSelectReadyResolve?: (id: string) => void
}

export const DownloadItem = memo(function DownloadItem({ download, selected = false, onSelect, onSelectReadyResolve }: DownloadItemProps) {
  const { t } = useTranslation()
  const actions = useDownloadActions()
  const { id, title, format, quality, status, progress, speed, eta, phase, thumbnail, duration, channel, error, url } = download

  const metadataParts = [channel, format, quality, duration ? formatDuration(duration) : ''].filter(Boolean)
  const metadata = metadataParts.join(' · ')
  const isResolverPlaceholder = /^resolving(?:…|\.\.\.)?$/i.test(title.trim())
  let sourceLabel = 'link'
  try {
    sourceLabel = new URL(url).hostname.replace(/^www\./i, '') || sourceLabel
  } catch {
    /* Keep a concise fallback title for malformed legacy rows. */
  }
  const displayTitle = isResolverPlaceholder
    ? status === 'error'
      ? t('queue.resolveFailed', { source: sourceLabel })
      : status === 'ready'
        ? t('queue.readyNamed', { source: sourceLabel })
        : t('queue.resolvingNamed', { source: sourceLabel })
    : title

  const statusContent = () => {
    switch (status) {
      case 'downloading': {
        const phaseLabel =
          phase === 'audio' ? t('status.audio') :
          phase === 'merging' ? t('status.merging') :
          phase === 'video' ? t('status.video') : ''
        const leftParts: string[] = []
        if (phaseLabel) leftParts.push(phaseLabel)
        leftParts.push(progress < 1 ? t('queue.starting') : `${Math.round(progress)}%`)
        if (download.totalSize) leftParts.push(download.totalSize)
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
              {showEta && <span className="ml-auto tabular-nums">{t('queue.eta', { eta })}</span>}
            </div>
          </div>
        )
      }
      case 'complete':
        return <StatusPill tone={getStatusTone('complete')}>{t('status.complete')}</StatusPill>
      case 'resolving':
        return (
          <StatusPill tone={getStatusTone('resolving')}>
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            {t('status.resolving')}
          </StatusPill>
        )
      case 'ready':
        return <StatusPill tone={getStatusTone('ready')}>{t('status.ready')}</StatusPill>
      case 'queued':
        return <StatusPill tone={getStatusTone('queued')}>{t('status.queued')}</StatusPill>
      case 'paused':
        return (
          <StatusPill tone={getStatusTone('paused')}>
            {t('status.paused')} · {Math.round(progress)}%
          </StatusPill>
        )
      case 'error':
        return (
          <span title={error || 'Unknown error'} className="max-w-full min-w-0">
            <StatusPill tone={getStatusTone('error')} className="max-w-full min-w-0">
              <span className="truncate">{t('status.error')}{error ? `: ${error}` : ''}</span>
            </StatusPill>
          </span>
        )
      case 'interrupted':
        return <StatusPill tone={getStatusTone('interrupted')}>{t('status.interrupted')}</StatusPill>
      case 'cancelled':
        return <StatusPill tone={getStatusTone('cancelled')}>{t('status.cancelled')}</StatusPill>
      default:
        return null
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-selected={selected}
      data-attention={status === 'error' || status === 'interrupted' ? 'true' : undefined}
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
        (status === 'error' || status === 'interrupted') && 'border border-dashed border-border-strong',
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
        <p className="text-sm font-semibold text-foreground truncate w-full">{displayTitle}</p>
        {metadata && <p className="text-xs text-muted-foreground truncate w-full">{metadata}</p>}
        {statusContent()}
      </div>

      <div className="flex-shrink-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {status === 'downloading' && (
          <>
            <ActionButton icon={Pause} title={t('queue.pause')} onClick={() => actions.pause(id)} />
            <ActionButton icon={Trash2} title={t('queue.deleteWithFiles')} onClick={() => actions.removeWithFiles(id)} />
          </>
        )}
        {status === 'paused' && (
          <>
            <ActionButton icon={Play} title={t('queue.resume')} onClick={() => actions.retry(id)} />
            <ActionButton icon={Trash2} title={t('queue.deleteWithFiles')} onClick={() => actions.removeWithFiles(id)} />
          </>
        )}
        {status === 'complete' && (
          <>
            {download.file_path && (
              <ActionButton icon={FolderOpen} title={folderActionLabel} onClick={() => actions.openFolder(download.file_path!)} />
            )}
            <ActionButton icon={DownloadAgainIcon} title={t('queue.downloadAgain')} onClick={() => actions.downloadAgain(download)} />
            <ActionButton icon={Trash2} title={t('queue.removeFromList')} onClick={() => actions.remove(id)} />
          </>
        )}
        {status === 'queued' && (
          <ActionButton icon={X} title={t('common.cancel')} onClick={() => actions.cancel(id)} />
        )}
        {status === 'resolving' && (
          <ActionButton icon={X} title={t('queue.cancelResolving')} onClick={() => actions.cancel(id)} />
        )}
        {status === 'ready' && (
          <>
            <button
              type="button"
              className="rounded-md bg-action px-2.5 py-1.5 text-[11px] font-semibold text-action-fg hover:bg-action-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              onClick={() => onSelectReadyResolve?.(id)}
            >
              {t('queue.selectFormat')}
            </button>
            <ActionButton icon={Trash2} title={t('common.remove')} onClick={() => actions.remove(id)} />
          </>
        )}
        {(status === 'interrupted' || status === 'error' || status === 'cancelled') && (
          <>
            <ActionButton icon={RotateCcw} title={t('common.retry')} onClick={() => actions.retry(id)} />
            <ActionButton icon={Trash2} title={t('common.remove')} onClick={() => actions.remove(id)} />
          </>
        )}
      </div>
    </div>
  )
})
