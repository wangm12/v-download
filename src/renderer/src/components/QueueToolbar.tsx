import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { extractUrlFromDataTransfer } from '@/utils/dragUrl'
import type { QueueFilter } from '@/utils/queueFilters'

interface QueueToolbarProps {
  searchQuery: string
  onSearchQuery: (q: string) => void
  onDropUrl: (url: string) => void
  selectedCount?: number
  onClearSelection?: () => void
  focusSearchSignal?: number
  visibleCount: number
  attentionCount: number
  queueFilter: QueueFilter
  onQueueFilter: (filter: QueueFilter) => void
}

const FILTERS: Array<{ id: QueueFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'done', label: 'Done' },
  { id: 'attention', label: 'Needs attention' }
]

export function QueueToolbar({
  searchQuery,
  onSearchQuery,
  onDropUrl,
  selectedCount = 0,
  onClearSelection,
  focusSearchSignal,
  visibleCount,
  attentionCount,
  queueFilter,
  onQueueFilter
}: QueueToolbarProps) {
  const [dragOver, setDragOver] = useState(false)
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [toolbarRowWidth, setToolbarRowWidth] = useState(0)
  const toolbarRowRef = useRef<HTMLDivElement>(null)
  const searchShellRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    const el = toolbarRowRef.current
    if (!el) return
    const measure = () => {
      const w = el.getBoundingClientRect().width
      setToolbarRowWidth((prev) => (prev !== w ? w : prev))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const collapseSearch = useCallback(() => {
    setSearchExpanded(false)
  }, [])

  useEffect(() => {
    if (!searchExpanded) return
    const onPointerDownCapture = (e: PointerEvent) => {
      const shell = searchShellRef.current
      if (!shell) return
      if (!shell.contains(e.target as Node)) {
        collapseSearch()
      }
    }
    document.addEventListener('pointerdown', onPointerDownCapture, true)
    return () => document.removeEventListener('pointerdown', onPointerDownCapture, true)
  }, [searchExpanded, collapseSearch])

  const expandSearch = useCallback(() => {
    setSearchExpanded(true)
    queueMicrotask(() => {
      inputRef.current?.focus()
    })
  }, [])

  useEffect(() => {
    if (focusSearchSignal === undefined) return
    setSearchExpanded(true)
    queueMicrotask(() => {
      inputRef.current?.focus()
    })
  }, [focusSearchSignal])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }, [])

  const onDragLeave = useCallback(() => setDragOver(false), [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const url = extractUrlFromDataTransfer(e.dataTransfer)
      if (url) onDropUrl(url)
    },
    [onDropUrl]
  )

  const onSearchBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      const next = e.relatedTarget as Node | null
      if (next && searchShellRef.current?.contains(next)) return
      collapseSearch()
    },
    [collapseSearch]
  )

  const rowGapPx = 8

  return (
    <div
      className="shrink-0 flex flex-col gap-2 px-3 py-3 border-b border-divider-subtle bg-window"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <div className="flex min-w-0 items-end justify-between gap-3 px-0.5">
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold tracking-tight text-foreground">Downloads</h1>
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
            {visibleCount} {visibleCount === 1 ? 'item' : 'items'}
          </p>
        </div>
      </div>

      <div ref={toolbarRowRef} className="flex w-full min-h-[42px] items-stretch gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {FILTERS.map((filter) => {
            const active = queueFilter === filter.id
            return (
              <button
                key={filter.id}
                type="button"
                aria-pressed={active}
                onClick={() => onQueueFilter(filter.id)}
                className={cn(
                  'inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
                  active
                    ? 'bg-action text-action-fg'
                    : 'text-muted-foreground hover:bg-control hover:text-foreground'
                )}
              >
                {filter.label}
                {filter.id === 'attention' && attentionCount > 0 ? (
                  <span className="tabular-nums text-[11px]">{attentionCount}</span>
                ) : null}
              </button>
            )
          })}
        </div>

        <div
          ref={searchShellRef}
          className={cn(
            'shrink-0 min-w-0 box-border flex items-stretch overflow-hidden rounded-lg',
            'transition-[width] duration-panel ease-panel motion-reduce:transition-none'
          )}
          style={{
            width:
              searchExpanded && toolbarRowWidth > rowGapPx
                ? `${Math.max(0, (toolbarRowWidth - rowGapPx) / 2)}px`
                : 40
          }}
        >
          {!searchExpanded ? (
            <button
              type="button"
              onClick={expandSearch}
              className={cn(
                'w-full min-w-0 flex items-center justify-center rounded-lg bg-raised ring-1 ring-inset ring-divider-subtle',
                'text-tertiary-foreground hover:text-foreground hover:bg-elevated hover:ring-border-strong',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus',
                'transition-colors duration-200'
              )}
              aria-label="Search downloads"
              aria-keyshortcuts="Meta+F Control+F"
              aria-expanded={false}
            >
              <Search className="w-4 h-4 shrink-0" aria-hidden />
            </button>
          ) : (
            <div className="relative w-full min-w-0 animate-panel-fade-in motion-reduce:animate-none">
              <Search
                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-tertiary-foreground pointer-events-none z-10"
                aria-hidden
              />
              <input
                ref={inputRef}
                type="search"
                value={searchQuery}
                onChange={(e) => onSearchQuery(e.target.value)}
                onBlur={onSearchBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    collapseSearch()
                  }
                }}
                placeholder="Search downloads…"
                className={cn(
                  'w-full min-w-0 pl-9 pr-3 py-2 rounded-lg bg-raised ring-1 ring-inset ring-divider-subtle text-sm text-foreground',
                  'placeholder:text-tertiary-foreground',
                  'appearance-none shadow-none',
                  '[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-cancel-button]:hidden',
                  '[&::-webkit-search-decoration]:hidden',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus',
                  'transition-shadow duration-200'
                )}
                aria-label="Search downloads"
                aria-expanded
              />
            </div>
          )}
        </div>
      </div>

      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          'rounded-lg border border-dashed px-3 py-2.5 text-center text-xs text-muted-foreground',
          'min-w-0 flex items-center justify-center',
          dragOver ? 'border-border-strong bg-selection text-foreground' : 'border-divider-strong bg-control'
        )}
      >
        <span className="line-clamp-2">
          Drop a link here or press <span className="text-foreground font-medium">Cmd+V</span> to paste from the
          clipboard
        </span>
      </div>
      {selectedCount > 0 && (
        <div className="flex min-h-8 items-center justify-between gap-3 rounded-lg bg-selection px-2.5 py-1.5 text-xs ring-1 ring-inset ring-border-strong" role="status" aria-live="polite">
          <span className="font-medium text-foreground tabular-nums">{selectedCount} selected</span>
          {onClearSelection && (
            <button
              type="button"
              onClick={onClearSelection}
              className="inline-flex min-h-7 items-center gap-1 rounded-md px-1.5 text-muted-foreground hover:bg-elevated hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  )
}
