import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { extractUrlFromDataTransfer } from '@/utils/dragUrl'

interface QueueToolbarProps {
  searchQuery: string
  onSearchQuery: (q: string) => void
  onDropUrl: (url: string) => void
}

export function QueueToolbar({ searchQuery, onSearchQuery, onDropUrl }: QueueToolbarProps) {
  const [dragOver, setDragOver] = useState(false)
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [toolbarRowWidth, setToolbarRowWidth] = useState(0)
  const toolbarRowRef = useRef<HTMLDivElement>(null)
  const searchShellRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  /** px ↔ px width transition (ResizeObserver); %/rem mixes often skip interpolation in Chromium. */
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

  /** Keep in sync with `gap-2` on the toolbar row (0.5rem → 8px at default root). */
  const rowGapPx = 8

  return (
    <div
      className="shrink-0 flex flex-col gap-2 px-3 py-3 border-b border-border bg-window"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <div ref={toolbarRowRef} className="flex w-full min-h-[42px] items-stretch gap-2">
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={cn(
            'rounded-panel border border-dashed px-3 py-2.5 text-center text-xs text-muted-foreground',
            'min-w-0 flex-1 flex items-center justify-center',
            dragOver ? 'border-border-focus bg-state-active-bg text-foreground' : 'border-border-strong bg-control'
          )}
        >
          <span className="line-clamp-2">
            Drop a link here or press <span className="text-foreground font-medium">Cmd+V</span> to paste from the
            clipboard
          </span>
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
                'w-full min-w-0 flex items-center justify-center rounded-lg border border-border bg-raised',
                'text-tertiary-foreground hover:text-foreground hover:bg-elevated hover:border-border-focus',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus',
                'transition-colors duration-200'
              )}
              aria-label="Search downloads"
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
                  'w-full min-w-0 pl-9 pr-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground',
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
    </div>
  )
}
