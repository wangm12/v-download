import { useState } from 'react'
import { X, Download, Globe, Link2 } from 'lucide-react'
import { HoverHintWrap } from './HoverHintWrap'

export interface DetectedMedia {
  url: string
  type: 'hls' | 'mp4' | 'webm' | 'flv'
  size: number | null
  contentType: string | null
}

interface MediaPickerDialogProps {
  media: DetectedMedia[]
  pageUrl: string
  pageTitle?: string
  onClose: () => void
  onDownload: (items: DetectedMedia[]) => void
  queueCount?: number
  onSkipAll?: () => void
}

const TYPE_STYLES: Record<string, string> = {
  hls: 'bg-control text-foreground border border-border-strong',
  mp4: 'bg-control text-muted-foreground border border-border',
  webm: 'bg-control text-muted-foreground border border-border',
  flv: 'bg-control text-muted-foreground border border-border'
}

function getDisplayName(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const filename = pathname.split('/').pop()
    if (filename && filename.length > 0 && filename !== '/') {
      const decoded = decodeURIComponent(filename)
      return decoded.length > 55 ? decoded.substring(0, 52) + '...' : decoded
    }
  } catch {}
  return url.length > 55 ? url.substring(0, 52) + '...' : url
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

export function MediaPickerDialog({ media, pageUrl, pageTitle, onClose, onDownload, queueCount = 0, onSkipAll }: MediaPickerDialogProps) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set())

  const toggle = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const handleDownload = () => {
    const items = media.filter((_, i) => selected.has(i))
    if (items.length > 0) onDownload(items)
  }

  const selectAll = () => {
    setSelected(new Set(media.map((_, i) => i)))
  }

  const deselectAll = () => {
    setSelected(new Set())
  }

  let pageDomain = ''
  try {
    pageDomain = new URL(pageUrl).hostname
  } catch {}

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-5" onClick={onClose}>
      <div
        className="w-[860px] max-w-[96vw] max-h-[86vh] overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-elevated px-5 py-4 flex items-center gap-3 border-b border-border">
          <div className="h-9 w-9 rounded-xl bg-control border border-border flex items-center justify-center flex-shrink-0">
            <Globe size={16} className="text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 min-w-0">
              <h2 className="text-[15px] font-semibold text-foreground truncate tracking-[-0.01em]">
                {pageTitle || 'Detected Media'}
              </h2>
              <span className="rounded-full border border-border-strong bg-control px-2.5 py-0.5 text-[11px] font-semibold text-foreground flex-shrink-0">
                {media.length} found
              </span>
            </div>
            {pageDomain && (
              <p className="text-[12px] text-muted-foreground mt-1 flex items-center gap-1.5">
                <Link2 size={12} />
                <span className="truncate">{pageDomain}</span>
              </p>
            )}
          </div>
          <HoverHintWrap text="Close" side="bottom">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-control transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              <X size={16} aria-hidden />
            </button>
          </HoverHintWrap>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 bg-surface/60 border-b border-border">
          <p className="text-[12px] text-muted-foreground">
            Choose the streams you want to queue. HLS entries are usually the best candidates.
          </p>
          <div className="flex items-center gap-2 text-[12px] flex-shrink-0">
            <button
              type="button"
              onClick={selectAll}
              className="rounded-md px-2.5 py-1.5 text-muted-foreground hover:bg-control hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={deselectAll}
              className="rounded-md px-2.5 py-1.5 text-muted-foreground hover:bg-control hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              Deselect all
            </button>
          </div>
        </div>

        <div className="max-h-[440px] overflow-y-auto px-3 py-3 space-y-1.5">
          {media.map((item, index) => (
            <label
              key={`${item.url}-${index}`}
              className={`group grid grid-cols-[24px_minmax(0,1fr)_76px_96px] items-center gap-3 rounded-xl border px-3 py-3 cursor-pointer transition-colors ${
                selected.has(index)
                  ? 'border-border-strong bg-elevated'
                  : 'border-transparent hover:border-border hover:bg-elevated/50'
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(index)}
                onChange={() => toggle(index)}
                className="h-4 w-4 accent-white cursor-pointer"
              />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground truncate" title={item.url}>
                  {getDisplayName(item.url)}
                </p>
                <div className="flex items-center gap-2 mt-1 min-w-0">
                  <span className="text-[11px] text-muted-foreground truncate max-w-[260px]">
                    {getDomain(item.url)}
                  </span>
                  {item.contentType && (
                    <span className="text-[11px] text-tertiary-foreground truncate">
                      {item.contentType}
                    </span>
                  )}
                </div>
              </div>
              <span className={`justify-self-start text-[10px] font-semibold uppercase px-2 py-1 rounded-md ${TYPE_STYLES[item.type] || 'bg-surface text-muted-foreground'}`}>
                {item.type}
              </span>
              <span className="justify-self-end text-[12px] text-muted-foreground tabular-nums">
                {item.size ? formatSize(item.size) : 'Unknown'}
              </span>
            </label>
          ))}
        </div>

        <div className="bg-elevated border-t border-border px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-foreground">
                {selected.size}/{media.length} selected
              </p>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Selected items will be added to the download queue.
              </p>
            </div>
            <button
              onClick={handleDownload}
              disabled={selected.size === 0}
              className="min-w-[180px] flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-action text-action-fg text-sm font-semibold hover:bg-action-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              <Download size={15} />
              Download {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          </div>
          {queueCount > 0 && (
            <div className="mt-3 flex items-center justify-between rounded-lg bg-control px-3 py-2">
              <span className="text-[12px] font-medium text-foreground">
                +{queueCount} more video{queueCount > 1 ? 's' : ''} queued
              </span>
              {onSkipAll && (
                <button
                  onClick={onSkipAll}
                  className="text-[12px] font-medium text-muted-foreground hover:text-foreground hover:underline"
                >
                  Skip all
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
