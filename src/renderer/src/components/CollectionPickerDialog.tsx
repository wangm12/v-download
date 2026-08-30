import { useCallback, useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { X, Loader2, Download, CheckSquare, Square } from 'lucide-react'
import type { PlaylistEntryRow, PlaylistListResult, SettingsData } from '@/types'
import { cn } from '@/lib/cn'
import { HoverHintWrap } from './HoverHintWrap'
import { EntryThumbnail } from './EntryThumbnail'
import { formatDuration } from '@/utils/format'
import { collectionPickerLabel } from '@/utils/collectionPicker'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { applySelectionClick, clearSelection, isSelectAllShortcut, selectAllInOrder } from '@/utils/selection'
import { AnimatedList } from './reactbits/AnimatedList'
import { DialogShell } from './ui'

export interface CollectionPickerDialogProps {
  sourceUrl: string
  settings: SettingsData
  onClose: () => void
}

export function CollectionPickerDialog({ sourceUrl, settings, onClose }: CollectionPickerDialogProps) {
  const [list, setList] = useState<PlaylistListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null)
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose)

  const platformLabel = useMemo(() => collectionPickerLabel(sourceUrl), [sourceUrl])

  const items = list?.items ?? []

  const headerTitle = useMemo(() => {
    const name = list?.playlistTitle?.trim()
    if (name) return `${name} — pick videos`
    return `${platformLabel} — pick videos`
  }, [list?.playlistTitle, platformLabel])

  const countSummary = useMemo(() => {
    if (loading || items.length === 0) return ''
    const n = items.length
    return `${n} video${n !== 1 ? 's' : ''} loaded — end of list`
  }, [loading, items.length])

  const loadList = useCallback(async () => {
    if (!window.api?.listPlaylistEntries) throw new Error('listPlaylistEntries is not available')
    const res = await window.api.listPlaylistEntries(sourceUrl)
    if (res?.error) throw new Error(res.error)
    const data = res?.data as PlaylistListResult | undefined
    if (!data?.items?.length) throw new Error('No videos found')
    return data
  }, [sourceUrl])

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      setError('')
      setList(null)
      setSelected(new Set())
      setSelectionAnchor(null)
      try {
        const data = await loadList()
        if (!alive) return
        setList(data)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [sourceUrl, loadList])

  const rowKey = (row: PlaylistEntryRow) => row.pageUrl || row.id

  const orderedKeys = items.map(rowKey)

  const selectItem = (key: string, modifiers: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {}) => {
    const next = applySelectionClick(orderedKeys, selected, selectionAnchor, key, modifiers)
    setSelected(next.selected)
    setSelectionAnchor(next.anchor)
  }

  const selectAll = () => {
    if (selected.size === items.length) {
      const next = clearSelection<string>()
      setSelected(next.selected)
      setSelectionAnchor(next.anchor)
      return
    }
    const next = selectAllInOrder(orderedKeys, selectionAnchor)
    setSelected(next.selected)
    setSelectionAnchor(next.anchor)
  }

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isSelectAllShortcut(event)) return
    event.preventDefault()
    event.stopPropagation()
    const next = selectAllInOrder(orderedKeys, selectionAnchor)
    setSelected(next.selected)
    setSelectionAnchor(next.anchor)
  }

  const handleDownload = async () => {
    const rows = items.filter((i) => selected.has(rowKey(i)))
    if (rows.length === 0 || !window.api?.startDownloadsBulk || !list) return
    setBusy(true)
    setError('')
    try {
      const folderName = list.playlistTitle.trim() || list.playlistChannel.trim() || 'Playlist'
      const tasks = rows.map((r, i) => ({
        url: r.pageUrl,
        title: r.title.slice(0, 200),
        format: 'video' as const,
        quality: settings.defaultVideoQuality,
        thumbnail: r.thumbnail || undefined,
        duration: r.duration ?? 0,
        playlistId: folderName,
        playlistIndex: r.playlistIndex ?? i + 1,
        playlistTitle: folderName,
        metadata: {
          channel: r.channel || list.playlistChannel || undefined
        }
      }))
      const res = await window.api.startDownloadsBulk(tasks)
      if (res.error) {
        setError(res.error)
        return
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const openInBrowser = () => {
    if (window.api?.openExternalUrl) {
      void window.api.openExternalUrl(sourceUrl)
      return
    }
    window.open(sourceUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" role="presentation">
      <DialogShell ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="collection-picker-title" className="w-[min(720px,94vw)] max-h-[min(640px,90vh)] bg-background shadow-2xl flex flex-col outline-none" onKeyDownCapture={handleDialogKeyDown}>
        <div className="bg-elevated px-5 py-4 flex items-start justify-between gap-3 border-b border-divider-subtle">
          <div className="min-w-0">
            <h2 id="collection-picker-title" className="text-sm font-semibold text-foreground">{headerTitle}</h2>
            <p className="text-[11px] text-muted-foreground mt-1 break-all line-clamp-2">{sourceUrl}</p>
          </div>
          <HoverHintWrap text="Close" side="bottom">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="h-11 w-11 rounded-md text-muted-foreground hover:text-foreground hover:bg-control shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              <X size={18} />
            </button>
          </HoverHintWrap>
        </div>

        <div className="flex-1 min-h-0 flex flex-col px-5 py-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
              <Loader2 className="animate-spin" size={28} />
              <span className="text-sm">Loading video list…</span>
            </div>
          ) : items.length === 0 ? (
            <>
              {error ? (
                <div className="rounded-button border border-dashed border-border-strong bg-state-error-bg px-3 py-2 text-sm text-foreground mb-3">
                  {error}
                </div>
              ) : null}
              <p className="text-sm text-muted-foreground py-8 text-center">No videos found.</p>
            </>
          ) : (
            <>
              {error ? (
                <div className="rounded-button border border-dashed border-border-strong bg-state-error-bg px-3 py-2 text-sm text-foreground mb-3">
                  {error}
                </div>
              ) : null}
              {countSummary ? (
                <div
                  role="status"
                  className="mb-3 rounded-button bg-control px-3 py-2.5 text-sm leading-snug text-foreground"
                >
                  <span className="font-medium tabular-nums">{countSummary}</span>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2 pb-2 border-b border-divider-subtle">
                <button
                  type="button"
                  onClick={selectAll}
                  className="inline-flex min-h-11 items-center gap-1.5 px-2.5 py-1 rounded-button bg-control text-xs font-medium hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                >
                  {selected.size === items.length ? <CheckSquare size={14} /> : <Square size={14} />}
                  {selected.size === items.length ? 'Deselect all' : 'Select all'}
                </button>
                <button
                  type="button"
                  onClick={openInBrowser}
                  className="min-h-11 px-2.5 py-1 rounded-button bg-control text-xs font-medium hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                >
                  Open in browser
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto mt-2">
                <AnimatedList items={items} getKey={(row) => rowKey(row)}>
                  {(row) => {
                  const key = rowKey(row)
                  const isOn = selected.has(key)
                  const meta = [
                    row.channel || list?.playlistChannel,
                    row.duration > 0 ? formatDuration(row.duration) : ''
                  ]
                    .filter(Boolean)
                    .join(' · ')
                  return (
                    <button
                      type="button"
                      key={key}
                      onClick={(event) => selectItem(key, event)}
                      data-selected={isOn}
                      className={cn(
                        'v-list-row w-full flex gap-3 items-center text-left rounded-lg px-2 py-2 transition-colors',
                        isOn ? 'bg-selection' : 'hover:bg-surface-hover'
                      )}
                    >
                      <div className="w-14 h-14 rounded-md overflow-hidden bg-surface shrink-0">
                        <EntryThumbnail
                          pageUrl={row.pageUrl}
                          thumbnail={row.thumbnail}
                          referer={row.pageUrl || sourceUrl}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground line-clamp-2">{row.title}</p>
                        {meta ? (
                          <p className="text-[11px] text-muted-foreground mt-0.5">{meta}</p>
                        ) : null}
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0 font-mono max-w-[88px] truncate">
                        {row.id}
                      </span>
                    </button>
                  )
                }}
                </AnimatedList>
              </div>
            </>
          )}
        </div>

        <div className="border-t border-divider-subtle bg-elevated px-5 py-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 px-3 py-1.5 rounded-button bg-control text-sm text-muted-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={selected.size === 0 || busy || loading}
            onClick={() => void handleDownload()}
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
              selected.size === 0 || busy || loading
                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                : 'bg-action text-action-fg hover:bg-action-hover'
            )}
          >
            <Download size={16} />
            Add {selected.size} to queue
          </button>
        </div>
      </DialogShell>
    </div>
  )
}
