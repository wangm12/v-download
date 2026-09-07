import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Image,
  Music,
  RefreshCw,
  Search,
  Trash2,
  Video
} from 'lucide-react'
import { ActionButton } from './ActionButton'
import { libraryDeletePayload } from './libraryViewPresentation'
import { EmptyState, StatusPill } from './ui'
import { ThumbnailImage } from './ThumbnailImage'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { cn } from '@/lib/cn'
import { formatFileSize } from '@/utils/format'
import { applySelectionClick } from '@/utils/selection'
import { useTranslation } from 'react-i18next'
import type {
  LibraryFileItem,
  LibraryListQuery,
  LibraryMediaFilter,
  LibraryPage,
  LibrarySortDir,
  LibrarySortField,
  LibraryWorkItem
} from '@/types'

const PAGE_SIZES = [12, 24, 48, 96] as const
const MEDIA_FILTERS: LibraryMediaFilter[] = ['all', 'video', 'image', 'audio']

type LibraryMode = 'files' | 'works'

function isRemoteCover(value: string | null): boolean {
  return Boolean(value && /^https?:\/\//i.test(value))
}

function formatLibraryDate(mtimeMs: number): string {
  if (!mtimeMs) return '—'
  try {
    return new Date(mtimeMs).toLocaleString()
  } catch {
    return '—'
  }
}

function MediaGlyph({ kind }: { kind: LibraryFileItem['mediaKind'] }) {
  const Icon = kind === 'image' ? Image : kind === 'audio' ? Music : Video
  return <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
}

function LibraryDeleteDialog({
  count,
  work,
  onClose,
  onConfirm
}: {
  count: number
  work: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-delete-title"
        className="w-[360px] rounded-panel bg-background p-6 shadow-2xl ring-1 ring-inset ring-divider-strong"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="library-delete-title" className="mb-2 text-lg font-semibold text-foreground">
          {work ? t('library.deleteWorksTitle') : t('library.deleteFilesTitle')}
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t('library.deleteBody', { count, kind: work ? (count === 1 ? t('library.workOne') : t('library.works')) : (count === 1 ? t('library.fileOne') : t('library.files')) })}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-button border border-dashed border-border-strong bg-control py-2.5 font-medium text-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            {t('library.delete')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 w-full rounded-lg bg-control py-2.5 font-medium text-foreground hover:bg-state-active-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function LibraryView() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<LibraryMode>('files')
  const [searchQuery, setSearchQuery] = useState('')
  const deferredQuery = useDeferredValue(searchQuery)
  const [mediaType, setMediaType] = useState<LibraryMediaFilter>('all')
  const [sortBy, setSortBy] = useState<LibrarySortField>('date')
  const [sortDir, setSortDir] = useState<LibrarySortDir>('desc')
  const [limit, setLimit] = useState<(typeof PAGE_SIZES)[number]>(24)
  const [page, setPage] = useState(0)
  const [files, setFiles] = useState<LibraryPage<LibraryFileItem>>({ items: [], total: 0 })
  const [works, setWorks] = useState<LibraryPage<LibraryWorkItem>>({ items: [], total: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const forceRefreshRef = useRef(false)

  const offset = page * limit
  const listQuery = useMemo<LibraryListQuery>(() => ({
    offset,
    limit,
    query: deferredQuery,
    mediaType,
    sortBy,
    sortDir
  }), [deferredQuery, limit, mediaType, offset, sortBy, sortDir])

  useEffect(() => {
    setPage(0)
    setSelectedIds(new Set())
    setSelectionAnchorId(null)
  }, [deferredQuery, mediaType, mode, sortBy, sortDir, limit])

  useEffect(() => {
    let cancelled = false
    const query = {
      ...listQuery,
      forceRefresh: forceRefreshRef.current
    }
    forceRefreshRef.current = false
    setLoading(true)
    const request = mode === 'files'
      ? window.api.listLibraryFiles(query)
      : window.api.listLibraryWorks(query)
    void request.then((result) => {
      if (cancelled) return
      if (result.error) {
        setError(result.error)
        return
      }
      setError(null)
      if (mode === 'files') {
        setFiles((result.data as LibraryPage<LibraryFileItem> | undefined) ?? { items: [], total: 0 })
      } else {
        setWorks((result.data as LibraryPage<LibraryWorkItem> | undefined) ?? { items: [], total: 0 })
      }
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [listQuery, mode, refreshNonce])

  const visibleIds = useMemo(
    () => (mode === 'files' ? files.items.map((item) => item.id) : works.items.map((item) => item.key)),
    [files.items, mode, works.items]
  )
  const total = mode === 'files' ? files.total : works.total
  const pageCount = Math.max(1, Math.ceil(total / limit))

  const selectRow = useCallback((id: string, modifiers?: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => {
    const next = applySelectionClick(visibleIds, selectedIds, selectionAnchorId, id, modifiers)
    setSelectedIds(next.selected)
    setSelectionAnchorId(next.anchor)
  }, [selectedIds, selectionAnchorId, visibleIds])

  const selectedFiles = useMemo(() => {
    if (mode === 'files') return files.items.filter((item) => selectedIds.has(item.id))
    return works.items.filter((item) => selectedIds.has(item.key)).flatMap((work) => work.items)
  }, [files.items, mode, selectedIds, works.items])

  const selectedCount = selectedIds.size
  const openTarget = selectedFiles.find((item) => item.path && !item.missing)?.path ?? null

  const refresh = useCallback(() => {
    forceRefreshRef.current = true
    setRefreshNonce((value) => value + 1)
  }, [])

  const confirmRemoval = useCallback(async () => {
    const { paths, recordIds } = libraryDeletePayload(mode, selectedFiles)
    const result = await window.api.deleteLibraryPaths(paths, recordIds)
    setConfirmDelete(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setSelectedIds(new Set())
    setSelectionAnchorId(null)
    refresh()
  }, [mode, refresh, selectedFiles])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-window">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-divider-subtle px-4 py-3">
        <div className="flex rounded-lg bg-control p-0.5">
          {(['files', 'works'] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={cn(
                'min-h-8 rounded-md px-3 text-sm font-medium',
                mode === id ? 'bg-action text-action-fg' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {id === 'files' ? t('library.file') : t('library.work')}
            </button>
          ))}
        </div>
        <label className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('library.searchPlaceholder')}
            className="h-9 w-full rounded-lg bg-control pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          />
        </label>
        <select
          value={mediaType}
          onChange={(event) => setMediaType(event.target.value as LibraryMediaFilter)}
          className="h-9 rounded-lg bg-control px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          aria-label={t('library.type')}
        >
          {MEDIA_FILTERS.map((filter) => (
            <option key={filter} value={filter}>{t(`library.${filter}`)}</option>
          ))}
        </select>
        <select
          value={`${sortBy}:${sortDir}`}
          onChange={(event) => {
            const [nextSort, nextDir] = event.target.value.split(':') as [LibrarySortField, LibrarySortDir]
            setSortBy(nextSort)
            setSortDir(nextDir)
          }}
          className="h-9 rounded-lg bg-control px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          aria-label={t('library.sort')}
        >
          <option value="date:desc">{t('library.dateNewest')}</option>
          <option value="date:asc">{t('library.dateOldest')}</option>
          <option value="size:desc">{t('library.sizeLarge')}</option>
          <option value="size:asc">{t('library.sizeSmall')}</option>
        </select>
        <select
          value={limit}
          onChange={(event) => setLimit(Number(event.target.value) as (typeof PAGE_SIZES)[number])}
          className="h-9 rounded-lg bg-control px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          aria-label={t('library.pageSize')}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>{t('library.perPage', { count: size })}</option>
          ))}
        </select>
        <ActionButton icon={RefreshCw} title={t('library.refresh')} onClick={refresh} />
      </div>

      {selectedCount > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-divider-subtle px-4 py-2 text-sm">
          <span className="text-muted-foreground">{t('library.selected', { count: selectedCount })}</span>
          <button
            type="button"
            disabled={!openTarget}
            onClick={() => openTarget && void window.api.openFile(openTarget)}
            className="min-h-8 rounded-button px-3 text-xs font-medium text-foreground hover:bg-control disabled:opacity-40"
          >
            {t('library.open')}
          </button>
          <button
            type="button"
            disabled={!openTarget}
            onClick={() => openTarget && void window.api.openFileLocation(openTarget)}
            className="min-h-8 rounded-button px-3 text-xs font-medium text-foreground hover:bg-control disabled:opacity-40"
          >
            {t('library.reveal')}
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="min-h-8 rounded-button px-3 text-xs font-medium text-error hover:bg-state-error-bg"
          >
            {t('library.delete')}
          </button>
        </div>
      )}

      {error && (
        <p className="shrink-0 border-b border-divider-subtle px-4 py-2 text-xs text-error" role="alert">{error}</p>
      )}

      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {total === 0 && !loading ? (
          <EmptyState
            className="flex-1"
            title={deferredQuery.trim() ? t('library.emptySearch') : t('library.empty')}
            description={deferredQuery.trim()
              ? t('library.emptySearchDesc')
              : t('library.emptyDesc')}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            {mode === 'files'
              ? files.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selectedIds.has(item.id)}
                  onClick={(event) => selectRow(item.id, event)}
                  onDoubleClick={() => item.path && !item.missing && void window.api.openFile(item.path)}
                  className={cn(
                    'mb-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
                    selectedIds.has(item.id) ? 'bg-selection' : 'hover:bg-surface-hover'
                  )}
                >
                  {isRemoteCover(item.thumbnail) ? (
                    <ThumbnailImage src={item.thumbnail} alt="" className="h-9 w-14 rounded object-cover" placeholderClassName="h-9 w-14 rounded bg-control" />
                  ) : (
                    <span className="flex h-9 w-14 items-center justify-center rounded bg-control">
                      <MediaGlyph kind={item.mediaKind} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
                      {item.missing && <StatusPill tone="warning">{t('library.missing')}</StatusPill>}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {[item.channel, item.fileName, item.missing ? null : formatFileSize(item.size)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-xs text-tertiary-foreground sm:block">{formatLibraryDate(item.mtimeMs)}</span>
                  {item.path && !item.missing && (
                    <span onClick={(event) => event.stopPropagation()}>
                      <ActionButton icon={FolderOpen} title={t('library.reveal')} size="sm" onClick={() => void window.api.openFileLocation(item.path!)} />
                    </span>
                  )}
                </button>
              ))
              : works.items.map((work) => (
                <button
                  key={work.key}
                  type="button"
                  aria-pressed={selectedIds.has(work.key)}
                  onClick={(event) => selectRow(work.key, event)}
                  className={cn(
                    'mb-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
                    selectedIds.has(work.key) ? 'bg-selection' : 'hover:bg-surface-hover'
                  )}
                >
                  {isRemoteCover(work.cover) ? (
                    <ThumbnailImage src={work.cover} alt="" className="h-9 w-14 rounded object-cover" placeholderClassName="h-9 w-14 rounded bg-control" />
                  ) : (
                    <span className="flex h-9 w-14 items-center justify-center rounded bg-control">
                      <Image className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{work.title}</span>
                      {work.missing && <StatusPill tone="warning">{t('library.missing')}</StatusPill>}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {[work.channel, `${work.items.length} ${work.items.length === 1 ? t('library.fileOne') : t('library.files')}`, formatFileSize(work.size)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-xs text-tertiary-foreground sm:block">{formatLibraryDate(work.mtimeMs)}</span>
                </button>
              ))}
          </div>
        )}
      </main>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-divider-subtle px-4 py-2 text-xs text-muted-foreground">
        <span>
          {loading
            ? t('library.loading')
            : `${total} ${t(total === 1 ? (mode === 'files' ? 'library.fileOne' : 'library.workOne') : (mode === 'files' ? 'library.files' : 'library.works'))}`}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={page <= 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-control disabled:opacity-40"
            aria-label={t('library.prevPage')}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <span>{page + 1} / {pageCount}</span>
          <button
            type="button"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((value) => value + 1)}
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-control disabled:opacity-40"
            aria-label={t('library.nextPage')}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {confirmDelete && (
        <LibraryDeleteDialog
          count={selectedCount}
          work={mode === 'works'}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => void confirmRemoval()}
        />
      )}
    </div>
  )
}
