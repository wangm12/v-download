import { useCallback, useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { X, Loader2, Download, CheckSquare, Square, ExternalLink } from 'lucide-react'
import type { QueueNotice } from '@v-download/shared'
import type { PlaylistEntryRow, PlaylistListResult, SettingsData } from '@/types'
import { EntryThumbnail } from './EntryThumbnail'
import { formatDuration } from '@/utils/format'
import { collectionPickerLabel } from '@/utils/collectionPicker'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { applySelectionClick, clearSelection, isSelectAllShortcut, selectAllInOrder } from '@/utils/selection'
import { AnimatedList } from './reactbits/AnimatedList'
import { useTranslation } from 'react-i18next'
import { DialogShell } from './ui'

export interface CollectionPickerDialogProps {
  sourceUrl: string
  settings: SettingsData
  onClose: () => void
  onQueued?: (payload: { skipped?: number; notice?: QueueNotice; ids?: string[] }) => void
}

export function CollectionPickerDialog({ sourceUrl, settings, onClose, onQueued }: CollectionPickerDialogProps) {
  const { t } = useTranslation()
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
    return t('collection.pickVideos', { name: name || platformLabel })
  }, [list?.playlistTitle, platformLabel, t])


  const loadList = useCallback(async () => {
    if (!window.api?.listPlaylistEntries) throw new Error('listPlaylistEntries is not available')
    const res = await window.api.listPlaylistEntries(sourceUrl)
    if (res?.error) throw new Error(res.error)
    const data = res?.data as PlaylistListResult | undefined
    if (!data) throw new Error('No list data returned')
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
      onQueued?.({ skipped: res.data?.skipped, notice: res.data?.notice, ids: res.data?.ids })
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="presentation">
      <DialogShell ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="collection-picker-title"
        className="flex h-[min(640px,calc(100dvh-32px))] w-[min(720px,calc(100vw-32px))] flex-col outline-none" onKeyDownCapture={handleDialogKeyDown}>
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-divider-subtle px-5 py-4">
          <div className="min-w-0"><p className="mb-1 text-xs text-muted-foreground">{platformLabel}</p><h2 id="collection-picker-title" className="line-clamp-2 text-base font-semibold">{headerTitle}</h2></div>
          <button type="button" onClick={onClose} aria-label={t('collection.close')} className="v-button-ghost h-9 w-9 !p-0"><X className="h-4 w-4" aria-hidden /></button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col px-5 py-3">
          {loading ? <div role="status" className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" aria-hidden />{t('collection.loading')}</div> : <>
            {error && <div role="alert" className="mb-3 shrink-0 text-xs text-error">{error}</div>}
            <div className="flex shrink-0 items-center justify-between gap-2 pb-3">
              <p role="status" className="text-xs tabular-nums text-muted-foreground">{t(error && items.length === 0 ? 'ui.loadFailed' : items.length === 0 ? 'ui.loadedEmpty' : 'ui.loadedComplete', { count: items.length })}</p>
              {items.length > 0 && <button type="button" onClick={selectAll} className="v-button-ghost !min-h-8 !px-2 !py-1">
                {selected.size === items.length ? <CheckSquare className="h-4 w-4" aria-hidden /> : <Square className="h-4 w-4" aria-hidden />}{t(selected.size === items.length ? 'collection.deselectAll' : 'collection.selectAll')}
              </button>}
            </div>
            {items.length === 0 ? <p className="flex min-h-0 flex-1 items-center justify-center py-6 text-sm text-muted-foreground">{t('collection.noVideos')}</p>
              : <div className="min-h-0 flex-1 overflow-y-auto">
                <AnimatedList items={items} getKey={rowKey}>
                  {(row) => {
                    const key = rowKey(row)
                    const isOn = selected.has(key)
                    return <div data-selected={isOn} className="v-list-row mb-1 flex items-center gap-3 rounded-button pl-3">
                      <input type="checkbox" checked={isOn} aria-label={t('ui.chooseNamed', { title: row.title })}
                        onChange={() => selectItem(key, { ctrlKey: true })} className="h-[18px] w-[18px] shrink-0 cursor-pointer accent-action" />
                      <button type="button" onClick={(event) => selectItem(key, event)} aria-pressed={isOn} className="flex min-h-[76px] min-w-0 flex-1 items-center gap-3 rounded-button py-2 pr-3 text-left">
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-control"><EntryThumbnail pageUrl={row.pageUrl} thumbnail={row.thumbnail} referer={row.pageUrl || sourceUrl} /></div>
                        <div className="min-w-0 flex-1"><p className="line-clamp-2 text-[13px] font-medium leading-5">{row.title}</p>{row.duration > 0 && <p className="mt-1 text-xs text-muted-foreground">{formatDuration(row.duration)}</p>}</div>
                      </button>
                    </div>
                  }}
                </AnimatedList>
              </div>}
          </>}
        </div>
        <footer className="shrink-0 border-t border-divider-subtle bg-surface px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{selected.size === 0 ? t('ui.selectPrompt') : t('ui.keyboardHint')}</p>
            <div className="flex items-center gap-2"><button type="button" onClick={onClose} className="v-button-ghost">{t('common.cancel')}</button>
              <button type="button" disabled={selected.size === 0 || busy || loading} onClick={() => void handleDownload()} className="v-button-primary"><Download className="h-4 w-4" aria-hidden />{t('ui.downloadCount', { count: selected.size })}</button>
            </div>
          </div>
          <button type="button" onClick={openInBrowser} className="v-button-ghost mt-1 !min-h-8 !px-0 !py-1" title={sourceUrl}><ExternalLink className="h-3.5 w-3.5" aria-hidden />{t('collection.openBrowser')}</button>
        </footer>
      </DialogShell>
    </div>
  )
}
