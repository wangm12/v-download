import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  ListVideo,
  Folder,
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
import { formatFileSize, formatSpeed, parseSpeedToBytes } from '@/utils/format'
import { cn } from '@/lib/cn'
import { ThumbnailImage } from './ThumbnailImage'
import {
  COLLECTION_PREVIEW_LIMIT,
  COLLECTION_VISIBLE_LIMIT,
  getCollectionPresentation
} from './playlistGroupPresentation'

const VISIBLE_ITEMS = COLLECTION_VISIBLE_LIMIT

interface PlaylistGroupProps {
  playlist: Playlist
  selectedId: string | null
  onSelectDownload: (id: string) => void
}

export function PlaylistGroup({
  playlist,
  selectedId,
  onSelectDownload
}: PlaylistGroupProps) {
  const actions = useDownloadActions()
  const downloads = playlist.downloads ?? []
  const [expanded, setExpanded] = useState(downloads.length <= VISIBLE_ITEMS)
  const [showAll, setShowAll] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const visibleDownloads = showAll
    ? downloads
    : downloads.slice(0, VISIBLE_ITEMS)
  const hasMore = downloads.length > VISIBLE_ITEMS && !showAll
  const moreCount = downloads.length - VISIBLE_ITEMS

  const progressPercent =
    playlist.total_count > 0
      ? (playlist.completed_count / playlist.total_count) * 100
      : 0

  const hasActiveItems = downloads.some(
    (d) => d.status === 'downloading' || d.status === 'queued'
  )
  const resumableItems = downloads.filter((d) =>
    ['paused', 'interrupted', 'error'].includes(d.status)
  )
  // Pause vs resume are mutually exclusive: a running batch may still have older error rows.
  const showPauseAll = hasActiveItems
  const showResumeAll = !hasActiveItems && resumableItems.length > 0
  const isProfileGroup = playlist.type === 'Douyin profile'
  const countLabel = isProfileGroup ? 'posts' : 'videos'

  const downloadingItems = downloads.filter((d) => d.status === 'downloading')
  const aggregateSpeedBytes = downloadingItems.reduce(
    (sum, d) => sum + (d.speed ? parseSpeedToBytes(d.speed) : 0),
    0
  )
  const speedLabel =
    aggregateSpeedBytes > 0 ? formatSpeed(aggregateSpeedBytes) : null
  const etaLabel =
    downloadingItems.length === 1 &&
    downloadingItems[0]?.eta &&
    downloadingItems[0].eta !== '00:00' &&
    downloadingItems[0].eta !== '0:00'
      ? downloadingItems[0].eta
      : null

  const representativeDownloads = downloads.slice(0, COLLECTION_PREVIEW_LIMIT)
  const {
    overflowCount,
    remaining: remainingCount,
    hasMoreItems
  } = getCollectionPresentation(
    playlist.total_count,
    playlist.completed_count,
    representativeDownloads.length
  )
  const hasErrors = downloads.some(
    (d) => d.status === 'error' || d.status === 'interrupted'
  )
  const statusLabel = hasErrors
    ? 'Needs attention'
    : remainingCount === 0
      ? 'Complete'
      : hasActiveItems
        ? 'In progress'
        : 'Queued'

  return (
    <>
      {deleteDialogOpen && (
        <PlaylistDeleteDialog
          playlistTitle={playlist.title}
          videoCount={downloads.length}
          onClose={() => setDeleteDialogOpen(false)}
          onRemoveListOnly={() => {
            actions.removeMany(downloads.map((d) => d.id))
          }}
          onRemoveWithFiles={() => {
            actions.removeManyWithFiles(downloads.map((d) => d.id))
          }}
        />
      )}
      <div
        className="mx-1 mb-1 rounded-lg border border-border overflow-hidden bg-background"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="bg-background px-4 py-3">
          <div className="flex flex-wrap items-start gap-3">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={`playlist-items-${playlist.id}`}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${playlist.title}`}
              onClick={() => {
                const next = !expanded
                setExpanded(next)
                if (!next) setShowAll(false)
              }}
              className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-control hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              {expanded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )}
            </button>
            <div className="w-10 h-10 rounded-md flex items-center justify-center bg-control text-foreground flex-shrink-0 border border-border">
              {isProfileGroup ? (
                <Folder className="w-4 h-4" aria-hidden />
              ) : (
                <ListVideo className="w-4 h-4" aria-hidden />
              )}
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <p className="text-sm font-semibold text-foreground truncate">
                {playlist.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {playlist.type} · {playlist.total_count} {countLabel}
                {playlist.output_dir ? ` · ${playlist.output_dir}` : ''}
              </p>
              <div
                className="mt-2 flex items-center gap-2"
                aria-label={`${representativeDownloads.length} preview thumbnails`}
              >
                {representativeDownloads.map((d) => (
                  <ThumbnailImage
                    key={d.id}
                    src={d.thumbnail}
                    referer={d.url}
                    alt=""
                    className="h-9 w-12 rounded object-cover"
                    placeholderClassName="h-9 w-12 rounded bg-control"
                  />
                ))}
                {overflowCount > 0 && (
                  <span className="flex h-9 min-w-9 items-center justify-center rounded bg-control px-1 text-[11px] text-muted-foreground">
                    +{overflowCount}
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{playlist.completed_count} completed</span>
                <span>{remainingCount} remaining</span>
                <span className="rounded border border-border px-1.5 py-0.5 text-foreground">
                  {statusLabel}
                </span>
              </div>
            </div>
            <div className="order-last flex basis-full min-w-0 items-center gap-2 pt-2 sm:order-none sm:basis-auto sm:min-w-[8rem] sm:pt-1">
              <div className="flex flex-col items-end gap-0.5 flex-1 min-w-0">
                <div className="w-full h-1.5 rounded-full bg-control overflow-hidden border border-border/50">
                  <div
                    className="h-full rounded-full bg-progress transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                  <span>
                    {playlist.completed_count}/{playlist.total_count}
                  </span>
                  {speedLabel ? (
                    <span className="text-foreground/80">{speedLabel}</span>
                  ) : null}
                  {etaLabel ? <span>ETA {etaLabel}</span> : null}
                </div>
              </div>
              {showResumeAll && (
                <HoverHintWrap
                  text="Resume all"
                  side="bottom"
                  className="[&>button]:h-11 [&>button]:w-11 [&>button]:p-0"
                >
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
              {showPauseAll && (
                <HoverHintWrap
                  text="Pause all"
                  side="bottom"
                  className="[&>button]:h-11 [&>button]:w-11 [&>button]:p-0"
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      downloads
                        .filter(
                          (d) =>
                            d.status === 'downloading' || d.status === 'queued'
                        )
                        .forEach((d) => actions.pause(d.id))
                    }}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-control transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                    aria-label="Pause all"
                  >
                    <Pause className="w-4 h-4" aria-hidden />
                  </button>
                </HoverHintWrap>
              )}
              <HoverHintWrap
                text="Remove playlist"
                side="bottom"
                className="[&>button]:h-11 [&>button]:w-11 [&>button]:p-0"
              >
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
            {hasMoreItems && (
              <button
                type="button"
                onClick={() => {
                  const next = !expanded
                  setExpanded(next)
                  if (!next) setShowAll(false)
                }}
                className="order-last h-11 basis-full rounded-md border border-border px-3 text-xs text-muted-foreground hover:bg-control hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus sm:order-none sm:basis-auto"
              >
                {expanded ? 'Hide items' : 'Show items'}
              </button>
            )}
          </div>
        </div>

        {expanded && (
          <div
            id={`playlist-items-${playlist.id}`}
            className="bg-background border-t border-border/50"
            aria-label={`${playlist.title} items`}
          >
            {visibleDownloads.map((d, idx) => (
              <div
                key={d.id}
                onDoubleClick={() => {
                  if (d.status === 'complete' && d.file_path)
                    actions.openFile(d.file_path)
                }}
                className={cn(
                  'min-h-[56px] flex items-center gap-3 pl-3 pr-4 mx-1 mb-1 rounded-md border transition-colors',
                  selectedId === d.id
                    ? 'bg-state-active-bg border-white/[0.18]'
                    : 'border-transparent hover:bg-control'
                )}
              >
                <span className="w-5 text-xs text-tertiary-foreground flex-shrink-0 text-right">
                  {d.playlist_index ?? idx + 1}.
                </span>
                <button
                  type="button"
                  aria-pressed={selectedId === d.id}
                  onClick={() => onSelectDownload(d.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                  aria-label={`${selectedId === d.id ? 'Selected' : 'Select'} ${d.title}; status ${d.status}`}
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
                    <CircleCheckBig
                      className="w-4 h-4 text-emerald-400 flex-shrink-0"
                      aria-hidden
                    />
                  )}
                  {d.status === 'downloading' && (
                    <Loader
                      className="w-4 h-4 text-foreground animate-spin flex-shrink-0"
                      aria-hidden
                    />
                  )}
                  {d.status === 'paused' && (
                    <Pause
                      className="w-4 h-4 text-muted-foreground flex-shrink-0"
                      aria-hidden
                    />
                  )}
                  {(d.status === 'queued' || d.status === 'cancelled') && (
                    <Timer
                      className="w-4 h-4 text-muted-foreground flex-shrink-0"
                      aria-hidden
                    />
                  )}
                  {(d.status === 'error' || d.status === 'interrupted') && (
                    <Timer
                      className="w-4 h-4 text-red-400 flex-shrink-0"
                      aria-hidden
                    />
                  )}
                  <p className="flex-1 text-sm text-foreground truncate min-w-0">
                    {d.title}
                  </p>
                  <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums text-right min-w-[4.5rem]">
                    {d.status === 'complete' && d.file_size
                      ? formatFileSize(d.file_size)
                      : d.status === 'downloading'
                        ? [d.speed, `${Math.round(d.progress)}%`]
                            .filter(Boolean)
                            .join(' · ')
                        : ''}
                  </span>
                </button>
                <div
                  className="flex gap-1 flex-shrink-0 [&>span>button]:h-11 [&>span>button]:w-11 [&>span>button]:p-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  {d.status === 'downloading' && (
                    <>
                      <ActionButton
                        icon={Pause}
                        title="Pause"
                        size="sm"
                        onClick={() => actions.pause(d.id)}
                      />
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
                      <ActionButton
                        icon={Play}
                        title="Resume"
                        size="sm"
                        onClick={() => actions.retry(d.id)}
                      />
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
                      <ActionButton
                        icon={Trash2}
                        title="Remove"
                        size="sm"
                        onClick={() => actions.remove(d.id)}
                      />
                    </>
                  )}
                  {(d.status === 'interrupted' ||
                    d.status === 'error' ||
                    d.status === 'cancelled') && (
                    <>
                      <ActionButton
                        icon={RotateCcw}
                        title="Retry"
                        size="sm"
                        onClick={() => actions.retry(d.id)}
                      />
                      <ActionButton
                        icon={Trash2}
                        title="Remove"
                        size="sm"
                        onClick={() => actions.remove(d.id)}
                      />
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
