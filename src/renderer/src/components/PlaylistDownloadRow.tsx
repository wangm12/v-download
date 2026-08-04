import { memo, type CSSProperties } from 'react'
import {
  CircleCheckBig,
  FolderOpen,
  Loader,
  Pause,
  Play,
  RotateCcw,
  Timer,
  Trash2
} from 'lucide-react'
import type { Download } from '@/types'
import { useDownloadActions } from '@/contexts/DownloadActionsContext'
import { ActionButton } from './ActionButton'
import { ThumbnailImage } from './ThumbnailImage'
import { formatFileSize } from '@/utils/format'
import { cn } from '@/lib/cn'
import type { SelectionModifiers } from '@/utils/selection'

interface PlaylistDownloadRowProps {
  download: Download
  displayIndex: number
  selected: boolean
  onSelectDownload: (id: string, modifiers?: SelectionModifiers) => void
  className?: string
  style?: CSSProperties
}

export const PlaylistDownloadRow = memo(function PlaylistDownloadRow({
  download: d,
  displayIndex,
  selected,
  onSelectDownload,
  className,
  style
}: PlaylistDownloadRowProps) {
  const actions = useDownloadActions()

  return (
    <div
      style={style}
      data-selected={selected}
      onDoubleClick={() => {
        if (d.status === 'complete' && d.file_path) actions.openFile(d.file_path)
      }}
      className={cn(
        'v-list-row min-h-[56px] flex items-center gap-3 pl-3 pr-4 mx-1 mb-1 rounded-md transition-colors',
        selected ? 'text-foreground' : 'text-foreground',
        className
      )}
    >
      <span className="w-5 text-xs text-tertiary-foreground flex-shrink-0 text-right">
        {d.playlist_index ?? displayIndex}.
      </span>
      <button
        type="button"
        aria-pressed={selected}
        aria-selected={selected}
        onClick={(event) => onSelectDownload(d.id, event)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        aria-label={`${selected ? 'Selected' : 'Select'} ${d.title}; status ${d.status}`}
      >
        {d.thumbnail ? (
          <ThumbnailImage
            src={d.thumbnail}
            referer={d.url}
            alt=""
            className="h-9 w-14 rounded object-cover"
            placeholderClassName="h-9 w-14 rounded bg-control"
          />
        ) : (
          <span className="h-9 w-14 rounded bg-control" aria-hidden />
        )}
        {d.status === 'complete' && (
          <CircleCheckBig className="w-4 h-4 text-foreground flex-shrink-0" aria-hidden />
        )}
        {d.status === 'downloading' && (
          <Loader className="w-4 h-4 text-foreground animate-spin flex-shrink-0" aria-hidden />
        )}
        {d.status === 'paused' && (
          <Pause className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden />
        )}
        {(d.status === 'queued' || d.status === 'cancelled') && (
          <Timer className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden />
        )}
        {(d.status === 'error' || d.status === 'interrupted') && (
          <Timer className="w-4 h-4 text-foreground flex-shrink-0" aria-hidden />
        )}
        <p className="flex-1 text-sm text-foreground truncate min-w-0">{d.title}</p>
        <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums text-right min-w-[4.5rem]">
          {d.status === 'complete' && d.file_size
            ? formatFileSize(d.file_size)
            : d.status === 'downloading'
              ? [d.speed, `${Math.round(d.progress)}%`].filter(Boolean).join(' · ')
              : ''}
        </span>
      </button>
      <div
        className="flex gap-1 flex-shrink-0 [&>span>button]:h-11 [&>span>button]:w-11 [&>span>button]:p-0"
        onClick={(e) => e.stopPropagation()}
      >
        {d.status === 'downloading' && (
          <>
            <ActionButton icon={Pause} title="Pause" size="sm" onClick={() => actions.pause(d.id)} />
            <ActionButton
              icon={Trash2}
              title="Delete with files"
              size="sm"
              onClick={() => actions.removeWithFiles(d.id)}
            />
          </>
        )}
        {d.status === 'paused' && (
          <>
            <ActionButton icon={Play} title="Resume" size="sm" onClick={() => actions.retry(d.id)} />
            <ActionButton
              icon={Trash2}
              title="Delete with files"
              size="sm"
              onClick={() => actions.removeWithFiles(d.id)}
            />
          </>
        )}
        {d.status === 'complete' && d.file_path && (
          <>
            <ActionButton
              icon={FolderOpen}
              title="Open folder"
              size="sm"
              onClick={() => actions.openFolder(d.file_path!)}
            />
            <ActionButton icon={Trash2} title="Remove" size="sm" onClick={() => actions.remove(d.id)} />
          </>
        )}
        {(d.status === 'interrupted' || d.status === 'error' || d.status === 'cancelled') && (
          <>
            <ActionButton icon={RotateCcw} title="Retry" size="sm" onClick={() => actions.retry(d.id)} />
            <ActionButton icon={Trash2} title="Remove" size="sm" onClick={() => actions.remove(d.id)} />
          </>
        )}
      </div>
    </div>
  )
})
