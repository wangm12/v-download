import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, Loader2, Download, CheckSquare, Square } from 'lucide-react'
import type { DouyinProfileListResult, DouyinProfilePostRow, SettingsData } from '@/types'
import { cn } from '@/lib/cn'
import { HoverHintWrap } from './HoverHintWrap'
import { mergeProfilePosts, profilePickerStatus, selectedProfileCount } from './douyinProfilePickerState'

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

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const cancelActiveLoad = () => {
    if (!loadAbortRef.current) return
    cancelRequestedRef.current = true
    loadAbortRef.current.abort()
    setLoadAllNote('Loading cancelled.')
  }

  const selectAll = () => {
    if (selectedCount === items.length) setSelected(new Set())
    else setSelected(new Set(items.map((i) => i.awemeId)))
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-3">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="douyin-profile-picker-title" className="w-[min(720px,94vw)] max-h-[min(640px,90vh)] bg-background rounded-xl overflow-hidden shadow-2xl flex flex-col">
        <div className="bg-elevated px-5 py-4 flex items-start justify-between gap-3 border-b border-border">
          <div className="min-w-0">
            <h2 id="douyin-profile-picker-title" className="text-sm font-semibold text-foreground">
              {profileLabel ? `${profileLabel} — pick posts` : 'Douyin profile — pick posts'}
            </h2>
            <p className="text-[11px] text-muted-foreground mt-1 truncate" title={profileUrl}>{profileUrl}</p>
          </div>
          <HoverHintWrap text="Close" side="bottom">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              ref={closeRef}
              className="min-w-11 min-h-11 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action shrink-0"
            >
              <X size={18} />
            </button>
          </HoverHintWrap>
        </div>

        <div className="flex-1 min-h-0 flex flex-col px-5 py-3">
          {loading ? (
            <div role="status" aria-live="polite" className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
              <Loader2 className="animate-spin" size={28} />
              <span className="text-sm">Loading post list…</span>
            </div>
          ) : items.length === 0 ? (
            <>
              {error ? (
                <div role="alert" aria-live="assertive" className="rounded-lg border border-border bg-raised px-3 py-2 text-sm text-foreground mb-3">{error}</div>
              ) : null}
              <p className="text-sm text-muted-foreground py-8 text-center">No posts found. Try cookies in Settings.</p>
            </>
          ) : (
            <>
              {error ? (
                <div role="alert" aria-live="assertive" className="rounded-lg border border-border bg-raised px-3 py-2 text-sm text-foreground mb-3">{error}</div>
              ) : null}
              {listWarning ? (
                <div role="status" aria-live="polite" className="rounded-lg border border-border bg-raised px-3 py-2 text-xs text-muted-foreground mb-3">{listWarning}</div>
              ) : null}
              {countSummary ? (
                <div
                  role="status"
                  className="mb-3 rounded-lg border border-border bg-raised px-3 py-2.5 text-sm leading-snug text-foreground"
                >
                  <span className="font-medium tabular-nums">{countSummary}</span>
                  <span className="ml-3 text-muted-foreground">{selectedCount} of {items.length} selected</span>
                </div>
              ) : null}
              <div className="flex flex-wrap items-start gap-3 pb-2 border-b border-border" aria-label="Profile post loading controls">
                <div className="flex flex-col gap-1.5" role="group" aria-labelledby="profile-selection-label">
                  <span id="profile-selection-label" className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Selection</span>
                <button
                  type="button"
                  onClick={selectAll}
                  className="inline-flex items-center gap-1.5 min-h-11 px-2.5 rounded-lg border border-border text-xs font-medium hover:bg-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
                >
                  {selectedCount === items.length ? <CheckSquare size={14} /> : <Square size={14} />}
                  {selectedCount === items.length ? 'Deselect all' : 'Select all loaded'}
                </button>
                </div>
                <div className="flex flex-col gap-1.5" role="group" aria-labelledby="profile-pagination-label">
                  <span id="profile-pagination-label" className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Pagination</span>
                <button
                  type="button"
                  disabled={!hasMore || !nextCursor || paginationBusy || queueBusy || loadAllBusy || browserBusy}
                  onClick={() => void handleLoadMore()}
                  className={cn(
                    'min-h-11 px-2.5 rounded-lg border text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action',
                    !hasMore || !nextCursor || paginationBusy || queueBusy || loadAllBusy || browserBusy
                      ? 'border-border/50 text-muted-foreground/50 cursor-not-allowed'
                      : 'border-border hover:bg-control'
                  )}
                >
                  {paginationBusy ? 'Loading…' : 'Load more'}
                </button>
                <button
                  type="button"
                  disabled={!hasMore || !nextCursor || paginationBusy || queueBusy || loadAllBusy || browserBusy}
                  onClick={() => void handleLoadAll()}
                  className={cn(
                    'min-h-11 px-2.5 rounded-lg border text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action',
                    !hasMore || !nextCursor || paginationBusy || queueBusy || loadAllBusy || browserBusy
                      ? 'border-border/50 text-muted-foreground/50 cursor-not-allowed'
                      : 'border-border hover:bg-control'
                  )}
                >
                  {loadAllBusy ? 'Loading all…' : 'Load all available'}
                </button>
                </div>
                <div className="flex flex-col gap-1.5" role="group" aria-labelledby="profile-browser-label">
                  <span id="profile-browser-label" className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Browser recovery</span>
                <HoverHintWrap text="Opens a browser window with your session and collects more posts automatically. If the browser is already open, a second window may appear.">
                  <button
                    type="button"
                    disabled={paginationBusy || queueBusy || loadAllBusy || browserBusy || loading}
                    onClick={() => void handleLoadInBrowser()}
                    className={cn(
                      'min-h-11 px-2.5 rounded-lg border text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action',
                      paginationBusy || queueBusy || loadAllBusy || browserBusy || loading
                        ? 'border-border/50 text-muted-foreground/50 cursor-not-allowed'
                        : 'border-border hover:bg-control'
                    )}
                  >
                    {browserBusy ? 'Loading…' : 'Import more from browser'}
                  </button>
                </HoverHintWrap>
                <HoverHintWrap text="Opens this profile in your configured browser (Settings → Browser profile). Scroll manually to load posts.">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void handleOpenProfileInBrowser()}
                    className={cn(
                      'min-h-11 px-2.5 rounded-lg border text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action',
                      loading
                        ? 'border-border/50 text-muted-foreground/50 cursor-not-allowed'
                        : 'border-border hover:bg-control'
                    )}
                  >
                    Open profile manually
                  </button>
                </HoverHintWrap>
                </div>
                {loadAllNote ? <span role="status" className="text-[11px] text-muted-foreground self-center">{loadAllNote}</span> : null}
                {loadAllBusy || browserBusy ? <button type="button" onClick={cancelActiveLoad} className="min-h-11 px-2.5 rounded-lg border border-border text-xs font-medium hover:bg-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action">Cancel loading</button> : null}
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto mt-2 space-y-1">
                {items.map((row) => {
                  const isOn = selected.has(row.awemeId)
                  return (
                    <button
                      type="button"
                      key={row.awemeId}
                      onClick={() => toggle(row.awemeId)}
                      aria-pressed={isOn}
                      className={cn(
                        'w-full min-h-16 flex gap-3 items-center text-left rounded-lg border px-2 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action',
                        isOn ? 'border-foreground/40 bg-elevated' : 'border-transparent hover:bg-elevated/60'
                      )}
                    >
                      <div className="w-14 h-14 rounded-md overflow-hidden bg-surface shrink-0">
                        {row.cover ? (
                          <img src={row.cover} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-muted" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground line-clamp-2">{row.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {row.author} · {row.mediaType}
                          {row.durationSec != null ? ` · ${row.durationSec}s` : ''}
                          {row.imageCount != null ? ` · ${row.imageCount} images` : ''}
                        </p>
                      </div>
                      <span className="hidden sm:inline text-[10px] text-muted-foreground shrink-0 font-mono" title={row.awemeId}>{row.awemeId.slice(-6)}</span>
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
            className="min-h-11 px-3 rounded-lg border border-border text-sm text-muted-foreground hover:bg-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={selectedCount === 0 || queueBusy || paginationBusy || loading}
            onClick={() => void handleDownload()}
            className={cn(
              'inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold',
              selectedCount === 0 || queueBusy || paginationBusy || loading
                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                : 'bg-action text-action-fg hover:bg-action-hover'
            )}
          >
            <Download size={16} />
            Add {selectedCount} selected posts to queue
          </button>
        </div>
      </div>
    </div>
  )
}
