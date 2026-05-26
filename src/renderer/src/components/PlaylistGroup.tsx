import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  ListVideo,
  CircleCheckBig,
  Loader,
  Timer,
  Trash2,
  FolderOpen,
  RotateCcw,
  Pause,
  Play
} from 'lucide-react'
import type { Playlist } from '@/types'
import { useDownloadActions } from '@/contexts/DownloadActionsContext'
import { PlaylistDeleteDialog } from './PlaylistDeleteDialog'
import { ActionButton } from './ActionButton'
import { HoverHintWrap } from './HoverHintWrap'
import { formatFileSize } from '@/utils/format'
import { cn } from '@/lib/cn'

const VISIBLE_ITEMS = 5

interface PlaylistGroupProps {
  playlist: Playlist
  selectedId: string | null
  onSelectDownload: (id: string) => void
}

export function PlaylistGroup({ playlist, selectedId, onSelectDownload }: PlaylistGroupProps) {
  const actions = useDownloadActions()
  const [expanded, setExpanded] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const downloads = playlist.downloads ?? []
  const visibleDownloads = showAll ? downloads : downloads.slice(0, VISIBLE_ITEMS)
  const hasMore = downloads.length > VISIBLE_ITEMS && !showAll
  const moreCount = downloads.length - VISIBLE_ITEMS

  const progressPercent =
    playlist.total_count > 0 ? (playlist.completed_count / playlist.total_count) * 100 : 0

  const hasActiveItems = downloads.some((d) => d.status === 'downloading' || d.status === 'queued')
  const resumableItems = downloads.filter((d) =>
    ['paused', 'interrupted', 'cancelled', 'error'].includes(d.status)
  )
  const hasResumableItems = resumableItems.length > 0

  return (
    <>
      {deleteDialogOpen && (
        <PlaylistDeleteDialog
          playlistTitle={playlist.title}
          videoCount={downloads.length}
          onClose={() => setDeleteDialogOpen(false)}
          onRemoveListOnly={() => {
            downloads.forEach((d) => actions.remove(d.id))
          }}
          onRemoveWithFiles={() => {
            downloads.forEach((d) => actions.removeWithFiles(d.id))
          }}
        />
      )}
    <div className="mx-1 mb-1 rounded-lg border border-border overflow-hidden bg-surface" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          const next = !expanded
          setExpanded(next)
          if (!next) setShowAll(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            const next = !expanded
            setExpanded(next)
            if (!next) setShowAll(false)
          }
        }}
        className="w-full flex items-center gap-3 px-4 py-3 bg-surface hover:bg-control transition-colors text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
        <div className="w-8 h-8 rounded flex items-center justify-center bg-control text-foreground flex-shrink-0 border border-border">
          <ListVideo className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{playlist.title}</p>
          <p className="text-xs text-muted-foreground">
            {playlist.type} · {playlist.total_count} videos · {playlist.output_dir}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-24 h-1.5 rounded-full bg-control overflow-hidden border border-border/50">
            <div
              className="h-full rounded-full bg-progress transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {playlist.completed_count}/{playlist.total_count}
          </span>
          {hasResumableItems && (
            <HoverHintWrap text="Resume all" side="bottom">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  resumableItems.forEach((d) => actions.retry(d.id))
                }}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-control transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                aria-label="Resume all"
              >
                <Play className="w-4 h-4" aria-hidden />
              </button>
            </HoverHintWrap>
          )}
          {hasActiveItems && (
            <HoverHintWrap text="Pause all" side="bottom">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  downloads
                    .filter((d) => d.status === 'downloading' || d.status === 'queued')
                    .forEach((d) => actions.pause(d.id))
                }}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-control transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                aria-label="Pause all"
              >
                <Pause className="w-4 h-4" aria-hidden />
              </button>
            </HoverHintWrap>
          )}
          <HoverHintWrap text="Remove playlist" side="bottom">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setDeleteDialogOpen(true)
              }}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-control transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              aria-label="Remove playlist"
            >
              <Trash2 className="w-4 h-4" aria-hidden />
            </button>
          </HoverHintWrap>
        </div>
      </div>

      {expanded && (
        <div className="bg-background border-t border-border/50">
          {visibleDownloads.map((d, idx) => (
            <div
              key={d.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectDownload(d.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectDownload(d.id)
                }
              }}
              onDoubleClick={() => {
                if (d.status === 'complete' && d.file_path) actions.openFile(d.file_path)
              }}
              className={cn(
                'h-11 flex items-center gap-3 pl-14 pr-4 mx-1 mb-1 rounded-md border transition-colors cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus',
                selectedId === d.id
                  ? 'bg-state-active-bg border-white/[0.18]'
                  : 'border-transparent hover:bg-control'
              )}
            >
              <span className="w-5 text-xs text-tertiary-foreground flex-shrink-0">
                {d.playlist_index ?? idx + 1}.
              </span>
              {d.status === 'complete' && <CircleCheckBig className="w-4 h-4 text-emerald-400 flex-shrink-0" aria-hidden />}
              {d.status === 'downloading' && <Loader className="w-4 h-4 text-foreground animate-spin flex-shrink-0" aria-hidden />}
              {d.status === 'paused' && <Pause className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden />}
              {(d.status === 'queued' || d.status === 'cancelled') && (
                <Timer className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden />
              )}
              {(d.status === 'error' || d.status === 'interrupted') && (
                <Timer className="w-4 h-4 text-red-400 flex-shrink-0" aria-hidden />
              )}
              <p className="flex-1 text-sm text-foreground truncate min-w-0">{d.title}</p>
              <span className="text-xs text-muted-foreground flex-shrink-0">
                {d.status === 'complete' && d.file_size
                  ? formatFileSize(d.file_size)
                  : d.status === 'downloading'
                    ? `${Math.round(d.progress)}%`
                    : ''}
              </span>
              <div className="flex gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                {d.status === 'downloading' && (
                  <>
                    <ActionButton icon={Pause} title="Pause" size="sm" onClick={() => actions.pause(d.id)} />
                    <ActionButton icon={Trash2} title="Delete with files" size="sm" onClick={() => actions.removeWithFiles(d.id)} />
                  </>
                )}
                {d.status === 'paused' && (
                  <>
                    <ActionButton icon={Play} title="Resume" size="sm" onClick={() => actions.retry(d.id)} />
                    <ActionButton icon={Trash2} title="Delete with files" size="sm" onClick={() => actions.removeWithFiles(d.id)} />
                  </>
                )}
                {d.status === 'complete' && d.file_path && (
                  <>
                    <ActionButton icon={FolderOpen} title="Open folder" size="sm" onClick={() => actions.openFolder(d.file_path!)} />
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
          ))}
          {hasMore && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full h-11 flex items-center pl-14 pr-4 text-xs text-muted-foreground hover:text-foreground hover:bg-control transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              ... and {moreCount} more videos
            </button>
          )}
        </div>
      )}
    </div>
    </>
  )
}
