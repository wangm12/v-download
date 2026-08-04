import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  Check,
  CheckSquare,
  ChevronRight,
  Download,
  FolderOpen,
  Info,
  ListFilter,
  Loader2,
  Square,
  X
} from 'lucide-react'
import type { DouyinProfileListResult, DouyinProfilePostRow, SettingsData } from '@/types'
import { cn } from '@/lib/cn'
import { applyProfilePickerClick, mergeProfilePosts, profilePickerStatus, selectedProfileCount } from './douyinProfilePickerState'
import { clearSelection, isSelectAllShortcut, selectAllInOrder } from '@/utils/selection'
import { AnimatedList } from './reactbits/AnimatedList'
import { DialogShell } from './ui'

const MAX_LOAD_ALL_PAGES = 50
const MAX_LOAD_ALL_ITEMS = 2000

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export interface DouyinProfilePickerDialogProps {
  profileUrl: string
  settings: SettingsData
  onClose: () => void
}

export function DouyinProfilePickerDialog({ profileUrl, settings, onClose }: DouyinProfilePickerDialogProps) {
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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null)
  const loadAbortRef = useRef<{ key: string; abort: () => void } | null>(null)
  const cancelRequestedRef = useRef(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  const profileLabel = useMemo(() => {
    const a = items.find((r) => r.author?.trim())?.author?.trim()
    return a ?? ''
  }, [items])

  const activeActivity = loading ? 'loading' : loadAllBusy ? 'loading-all' : browserBusy ? 'browser-import' : paginationBusy ? 'loading-page' : queueBusy ? 'queueing' : error ? 'error' : 'idle'
  const selectedCount = selectedProfileCount(selected, items)
  const countSummary = profilePickerStatus(activeActivity, Boolean(hasMore && nextCursor), items.length)
  const listBusy = paginationBusy || queueBusy || loadAllBusy || browserBusy
  const pageActionsDisabled = listBusy || loading
  const canLoadMore = Boolean(hasMore && nextCursor) && !pageActionsDisabled

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      openerRef.current?.focus()
    }
  }, [onClose])

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
    setListWarning('Opening browser with your session — this may take up to a minute. A second window may appear if the browser is already open.')
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
    setListWarning('Profile opened in your browser — scroll to load more posts, then use Load in browser to import automatically.')
    try {
      const res = await window.api.openDouyinProfileUrl(profileUrl)
      if (!res?.ok) {
        setListWarning('')
        setError(res?.error ?? 'Could not open profile in browser')
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
      if (d.warnings?.length) setListWarning(d.warnings.join(' '))
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : ''
      if (code === 'PAGINATION_RESTRICTED') {
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
        setLoadAllNote(`Loading page ${pages}…`)
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
          capNote = `Stopped at ${MAX_LOAD_ALL_ITEMS} items (safety cap).`
          break
        }
        if (!more || !cur) break
        await sleep(350 + Math.floor(Math.random() * 250))
        if (cancelRequestedRef.current) throw new Error('aborted')
      }
      if (pages >= MAX_LOAD_ALL_PAGES && !capNote) {
        capNote = `Stopped at ${MAX_LOAD_ALL_PAGES} pages (safety cap).`
      }
      setLoadAllNote(capNote || (more && cur ? 'Partial load stopped.' : 'List complete.'))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : ''
      if (code === 'PAGINATION_RESTRICTED') {
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
    setLoadAllNote('Loading cancelled.')
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
      const tasks = rows.map((r, i) => ({
        url: r.pageUrl,
        title: r.title.slice(0, 200),
        format: 'video' as const,
        quality: settings.defaultVideoQuality,
        thumbnail: r.cover || undefined,
        duration: r.mediaType === 'video' ? r.durationSec ?? 0 : 0,
        playlistId: folderName,
        playlistIndex: i + 1,
        playlistTitle: folderName,
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
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setQueueBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-[2px] sm:p-6">
      <DialogShell
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="douyin-profile-picker-title"
        className="flex max-h-[min(820px,92vh)] w-[min(960px,96vw)] flex-col bg-window shadow-[0_28px_90px_rgb(0_0_0/0.52)]"
        onKeyDownCapture={handleDialogKeyDown}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-divider-subtle bg-window px-5 py-5 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-control text-accent ring-1 ring-inset ring-divider-subtle">
              <ListFilter className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-tertiary-foreground">
                Profile picker · Douyin
              </p>
              <h2 id="douyin-profile-picker-title" className="truncate text-base font-semibold tracking-[-0.01em] text-foreground sm:text-lg">
                {profileLabel ? `${profileLabel} — choose posts` : 'Choose posts from profile'}
              </h2>
              <p className="mt-1 max-w-[68ch] truncate text-xs text-muted-foreground" title={profileUrl}>
                {profileUrl}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile picker"
            title="Close"
            ref={closeRef}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-control hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        {!loading && items.length > 0 && (
          <div className="grid shrink-0 grid-cols-1 border-b border-divider-subtle bg-surface/60 sm:grid-cols-3 sm:divide-x sm:divide-divider-subtle">
            <div className="flex items-center justify-between gap-4 px-5 py-3.5 sm:block sm:px-6">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-tertiary-foreground">Loaded</span>
              <span className="text-sm font-semibold tabular-nums text-foreground sm:mt-1 sm:block">{items.length} posts</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-divider-subtle px-5 py-3.5 sm:block sm:border-t-0 sm:px-6">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-tertiary-foreground">Selected</span>
              <span className="text-sm font-semibold tabular-nums text-foreground sm:mt-1 sm:block">{selectedCount} of {items.length}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-divider-subtle px-5 py-3.5 sm:block sm:border-t-0 sm:px-6">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-tertiary-foreground">Availability</span>
              <span role="status" className="max-w-[24ch] truncate text-sm font-medium text-foreground sm:mt-1 sm:block" title={countSummary}>
                {hasMore ? 'More posts available' : 'List is complete'}
              </span>
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col px-5 py-4 sm:px-6 sm:py-5">
          {loading ? (
            <div role="status" aria-live="polite" className="flex min-h-[360px] flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-control text-accent ring-1 ring-inset ring-divider-subtle">
                <Loader2 className="h-5 w-5 animate-spin text-foreground" aria-hidden />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">Loading profile posts</p>
                <p className="mt-1 text-xs text-muted-foreground">Fetching the first page from Douyin…</p>
              </div>
            </div>
          ) : items.length === 0 ? (
            <div className="flex min-h-[360px] flex-1 flex-col items-center justify-center text-center">
              {error ? (
                <div role="alert" aria-live="assertive" className="mb-5 max-w-xl rounded-button bg-error/10 px-4 py-3 text-sm text-error">
                  {error}
                </div>
              ) : null}
              <p className="text-sm font-medium text-foreground">No posts found</p>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">Try syncing browser cookies in Settings, then open this profile again.</p>
            </div>
          ) : (
            <>
              <div className="flex shrink-0 flex-col gap-4 border-b border-divider-subtle pb-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">Choose posts to queue</h3>
                    <span className="rounded-full bg-control px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                      {selectedCount} selected
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Click to add or remove · Shift-click selects a range · Cmd/Ctrl+A selects all loaded</p>
                </div>

                <div className="flex flex-wrap items-center gap-2" aria-label="Selection and loading controls">
                  <button
                    type="button"
                    onClick={selectAll}
                    className="inline-flex min-h-10 items-center gap-2 rounded-button bg-control px-3 text-xs font-semibold text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                  >
                    {selectedCount === items.length ? <CheckSquare className="h-4 w-4" aria-hidden /> : <Square className="h-4 w-4" aria-hidden />}
                    {selectedCount === items.length ? 'Deselect all' : 'Select all loaded'}
                    <kbd className="hidden rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">⌘A</kbd>
                  </button>
                  <button
                    type="button"
                    disabled={!canLoadMore}
                    onClick={() => void handleLoadMore()}
                    className={cn(
                      'inline-flex min-h-10 items-center gap-1.5 rounded-button bg-control px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
                      canLoadMore ? 'text-foreground hover:bg-surface-hover' : 'cursor-not-allowed text-muted-foreground/50'
                    )}
                  >
                    {paginationBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                    {paginationBusy ? 'Loading…' : 'Load more'}
                  </button>
                  <button
                    type="button"
                    disabled={!canLoadMore}
                    onClick={() => void handleLoadAll()}
                    className={cn(
                      'inline-flex min-h-10 items-center gap-1.5 rounded-button bg-control px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
                      canLoadMore ? 'text-foreground hover:bg-surface-hover' : 'cursor-not-allowed text-muted-foreground/50'
                    )}
                  >
                    {loadAllBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                    {loadAllBusy ? 'Loading all…' : 'Load all'}
                  </button>
                </div>
              </div>

              {(error || listWarning || loadAllNote) && (
                <div className="mt-4 flex flex-col gap-2">
                  {error ? (
                    <div role="alert" aria-live="assertive" className="flex items-start gap-2 rounded-button bg-error/10 px-3 py-2.5 text-xs text-error">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span>{error}</span>
                    </div>
                  ) : null}
                  {listWarning ? (
                    <div role="status" aria-live="polite" className="flex items-start gap-2 rounded-button bg-control px-3 py-2.5 text-xs text-muted-foreground">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span>{listWarning}</span>
                    </div>
                  ) : null}
                  {loadAllNote ? (
                    <div role="status" className="flex items-center justify-between gap-3 rounded-lg bg-control px-3 py-2 text-xs text-muted-foreground">
                      <span>{loadAllNote}</span>
                      {loadAllBusy || browserBusy ? (
                        <button type="button" onClick={cancelActiveLoad} className="shrink-0 font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus">
                          Cancel
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}

              <div className="mt-4 flex min-h-0 flex-1 flex-col" aria-label="Profile posts">
                <div className="flex shrink-0 items-center justify-between gap-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-tertiary-foreground">
                  <span>Posts</span>
                  <span className="font-medium tracking-normal">{items.length} loaded</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-background/70 p-1 ring-1 ring-inset ring-divider-subtle">
                  <AnimatedList items={items} getKey={(row) => row.awemeId} animate={items.length <= 200} className="v-divider-y">
                    {(row) => {
                      const isOn = selected.has(row.awemeId)
                      const mediaLabel = row.mediaType === 'gallery'
                        ? `${row.imageCount ?? 0} images`
                        : row.durationSec != null
                          ? `${row.durationSec}s`
                          : 'Video'
                      return (
                        <button
                          type="button"
                          key={row.awemeId}
                          onClick={(event) => selectPost(row.awemeId, event)}
                          aria-pressed={isOn}
                          className={cn(
                            'v-list-row group grid w-full min-h-[76px] grid-cols-[auto_64px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus sm:grid-cols-[auto_72px_minmax(0,1fr)_auto]',
                            isOn ? 'bg-selection' : 'hover:bg-surface-hover'
                          )}
                          data-selected={isOn}
                        >
                          <span
                            className={cn(
                              'flex h-5 w-5 items-center justify-center rounded-md bg-control text-transparent ring-1 ring-inset ring-divider-strong transition-colors',
                              isOn ? 'bg-accent text-accent-fg ring-accent' : 'group-hover:ring-accent/55'
                            )}
                            aria-hidden
                          >
                            {isOn ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                          </span>
                          <div className="h-14 w-16 shrink-0 overflow-hidden rounded-lg bg-surface ring-1 ring-inset ring-divider-subtle sm:h-16 sm:w-[72px]">
                            {row.cover ? (
                              <img src={row.cover} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
                            ) : (
                              <div className="h-full w-full bg-muted" />
                            )}
                          </div>
                          <div className="min-w-0 self-stretch py-0.5">
                            <p className="line-clamp-2 text-xs font-semibold leading-relaxed text-foreground sm:text-sm">{row.title}</p>
                            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                              <span className="max-w-[18ch] truncate">{row.author}</span>
                              <span className="text-tertiary-foreground" aria-hidden>·</span>
                              <span className="rounded bg-control px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{row.mediaType}</span>
                              <span>{mediaLabel}</span>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
                            <span className="hidden font-mono text-[10px] sm:inline" title={row.awemeId}>{row.awemeId.slice(-6)}</span>
                            <ChevronRight className="h-4 w-4 opacity-40 transition-transform group-hover:translate-x-0.5 group-hover:opacity-80 motion-reduce:transition-none" aria-hidden />
                          </div>
                        </button>
                      )
                    }}
                  </AnimatedList>
                </div>
              </div>

              <div className="mt-4 flex shrink-0 flex-col gap-3 rounded-xl bg-surface/80 px-4 py-3 ring-1 ring-inset ring-divider-subtle sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold tabular-nums text-foreground">
                    {selectedCount === 0 ? 'Nothing selected yet' : `${selectedCount} post${selectedCount === 1 ? '' : 's'} ready`}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {selectedCount === 0 ? 'Select one or more posts to add them to your queue.' : 'Your selection will be added as one profile batch.'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="min-h-10 rounded-lg px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-control hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={selectedCount === 0 || listBusy || loading}
                    onClick={() => void handleDownload()}
                    className={cn(
                      'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
                      selectedCount === 0 || listBusy || loading
                        ? 'cursor-not-allowed bg-muted text-muted-foreground'
                        : 'bg-action text-action-fg hover:bg-action-hover'
                    )}
                  >
                    {queueBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden />}
                    {queueBusy ? 'Adding to queue…' : selectedCount === 0 ? 'Select posts' : `Add ${selectedCount} to queue`}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {!loading && items.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-divider-subtle bg-window px-5 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate">Need more posts?</span>
              <button
                type="button"
                disabled={pageActionsDisabled}
                onClick={() => void handleLoadInBrowser()}
                title="Open browser with your session and import more posts"
                className={cn(
                  'inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
                  pageActionsDisabled ? 'cursor-not-allowed text-muted-foreground/40' : 'text-foreground hover:bg-control'
                )}
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                Import from browser
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void handleOpenProfileInBrowser()}
                title="Open this profile in your configured browser"
                className={cn(
                  'inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
                  loading ? 'cursor-not-allowed text-muted-foreground/40' : 'text-foreground hover:bg-control'
                )}
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                Open manually
              </button>
            </div>
            {loadAllBusy || browserBusy ? (
              <button
                type="button"
                onClick={cancelActiveLoad}
                className="min-h-8 rounded-md px-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-control hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              >
                Cancel loading
              </button>
            ) : null}
          </div>
        )}
      </DialogShell>
    </div>
  )
}
