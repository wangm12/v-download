import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Download } from '@/types'
import type { SelectionModifiers } from '@/utils/selection'
import { PlaylistDownloadRow } from './PlaylistDownloadRow'

const ROW_HEIGHT = 60
const OVERSCAN_ROWS = 8

interface VirtualizedPlaylistItemsProps {
  downloads: Download[]
  selectedIds: ReadonlySet<string>
  onSelectDownload: (id: string, modifiers?: SelectionModifiers) => void
  ariaLabel: string
}

export const VirtualizedPlaylistItems = memo(function VirtualizedPlaylistItems({
  downloads,
  selectedIds,
  onSelectDownload,
  ariaLabel
}: VirtualizedPlaylistItemsProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(360)

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
    if (!node || frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      setScrollTop(node.scrollTop)
    })
  }, [])

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    },
    []
  )

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS)
  const last = Math.min(
    downloads.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN_ROWS
  )
  const visibleDownloads = useMemo(
    () => downloads.slice(first, last),
    [downloads, first, last]
  )

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="max-h-[420px] min-h-[160px] overflow-y-auto overscroll-contain"
      aria-label={ariaLabel}
    >
      <div className="relative w-full" style={{ height: downloads.length * ROW_HEIGHT }}>
        {visibleDownloads.map((download, offset) => {
          const index = first + offset
          return (
            <div
              key={download.id}
              className="absolute left-0 right-0"
              style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
            >
              <PlaylistDownloadRow
                download={download}
                displayIndex={index + 1}
                selected={selectedIds.has(download.id)}
                onSelectDownload={onSelectDownload}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
})
