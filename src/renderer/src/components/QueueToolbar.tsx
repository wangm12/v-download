import { useState, useCallback } from 'react'
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

  return (
    <div
      className="shrink-0 flex flex-col gap-2 px-3 py-3 border-b border-border bg-window"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          'rounded-panel border border-dashed px-3 py-2.5 text-center text-xs text-muted-foreground transition-colors',
          dragOver ? 'border-border-focus bg-state-active-bg text-foreground' : 'border-border-strong bg-control'
        )}
      >
        Drop a link here or press <span className="text-foreground font-medium">Cmd+V</span> to paste from the
        clipboard
      </div>
      <div className="relative">
        <Search
          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-tertiary-foreground pointer-events-none"
          aria-hidden
        />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchQuery(e.target.value)}
          placeholder="Search downloads…"
          className="w-full pl-9 pr-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground placeholder:text-tertiary-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          aria-label="Search downloads"
        />
      </div>
    </div>
  )
}
