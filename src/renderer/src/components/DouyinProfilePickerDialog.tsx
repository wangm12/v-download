import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, CheckSquare, ChevronDown, Download, ExternalLink, Info, Loader2, Square, X } from 'lucide-react'
import type { QueueNotice } from '@v-download/shared'
import type { DouyinProfileListResult, DouyinProfilePostRow, SettingsData } from '@/types'
import { cn } from '@/lib/cn'
import { applyProfilePickerClick, mergeProfilePosts, selectedProfileCount } from './douyinProfilePickerState'
import { clearSelection, isSelectAllShortcut, selectAllInOrder } from '@/utils/selection'
import { AnimatedList } from './reactbits/AnimatedList'
import { useTranslation } from 'react-i18next'
import { DialogShell } from './ui'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { formatDuration } from '@/utils/format'
import { ThumbnailImage } from './ThumbnailImage'

const MAX_LOAD_ALL_PAGES = 50
const MAX_LOAD_ALL_ITEMS = 2000

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export interface DouyinProfilePickerDialogProps {
  profileUrl: string
  settings: SettingsData
  onClose: () => void
  onQueued?: (payload: { skipped?: number; notice?: QueueNotice; ids?: string[] }) => void
}

export function DouyinProfilePickerDialog({ profileUrl, settings, onClose, onQueued }: DouyinProfilePickerDialogProps) {
  const { t } = useTranslation()
  const [items, setItems] = useState<DouyinProfilePostRow[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [paginationBusy, setPaginationBusy] = useState(false)
  const [queueBusy, setQueueBusy] = useState(false)
  const [error, setError] = useState('')
  const [browserBusy, setBrowserBusy] = useState(false)
  const [loadAllBusy, setLoadAllBusy] = useState(false)
  const [loadAllNote, setLoadAllNote] = useState('')
  const [listWarning, setListWarning] = useState('')
  const [listRestricted, setListRestricted] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null)
  const loadAbortRef = useRef<{ key: string; abort: () => void } | null>(null)
  const cancelRequestedRef = useRef(false)
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose)

  const profileLabel = useMemo(() => {
    const a = items.find((r) => r.author?.trim())?.author?.trim()
    return a ?? ''
  }, [items])

  const selectedCount = selectedProfileCount(selected, items)
  const listBusy = paginationBusy || queueBusy || loadAllBusy || browserBusy
  const pageActionsDisabled = listBusy || loading
  const canLoadMore = Boolean(hasMore && nextCursor) && !pageActionsDisabled


  const callList = useCallback(
    async (
      cursor: string | null,
      firstPageMode?: 'merged' | 'api_quick' | 'html_only',
      opts?: { existingAwemeIds?: string[]; abortKey?: string; browserRecovery?: boolean }
    ) => {
      if (!window.api?.douyinProfileListPosts) throw new Error('douyinProfileListPosts is not available')
      const res = await window.api.douyinProfileListPosts(profileUrl, cursor, 35, firstPageMode, opts)
      const data = res?.data as DouyinProfileListResult | undefined
      if (!data) throw new Error('Empty response from list API')
      if (!data.ok) {
        const err = new Error(data.message || data.code || 'List failed') as Error & { code?: string }
        err.code = data.code
        throw err
      }
      return data
    },
    [profileUrl]
  )

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      setError('')
      setListWarning('')
      setListRestricted(false)
      setItems([])
      setNextCursor(null)
      setHasMore(false)
      setSelected(new Set())
      setSelectionAnchor(null)
      try {
        const d = await callList(null, 'api_quick')
        if (!alive) return
        setItems(d.items)
        setNextCursor(d.cursor)
        setHasMore(d.hasMore)
        if (d.warnings?.length) setListWarning(d.warnings.join(' '))
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
      loadAbortRef.current?.abort()
    }
  }, [profileUrl, callList])

  const handleLoadInBrowser = async () => {
    if (paginationBusy || queueBusy || loadAllBusy || browserBusy || loading) return
    loadAbortRef.current?.abort()
    const abortKey = `profile-browser-${Date.now()}`
    loadAbortRef.current = {
      key: abortKey,
      abort: () => {
        void window.api?.douyinProfileListPostsAbort?.(abortKey)
      },
    }
    cancelRequestedRef.current = false
    setBrowserBusy(true)
    setError('')
    setListWarning(t('douyin.importSending'))
    try {
      const d = await callList(null, undefined, {
        existingAwemeIds: items.map((x) => x.awemeId),
        browserRecovery: true,
        abortKey,
      })
      setListWarning('')
      if (d.items.length === 0) {
        if (d.warnings?.length) setListWarning(d.warnings.join(' '))
        return
      }
      setItems((prev) => {
        const m = new Map<string, DouyinProfilePostRow>()
        return mergeProfilePosts(prev, d.items)
      })
      setNextCursor(d.cursor)
      setHasMore(d.hasMore)
      setListRestricted(false)
      if (d.warnings?.length) setListWarning(d.warnings.join(' '))
    } catch (e) {
      setListWarning('')
      if (!cancelRequestedRef.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBrowserBusy(false)
      loadAbortRef.current = null
      cancelRequestedRef.current = false
    }
  }

  const handleOpenProfileInBrowser = async () => {
    if (!window.api?.openDouyinProfileUrl) return
    setListWarning(t('douyin.profileOpened'))
    try {
      const res = await window.api.openDouyinProfileUrl(profileUrl)
      if (!res?.ok) {
        setListWarning('')
        setError(res?.error ?? t('douyin.openFailed'))
      }
    } catch (e) {
      setListWarning('')
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleLoadMore = async () => {
    if (!hasMore || !nextCursor || paginationBusy || queueBusy || loadAllBusy || browserBusy) return
    setPaginationBusy(true)
    setError('')
    setListWarning('')
    try {
      const d = await callList(nextCursor, undefined, {
        existingAwemeIds: items.map((x) => x.awemeId),
      })
      setItems((prev) => {
        const m = new Map<string, DouyinProfilePostRow>()
        return mergeProfilePosts(prev, d.items)
      })
      setNextCursor(d.cursor)
      setHasMore(d.hasMore)
      setListRestricted(false)
      if (d.warnings?.length) setListWarning(d.warnings.join(' '))
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : ''
      if (code === 'PAGINATION_RESTRICTED') {
        setListRestricted(true)
        setHasMore(false)
        setNextCursor(null)
      }
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPaginationBusy(false)
    }
  }

  const handleLoadAll = async () => {
    if (!hasMore || !nextCursor || paginationBusy || queueBusy || loadAllBusy || browserBusy) return
    loadAbortRef.current?.abort()
    const abortKey = `profile-load-all-${Date.now()}`
    loadAbortRef.current = {
      key: abortKey,
      abort: () => {
        void window.api?.douyinProfileListPostsAbort?.(abortKey)
      },
    }
    cancelRequestedRef.current = false
    setLoadAllBusy(true)
    setLoadAllNote('')
    setListWarning('')
    setError('')
    const merged = new Map<string, DouyinProfilePostRow>()
    for (const x of items) merged.set(x.awemeId, x)
    let cur: string | null = nextCursor
    let more: boolean = hasMore
    let pages = 0
    let capNote = ''
    let aborted = false
    try {
      while (more && cur && pages < MAX_LOAD_ALL_PAGES) {
        pages++
        setLoadAllNote(t('douyin.loadingPage', { page: pages }))
        const d = await callList(cur, undefined, {
          existingAwemeIds: Array.from(merged.keys()),
          abortKey,
        })
        if (cancelRequestedRef.current) throw new Error('aborted')
        for (const it of d.items) merged.set(it.awemeId, it)
        setItems(Array.from(merged.values()))
        setNextCursor(d.cursor)
        setHasMore(d.hasMore)
        if (d.warnings?.length) setListWarning(d.warnings.join(' '))
        cur = d.cursor
        more = d.hasMore
        if (merged.size >= MAX_LOAD_ALL_ITEMS) {
          capNote = t('douyin.stoppedItems', { count: MAX_LOAD_ALL_ITEMS })
          break
        }
        if (!more || !cur) break
        await sleep(350 + Math.floor(Math.random() * 250))
        if (cancelRequestedRef.current) throw new Error('aborted')
      }
      if (pages >= MAX_LOAD_ALL_PAGES && !capNote) {
        capNote = t('douyin.stoppedPages', { count: MAX_LOAD_ALL_PAGES })
      }
      setLoadAllNote(capNote || (more && cur ? t('douyin.partialStopped') : t('douyin.listCompleteNote')))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : ''
      if (code === 'PAGINATION_RESTRICTED') {
        setListRestricted(true)
        setHasMore(false)
        setNextCursor(null)
      }
      if (cancelRequestedRef.current || msg.toLowerCase().includes('abort')) aborted = true
      else setError(msg)
    } finally {
      setLoadAllBusy(false)
      loadAbortRef.current = null
      cancelRequestedRef.current = false
    }
  }

  const orderedIds = items.map((item) => item.awemeId)

  const selectPost = (id: string, modifiers: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {}) => {
    const next = applyProfilePickerClick(orderedIds, selected, selectionAnchor, id, modifiers)
    setSelected(next.selected)
    setSelectionAnchor(next.anchor)
  }

  const cancelActiveLoad = () => {
    if (!loadAbortRef.current) return
    cancelRequestedRef.current = true
    loadAbortRef.current.abort()
    setLoadAllNote(t('douyin.loadingCancelled'))
  }

  const selectAll = () => {
    if (selectedCount === items.length) {
      const next = clearSelection<string>()
      setSelected(next.selected)
      setSelectionAnchor(next.anchor)
      return
    }
    const next = selectAllInOrder(orderedIds, selectionAnchor)
    setSelected(next.selected)
    setSelectionAnchor(next.anchor)
  }

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isSelectAllShortcut(event)) return
    event.preventDefault()
    event.stopPropagation()
    const next = selectAllInOrder(orderedIds, selectionAnchor)
    setSelected(next.selected)
    setSelectionAnchor(next.anchor)
  }

  const handleDownload = async () => {
    const rows = items.filter((i) => selected.has(i.awemeId))
    if (rows.length === 0 || !window.api?.startDownloadsBulk) return
    setQueueBusy(true)
    setError('')
    try {
      const folderName =
        profileLabel.trim() ||
        rows.find((r) => r.author?.trim())?.author?.trim() ||
        'Douyin profile'
      const archiveByAuthor = settings.archiveByAuthor === true
      const tasks = rows.map((r, i) => ({
        url: r.pageUrl,
        title: r.title.slice(0, 200),
        format: 'video' as const,
        quality: settings.defaultVideoQuality,
        thumbnail: r.cover || undefined,
        duration: r.mediaType === 'video' ? r.durationSec ?? 0 : 0,
        ...(archiveByAuthor
          ? {}
          : { playlistId: folderName, playlistTitle: folderName }),
        playlistIndex: i + 1,
        metadata: {
          channel: r.author,
          douyinProfilePick: true,
          awemeId: r.awemeId,
          douyinMediaType: r.mediaType,
        },
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
      setQueueBusy(false)
    }
  }

  const needsRecovery = listRestricted || Boolean(error) || (!loading && items.length === 0)
  const browserImport = (
    <button type="button" disabled={pageActionsDisabled} onClick={() => void handleLoadInBrowser()} className="v-button-secondary" title={t('douyin.importTitle')}>
      {browserBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
      {t('douyin.importBrowser')}
    </button>
  )

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <DialogShell ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="douyin-profile-picker-title"
        className="flex h-[min(720px,calc(100dvh-32px))] w-[min(820px,calc(100vw-32px))] flex-col outline-none" onKeyDownCapture={handleDialogKeyDown}>
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-divider-subtle px-5 py-4">
          <div className="min-w-0">
            <p className="mb-1 text-xs text-muted-foreground">{t('douyin.eyebrow')}</p>
            <h2 id="douyin-profile-picker-title" className="truncate text-base font-semibold">{profileLabel ? t('douyin.choosePostsNamed', { name: profileLabel }) : t('douyin.choosePosts')}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t('douyin.close')} className="v-button-ghost h-9 w-9 !p-0"><X className="h-4 w-4" aria-hidden /></button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col px-5 py-3">
          {loading ? (
            <div role="status" aria-live="polite" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-6 text-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden /><p className="text-sm">{t('douyin.loadingPosts')}</p>
            </div>
          ) : (
            <>
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 pb-3">
                <p role="status" aria-live="polite" className={`text-xs tabular-nums ${listRestricted ? 'text-warning' : 'text-muted-foreground'}`}>
                  {t(listRestricted ? 'ui.loadedRestricted' : error && items.length === 0 ? 'ui.loadFailed' : items.length === 0 ? 'ui.loadedEmpty' : hasMore ? 'ui.loadedPartial' : 'ui.loadedComplete', { count: items.length })}
                </p>
                {items.length > 0 && <button type="button" onClick={selectAll} className="v-button-ghost !min-h-8 !px-2 !py-1">
                  {selectedCount === items.length ? <CheckSquare className="h-4 w-4" aria-hidden /> : <Square className="h-4 w-4" aria-hidden />}
                  {t(selectedCount === items.length ? 'douyin.deselectAll' : 'douyin.selectAllLoaded')}
                </button>}
              </div>
              {needsRecovery && <div role="alert" className="mb-3 shrink-0 space-y-2 text-xs">
                <p className="flex items-center gap-2 text-warning"><Info className="h-4 w-4 shrink-0" aria-hidden />{t(error || listRestricted ? 'ui.restrictedHint' : 'ui.emptyRecoveryHint')}</p>
                {browserImport}
              </div>}
              {(error || listWarning || (loadAllNote && loadAllNote !== t('douyin.listCompleteNote'))) && <details className="v-disclosure mb-2 shrink-0">
                <summary><ChevronDown className="v-chevron h-3.5 w-3.5" aria-hidden />{t('ui.loadDetails')}</summary>
                <p className="max-h-20 overflow-y-auto break-words pb-2 text-xs leading-relaxed text-muted-foreground">{[error, listWarning, loadAllNote].filter(Boolean).join(' ')}</p>
              </details>}
              {items.length === 0 ? <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-6 text-center">
                <p className="text-sm font-medium">{t('douyin.noPosts')}</p><p className="mt-1 text-xs text-muted-foreground">{t('douyin.noPostsHint')}</p>
              </div> : <div className="min-h-0 flex-1 overflow-y-auto" aria-label={t('douyin.profilePosts')}>
                <AnimatedList items={items} getKey={(row) => row.awemeId} animate={items.length <= 200}>
                  {(row) => {
                    const isOn = selected.has(row.awemeId)
                    const mediaLabel = row.mediaType === 'gallery' ? t('douyin.images', { count: row.imageCount ?? 0 })
                      : row.durationSec != null && row.durationSec > 0 ? formatDuration(row.durationSec) : t('douyin.video')
                    return <button type="button" onClick={(event) => selectPost(row.awemeId, event)} aria-pressed={isOn} data-selected={isOn}
                      className="v-list-row mb-1 flex min-h-[76px] w-full items-center gap-3 rounded-button px-3 py-2 text-left">
                      <span className={cn('flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border border-divider-strong', isOn && 'border-action bg-action text-action-fg')} aria-hidden>
                        {isOn && <Check className="h-3 w-3" strokeWidth={3} />}
                      </span>
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-control"><ThumbnailImage src={row.cover} referer={profileUrl} /></div>
                      <div className="min-w-0 flex-1"><p className="line-clamp-2 text-[13px] font-medium leading-5">{/^Aweme \d+$/.test(row.title) ? t('ui.untitledPost') : row.title}</p><p className="mt-1 text-xs text-muted-foreground">{mediaLabel}</p></div>
                    </button>
                  }}
                </AnimatedList>
              </div>}
              {(hasMore || loadAllBusy || browserBusy) && <div className="flex shrink-0 flex-wrap items-center gap-2 pt-3">
                {hasMore && <><button type="button" disabled={!canLoadMore} onClick={() => void handleLoadMore()} className="v-button-secondary">{paginationBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}{t(paginationBusy ? 'douyin.loading' : 'douyin.loadMore')}</button>
                  <button type="button" disabled={!canLoadMore} onClick={() => void handleLoadAll()} className="v-button-ghost">{t(loadAllBusy ? 'douyin.loadingAll' : 'douyin.loadAll')}</button></>}
                {(loadAllBusy || browserBusy) && <button type="button" onClick={cancelActiveLoad} className="v-button-ghost">{t('douyin.cancelLoading')}</button>}
              </div>}
            </>
          )}
        </div>

        <footer className="shrink-0 border-t border-divider-subtle bg-surface px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{selectedCount === 0 ? t('ui.selectPrompt') : t('ui.keyboardHint')}</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="v-button-ghost">{t('common.cancel')}</button>
              <button type="button" disabled={selectedCount === 0 || listBusy || loading} onClick={() => void handleDownload()} className="v-button-primary">
                {queueBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
                {queueBusy ? t('douyin.adding') : t('ui.downloadCount', { count: selectedCount })}
              </button>
            </div>
          </div>
          <details className="v-disclosure mt-1">
            <summary><ChevronDown className="v-chevron h-3.5 w-3.5" aria-hidden />{t('ui.moreOptions')}</summary>
            <div className="flex flex-wrap items-center gap-2 pb-1">{!needsRecovery && browserImport}
              <button type="button" disabled={loading} onClick={() => void handleOpenProfileInBrowser()} className="v-button-ghost" title={profileUrl}><ExternalLink className="h-3.5 w-3.5" aria-hidden />{t('collection.openBrowser')}</button>
            </div>
          </details>
        </footer>
      </DialogShell>
    </div>
  )
}
