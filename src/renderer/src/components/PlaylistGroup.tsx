import { memo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  ListVideo,
  Folder,
  Trash2,
  Pause,
  Play
} from 'lucide-react'
import type { Playlist } from '@/types'
import { useDownloadActions } from '@/contexts/DownloadActionsContext'
import { PlaylistDeleteDialog } from './PlaylistDeleteDialog'
import { HoverHintWrap } from './HoverHintWrap'
import { formatSpeed, parseSpeedToBytes } from '@/utils/format'
import { ThumbnailImage } from './ThumbnailImage'
import { PlaylistDownloadRow } from './PlaylistDownloadRow'
import { VirtualizedPlaylistItems } from './VirtualizedPlaylistItems'
import {
  COLLECTION_PREVIEW_LIMIT,
  COLLECTION_VISIBLE_LIMIT,
  getCollectionPresentation
} from './playlistGroupPresentation'
import type { PlaylistViewState } from '@/utils/queueSelection'
import type { SelectionModifiers } from '@/utils/selection'

const INNER_VIRTUALIZATION_THRESHOLD = 40

interface PlaylistGroupProps {
  playlist: Playlist
  selected: boolean
  selectedIds: ReadonlySet<string>
  onSelectDownload: (id: string, modifiers?: SelectionModifiers) => void
  onSelectPlaylist: (id: string, modifiers?: SelectionModifiers) => void
  viewState: PlaylistViewState
  onViewStateChange: (playlistId: string, state: PlaylistViewState) => void
}

export const PlaylistGroup = memo(function PlaylistGroup({
  playlist,
  selected,
  selectedIds,
  onSelectDownload,
  onSelectPlaylist,
  viewState,
  onViewStateChange
}: PlaylistGroupProps) {
  const actions = useDownloadActions()
  const downloads = playlist.downloads ?? []
  const expanded = viewState.expanded
  const showAll = viewState.showAll
  const updateViewState = (patch: Partial<PlaylistViewState>) =>
    onViewStateChange(playlist.id, { ...viewState, ...patch })
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const visibleDownloads = showAll
    ? downloads
    : downloads.slice(0, COLLECTION_VISIBLE_LIMIT)
  const hasMore = downloads.length > COLLECTION_VISIBLE_LIMIT && !showAll
  const moreCount = downloads.length - COLLECTION_VISIBLE_LIMIT

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
  const isComplete = statusLabel === 'Complete'

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
        className={`mx-1 mb-1 overflow-hidden rounded-panel bg-background ring-1 ring-inset ring-divider-subtle [content-visibility:auto] [contain-intrinsic-size:180px] ${
          selected ? 'bg-selection ring-accent/45' : ''
        }`}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div
          className={selected ? 'bg-state-active-bg px-4 py-3' : 'bg-background px-4 py-3'}
          onClick={(event) => {
            const target = event.target
            if (target instanceof HTMLElement && target.closest('button')) return
            onSelectPlaylist(playlist.id, event)
          }}
        >
          <div className="flex flex-wrap items-start gap-3">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={`playlist-items-${playlist.id}`}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${playlist.title}`}
              onClick={() => {
                const next = !expanded
                updateViewState({ expanded: next, ...(next ? {} : { showAll: false }) })
              }}
              className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-control hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              {expanded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )}
            </button>
            <div className="w-10 h-10 rounded-md flex items-center justify-center bg-control text-foreground flex-shrink-0 ring-1 ring-inset ring-divider-subtle">
              {isProfileGroup ? (
                <Folder className="w-4 h-4" aria-hidden />
              ) : (
                <ListVideo className="w-4 h-4" aria-hidden />
              )}
            </div>
            <div
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={`${selected ? 'Selected' : 'Select'} ${playlist.title}; ${downloads.length} downloads`}
              onClick={(event) => {
                event.stopPropagation()
                onSelectPlaylist(playlist.id, event)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onSelectPlaylist(playlist.id)
              }}
              className="min-w-0 flex-1 cursor-pointer rounded-md pt-0.5 outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
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
                <span
                  className={
                    isComplete
                      ? 'inline-flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success'
                      : 'rounded-full bg-control px-2 py-0.5 text-foreground'
                  }
                >
                  {isComplete && (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground"
                      aria-hidden
                    />
                  )}
                  {statusLabel}
                </span>
              </div>
            </div>
            <div className="order-last flex basis-full min-w-0 items-center gap-2 pt-2 sm:order-none sm:basis-auto sm:min-w-[8rem] sm:pt-1">
              <div className="flex flex-col items-end gap-0.5 flex-1 min-w-0">
                <div className="w-full h-1.5 rounded-full bg-control overflow-hidden">
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
                  updateViewState({ expanded: next, ...(next ? {} : { showAll: false }) })
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
            {showAll && downloads.length > INNER_VIRTUALIZATION_THRESHOLD ? (
              <VirtualizedPlaylistItems
                downloads={downloads}
                selectedIds={selectedIds}
                onSelectDownload={onSelectDownload}
                ariaLabel={`${playlist.title} items`}
              />
            ) : (
              visibleDownloads.map((d, idx) => (
                <PlaylistDownloadRow
                  key={d.id}
                  download={d}
                  displayIndex={idx + 1}
                  selected={selectedIds.has(d.id)}
                  onSelectDownload={onSelectDownload}
                />
              ))
            )}
            {hasMore && (
              <button
                type="button"
                onClick={() => updateViewState({ showAll: true })}
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
})
