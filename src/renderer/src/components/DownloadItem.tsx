import { X, FolderOpen, Trash2, Play, RotateCcw, Pause } from 'lucide-react'
import type { Download } from '@/types'
import { useDownloadActions } from '@/contexts/DownloadActionsContext'
import { ActionButton } from './ActionButton'
import { formatDuration } from '@/utils/format'

interface DownloadItemProps {
  download: Download
}

export function DownloadItem({ download }: DownloadItemProps) {
  const actions = useDownloadActions()
  const { id, title, format, quality, status, progress, speed, eta, phase, thumbnail, duration, channel, error } = download

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
        const colorClass = isMerging ? 'text-accent-amber' : 'text-accent-green'

        return (
          <div className="flex flex-col gap-1">
            <div className="h-1 w-full rounded-full bg-surface overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${isMerging ? 'bg-accent-amber' : 'bg-accent-green'}`}
                style={{ width: `${isMerging ? 100 : progress}%` }}
              />
            </div>
            <div className={`flex items-center text-xs ${colorClass}`}>
              <span className="tabular-nums">{leftParts.join(' · ')}</span>
              {showEta && <span className="ml-auto tabular-nums">ETA {eta}</span>}
            </div>
          </div>
        )
      }
      case 'complete':
        return <span className="text-xs text-accent-green">Complete</span>
      case 'queued':
        return <span className="text-xs text-accent-amber">Queued</span>
      case 'paused':
        return <span className="text-xs text-accent-amber">Paused · {Math.round(progress)}%</span>
      case 'error':
        return <span className="text-xs text-accent-coral">Error: {error || 'Unknown error'}</span>
      case 'interrupted':
      case 'cancelled':
        return <span className="text-xs text-accent-coral">Interrupted</span>
      default:
        return null
    }
  }

  return (
    <div
      className="h-20 flex items-center gap-4 px-4 py-3 hover:bg-surface/50 transition-colors border-b border-border/50 cursor-default"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onDoubleClick={() => {
        if (status === 'complete' && download.file_path) actions.openFile(download.file_path)
      }}
    >
      <div className="flex-shrink-0 relative w-[106px] h-[60px] rounded-lg overflow-hidden bg-surface">
        {thumbnail ? (
          <img src={thumbnail} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-elevated to-surface" />
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <Play className="w-6 h-6 text-white/80" fill="white" />
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground truncate">{title}</p>
        {metadata && <p className="text-xs text-muted-foreground truncate">{metadata}</p>}
        {statusContent()}
      </div>

      <div className="flex-shrink-0 flex items-center gap-1">
        {status === 'downloading' && (
          <>
            <ActionButton icon={Pause} variant="warning" title="Pause" onClick={() => actions.pause(id)} />
            <ActionButton icon={Trash2} variant="danger" title="Delete with files" onClick={() => actions.removeWithFiles(id)} />
          </>
        )}
        {status === 'paused' && (
          <>
            <ActionButton icon={Play} variant="success" title="Resume" onClick={() => actions.retry(id)} />
            <ActionButton icon={Trash2} variant="danger" title="Delete with files" onClick={() => actions.removeWithFiles(id)} />
          </>
        )}
        {status === 'complete' && (
          <>
            {download.file_path && (
              <ActionButton icon={FolderOpen} title="Open folder" onClick={() => actions.openFolder(download.file_path!)} />
            )}
            <ActionButton icon={Trash2} variant="danger" title="Remove from list" onClick={() => actions.remove(id)} />
          </>
        )}
        {status === 'queued' && (
          <ActionButton icon={X} variant="danger" title="Cancel" onClick={() => actions.cancel(id)} />
        )}
        {(status === 'interrupted' || status === 'error' || status === 'cancelled') && (
          <>
            <ActionButton icon={RotateCcw} variant="success" title="Retry" onClick={() => actions.retry(id)} />
            <ActionButton icon={Trash2} variant="danger" title="Remove" onClick={() => actions.remove(id)} />
          </>
        )}
      </div>
    </div>
  )
}
