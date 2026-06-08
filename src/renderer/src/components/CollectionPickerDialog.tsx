import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, Loader2, Download, CheckSquare, Square } from 'lucide-react'
import type { PlaylistEntryRow, PlaylistListResult, SettingsData } from '@/types'
import { cn } from '@/lib/cn'
import { HoverHintWrap } from './HoverHintWrap'
import { EntryThumbnail } from './EntryThumbnail'
import { formatDuration } from '@/utils/format'
import { collectionPickerLabel } from '@/utils/collectionPicker'

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

  const toggle = (key: string) => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  }

  const selectAll = () => {
    if (selected.size === items.length) setSelected(new Set())
    else setSelected(new Set(items.map(rowKey)))
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div className="w-[min(720px,94vw)] max-h-[min(640px,90vh)] bg-background rounded-xl overflow-hidden shadow-2xl flex flex-col">
        <div className="bg-elevated px-5 py-4 flex items-start justify-between gap-3 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">{headerTitle}</h2>
            <p className="text-[11px] text-muted-foreground mt-1 break-all line-clamp-2">{sourceUrl}</p>
          </div>
          <HoverHintWrap text="Close" side="bottom">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-control shrink-0"
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
                <div className="rounded-lg border border-border bg-raised px-3 py-2 text-sm text-foreground mb-3">
                  {error}
                </div>
              ) : null}
              <p className="text-sm text-muted-foreground py-8 text-center">No videos found.</p>
            </>
          ) : (
            <>
              {error ? (
                <div className="rounded-lg border border-border bg-raised px-3 py-2 text-sm text-foreground mb-3">
                  {error}
                </div>
              ) : null}
              {countSummary ? (
                <div
                  role="status"
                  className="mb-3 rounded-lg border border-border bg-raised px-3 py-2.5 text-sm leading-snug text-foreground"
                >
                  <span className="font-medium tabular-nums">{countSummary}</span>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2 pb-2 border-b border-border">
                <button
                  type="button"
                  onClick={selectAll}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border text-xs font-medium hover:bg-control"
                >
                  {selected.size === items.length ? <CheckSquare size={14} /> : <Square size={14} />}
                  {selected.size === items.length ? 'Deselect all' : 'Select all'}
                </button>
                <button
                  type="button"
                  onClick={openInBrowser}
                  className="px-2.5 py-1 rounded-lg border border-border text-xs font-medium hover:bg-control"
                >
                  Open in browser
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto mt-2 space-y-1">
                {items.map((row) => {
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
                      onClick={() => toggle(key)}
                      className={cn(
                        'w-full flex gap-3 items-center text-left rounded-lg border px-2 py-2 transition-colors',
                        isOn ? 'border-foreground/40 bg-elevated' : 'border-transparent hover:bg-elevated/60'
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
                })}
              </div>
            </>
          )}
        </div>

        <div className="border-t border-border bg-elevated px-5 py-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-control"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={selected.size === 0 || busy || loading}
            onClick={() => void handleDownload()}
            className={cn(
              'inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold',
              selected.size === 0 || busy || loading
                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                : 'bg-action text-action-fg hover:bg-action-hover'
            )}
          >
            <Download size={16} />
            Add {selected.size} to queue
          </button>
        </div>
      </div>
    </div>
  )
}
