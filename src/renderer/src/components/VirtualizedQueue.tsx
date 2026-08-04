import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Download, Playlist } from '@/types'
import { DownloadItem } from './DownloadItem'
import { PlaylistGroup } from './PlaylistGroup'
import { getPlaylistSelectionId, resolvePlaylistViewState } from '@/utils/queueSelection'
import type { PlaylistViewState, PlaylistViewStateMap } from '@/utils/queueSelection'
import type { SelectionModifiers } from '@/utils/selection'

type QueueItem = Download | Playlist

const ROW_GAP = 4
const OVERSCAN_ROWS = 6
const DEFAULT_DOWNLOAD_HEIGHT = 106
const DEFAULT_PLAYLIST_HEIGHT = 190

function isPlaylist(item: QueueItem): item is Playlist {
  return 'downloads' in item && Array.isArray(item.downloads)
}

function estimatedHeight(item: QueueItem): number {
  return isPlaylist(item) ? DEFAULT_PLAYLIST_HEIGHT : DEFAULT_DOWNLOAD_HEIGHT
}

interface VirtualizedQueueProps {
  items: QueueItem[]
  selectedIds: ReadonlySet<string>
  onSelectDownload: (id: string, modifiers?: SelectionModifiers) => void
  onSelectPlaylist: (id: string, modifiers?: SelectionModifiers) => void
  playlistViewStates: PlaylistViewStateMap
  onPlaylistViewStateChange: (playlistId: string, state: PlaylistViewState) => void
}

export const VirtualizedQueue = memo(function VirtualizedQueue({
  items,
  selectedIds,
  onSelectDownload,
  onSelectPlaylist,
  playlistViewStates,
  onPlaylistViewStateChange
}: VirtualizedQueueProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const rowObserverRef = useRef<ResizeObserver | null>(null)
  const rowNodesRef = useRef(new Map<string, HTMLDivElement>())
  const heightsRef = useRef(new Map<string, number>())
  const scrollFrameRef = useRef<number | null>(null)
  const [heightVersion, setHeightVersion] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(720)

  const setRowRef = useCallback((key: string, node: HTMLDivElement | null) => {
    const previous = rowNodesRef.current.get(key)
    if (previous && previous !== node) rowObserverRef.current?.unobserve(previous)
    if (!node) {
      rowNodesRef.current.delete(key)
      return
    }
    rowNodesRef.current.set(key, node)
    rowObserverRef.current?.observe(node)
  }, [])

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      let changed = false
      for (const entry of entries) {
        const key = entry.target.getAttribute('data-queue-key')
        if (!key) continue
        const nextHeight = Math.max(1, Math.ceil(entry.contentRect.height))
        if (heightsRef.current.get(key) !== nextHeight) {
          heightsRef.current.set(key, nextHeight)
          changed = true
        }
      }
      if (changed) setHeightVersion((version) => version + 1)
    })
    rowObserverRef.current = observer
    rowNodesRef.current.forEach((node) => observer.observe(node))
    return () => {
      observer.disconnect()
      rowObserverRef.current = null
    }
  }, [])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportHeight(Math.max(1, Math.ceil(entry.contentRect.height)))
    })
    observer.observe(node)
    setViewportHeight(Math.max(1, node.clientHeight))
    return () => observer.disconnect()
  }, [])

  const onScroll = useCallback(() => {
    const node = scrollRef.current
    if (!node || scrollFrameRef.current !== null) return
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null
      setScrollTop(node.scrollTop)
    })
  }, [])

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
  }, [])

  const rows = useMemo(() => {
    let top = 8
    return items.map((item) => {
      const height = heightsRef.current.get(item.id) ?? estimatedHeight(item)
      const row = { item, top, height }
      top += height + ROW_GAP
      return row
    })
  }, [items, heightVersion])

  const findRowIndex = useCallback((offset: number) => {
    let low = 0
    let high = rows.length - 1
    let result = 0
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      if (rows[middle].top <= offset) {
        result = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    return result
  }, [rows])

  const first = rows.length === 0 ? 0 : Math.max(0, findRowIndex(scrollTop) - OVERSCAN_ROWS)
  const last = rows.length === 0
    ? 0
    : Math.min(rows.length, findRowIndex(scrollTop + viewportHeight) + OVERSCAN_ROWS + 1)
  const visibleRows = rows.slice(first, last)
  const totalHeight = rows.length > 0 ? rows[rows.length - 1].top + rows[rows.length - 1].height + 8 : 16

  return (
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="relative w-full" style={{ height: totalHeight }}>
        {visibleRows.map(({ item, top }) => (
          <div
            key={item.id}
            ref={(node) => setRowRef(item.id, node)}
            data-queue-key={item.id}
            className="absolute left-0 right-0"
            style={{ top }}
          >
            {isPlaylist(item) ? (
              <PlaylistGroup
                playlist={item}
                selected={selectedIds.has(getPlaylistSelectionId(item.id))}
                selectedIds={selectedIds}
                onSelectDownload={onSelectDownload}
                onSelectPlaylist={onSelectPlaylist}
                viewState={resolvePlaylistViewState(item, playlistViewStates)}
                onViewStateChange={onPlaylistViewStateChange}
              />
            ) : (
              <DownloadItem
                download={item}
                selected={selectedIds.has(item.id)}
                onSelect={onSelectDownload}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
})
