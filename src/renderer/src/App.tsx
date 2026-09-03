import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Loader2, CheckCircle2, Info, X } from 'lucide-react'
import { TitleBar } from '@/components/TitleBar'
import { BottomBar } from '@/components/BottomBar'
import { FormatDialog } from '@/components/FormatDialog'
import { DouyinProfilePickerDialog } from '@/components/DouyinProfilePickerDialog'
import { CollectionPickerDialog } from '@/components/CollectionPickerDialog'
import { ClearDialog } from '@/components/ClearDialog'
import { DeleteSelectionDialog } from '@/components/DeleteSelectionDialog'
import { PreferencesPanel } from '@/components/PreferencesPanel'
import { OnboardingWizard } from '@/components/OnboardingWizard'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { DownloadActionsProvider } from '@/contexts/DownloadActionsContext'
import { AppSidebar } from '@/components/AppSidebar'
import { HoverHintWrap } from '@/components/HoverHintWrap'
import { QueueToolbar } from '@/components/QueueToolbar'
import { DownloadInspector } from '@/components/DownloadInspector'
import { VirtualizedQueue } from '@/components/VirtualizedQueue'
import {
  shouldOpenDownloadDetails,
  shouldRenderDownloadDetails
} from '@/components/downloadInspectorPresentation'
import { useDownloads } from '@/hooks/useDownloads'
import { useSettings } from '@/hooks/useSettings'
import { useUrlHandler } from '@/hooks/useUrlHandler'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { groupDownloadsByPlaylist } from '@/utils/downloads'
import {
  countQueueAttention,
  filterQueueDownloads,
  getQueueEmptyKind,
  type QueueFilter
} from '@/utils/queueFilters'
import { isPlaylistUrl } from '@/utils/youtube'
import { noteMetadataFromVideoInfo } from '@/utils/noteMetadata'
import { DOUYIN_BULK_URL_PREFILL_SESSION_KEY } from '@/utils/douyinBulk'
import { parseSpeedToBytes, formatSpeed } from '@/utils/format'
import {
  applySelectionClick,
  clearSelection,
  retainSelection,
  selectAllInOrder
} from '@/utils/selection'
import {
  expandQueueSelectionToDownloadIds,
  getPlaylistIdFromSelectionId,
  getPlaylistSelectionId,
  getVisibleQueueSelectionIds
} from '@/utils/queueSelection'
import type { PlaylistViewState } from '@/utils/queueSelection'
import { useThrottledValue } from '@/hooks/useThrottledValue'
import { useThemePreference } from '@/hooks/useThemePreference'
import { cn } from '@/lib/cn'
import type { PrefSection } from '@/preferencesNav'
import { EmptyState, StatusBlock } from '@/components/ui'

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  )
}

type MainView = 'downloads' | 'preferences'

function readSettingsHash(): MainView {
  return window.location.hash === '#/settings' ? 'preferences' : 'downloads'
}

function normalizeSettingsHash(): void {
  if (window.location.hash === '#/settings') {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#`)
  }
}

const LS_LEFT_SIDEBAR = 'v-download:ui:left-sidebar-collapsed'
const LS_RIGHT_INSPECTOR = 'v-download:ui:right-inspector-collapsed'
const RESUMABLE_STATUSES = new Set(['paused', 'interrupted', 'error', 'queued'])
function readCollapsedFromStorage(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

/** Right inspector: absent key defaults to hidden (no strip); '1' = hidden, '0' = open. */
function readRightInspectorCollapsedFromStorage(): boolean {
  try {
    const v = localStorage.getItem(LS_RIGHT_INSPECTOR)
    if (v === null) return true
    return v === '1'
  } catch {
    return true
  }
}

type CookieSyncBanner =
  | null
  | {
      kind: 'progress' | 'wait' | 'ok' | 'warn'
      title: string
      detail?: string
    }

function MainApp() {
  const [mainView, setMainView] = useState<MainView>(readSettingsHash)
  const [prefSection, setPrefSection] = useState<PrefSection>('general')
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() =>
    readCollapsedFromStorage(LS_LEFT_SIDEBAR)
  )
  const [rightInspectorCollapsed, setRightInspectorCollapsed] = useState(() => readRightInspectorCollapsedFromStorage())
  const { preference: themePreference, setPreference: setThemePreference, resolvedTheme } = useThemePreference()
  const { downloads, removeDownload, removeDownloads, updateDownload, refreshDownloads } = useDownloads()
  const { settings, loadSettings } = useSettings()
  const {
    errorMsg,
    showFormatDialog,
    showDouyinProfilePicker,
    douyinProfileUrl,
    showCollectionPicker,
    collectionPickerUrl,
    pendingVideoInfo,
    pendingResolverId,
    pendingEntries,
    pendingPlaylistMeta,
    queueCount,
    handlePaste,
    handleExternalUrl,
    clearPending,
    clearQueue,
    selectReadyResolve,
    setShowFormatDialog,
    closeDouyinProfilePicker,
    closeCollectionPicker
  } = useUrlHandler(settings)

  const [searchQuery, setSearchQuery] = useState('')
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('all')
  const [searchFocusSignal, setSearchFocusSignal] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [playlistViewStates, setPlaylistViewStates] = useState<Record<string, PlaylistViewState>>({})
  const [showClearDialog, setShowClearDialog] = useState(false)
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null)
  const [cookieSyncBanner, setCookieSyncBanner] = useState<CookieSyncBanner>(null)
  const cookieSyncWaitRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cookieSyncDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cookieSyncSessionRef = useRef(false)
  const cookieSyncInFlightRef = useRef(false)

  const clearQueueSelection = useCallback(() => {
    const cleared = clearSelection<string>()
    setSelectedIds(cleared.selected)
    setSelectionAnchorId(cleared.anchor)
    setFocusedId(null)
    setRightInspectorCollapsed(true)
  }, [])

  const clearCookieSyncTimers = useCallback(() => {
    if (cookieSyncWaitRef.current) {
      window.clearTimeout(cookieSyncWaitRef.current)
      cookieSyncWaitRef.current = null
    }
    if (cookieSyncDismissRef.current) {
      window.clearTimeout(cookieSyncDismissRef.current)
      cookieSyncDismissRef.current = null
    }
  }, [])

  const dismissCookieSyncBanner = useCallback(() => {
    cookieSyncSessionRef.current = false
    cookieSyncInFlightRef.current = false
    clearCookieSyncTimers()
    setCookieSyncBanner(null)
  }, [clearCookieSyncTimers])

  const scheduleBannerDismiss = useCallback((ms: number) => {
    if (cookieSyncDismissRef.current) window.clearTimeout(cookieSyncDismissRef.current)
    cookieSyncDismissRef.current = window.setTimeout(() => {
      setCookieSyncBanner(null)
      cookieSyncDismissRef.current = null
    }, ms)
  }, [])

  useEffect(() => {
    return () => clearCookieSyncTimers()
  }, [clearCookieSyncTimers])

  const openPreferences = useCallback(() => {
    setMainView('preferences')
    clearQueueSelection()
    setPrefSection('general')
  }, [clearQueueSelection])

  const completeOnboarding = useCallback(async () => {
    if (!window.api) return
    const result = await window.api.updateSettings('onboardingCompleted', true)
    if (!result.ok) throw new Error(result.error || 'Could not save setup state')
    await loadSettings()
  }, [loadSettings])

  const closeDownloadDetails = useCallback(() => {
    setRightInspectorCollapsed(true)
  }, [])

  const openDouyinBulkPreferences = useCallback((homepageUrl: string) => {
    try {
      sessionStorage.setItem(DOUYIN_BULK_URL_PREFILL_SESSION_KEY, homepageUrl)
    } catch {
      /* ignore */
    }
    setMainView('preferences')
    clearQueueSelection()
    setPrefSection('advanced')
  }, [clearQueueSelection])

  useEffect(() => {
    if (mainView === 'preferences' && window.location.hash === '#/settings') {
      normalizeSettingsHash()
    }
  }, [mainView])

  useEffect(() => {
    const syncFromHash = () => {
      if (window.location.hash === '#/settings') {
        setMainView('preferences')
        clearQueueSelection()
        setPrefSection('general')
        normalizeSettingsHash()
      }
    }
    syncFromHash()
    window.addEventListener('hashchange', syncFromHash)
    return () => window.removeEventListener('hashchange', syncFromHash)
  }, [clearQueueSelection])

  useEffect(() => {
    try {
      localStorage.setItem(LS_LEFT_SIDEBAR, leftSidebarCollapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [leftSidebarCollapsed])

  useEffect(() => {
    try {
      localStorage.setItem(LS_RIGHT_INSPECTOR, rightInspectorCollapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [rightInspectorCollapsed])

  useEffect(() => {
    if (!window.api?.onOpenPreferences) return
    const unsub = window.api.onOpenPreferences(() => {
      setMainView('preferences')
      clearQueueSelection()
      setPrefSection('general')
    })
    return unsub
  }, [clearQueueSelection])

  useEffect(() => {
    if (!window.api?.onCookiesSynced) return
    const unsub = window.api.onCookiesSynced((data) => {
      loadSettings()
      if (!cookieSyncSessionRef.current) return
      cookieSyncSessionRef.current = false
      cookieSyncInFlightRef.current = false
      clearCookieSyncTimers()
      setCookieSyncBanner({
        kind: 'ok',
        title: 'Cookies saved',
        detail: `Chrome sent ${data.count} cookie entries. You can retry your download now.`
      })
      scheduleBannerDismiss(6000)
    })
    return unsub
  }, [loadSettings, clearCookieSyncTimers, scheduleBannerDismiss])

  const handleBrowserCookieSync = useCallback(async () => {
    if (!window.api?.requestBrowserCookieSync || cookieSyncInFlightRef.current) return
    cookieSyncInFlightRef.current = true
    clearCookieSyncTimers()
    cookieSyncSessionRef.current = true
    setCookieSyncBanner({
      kind: 'progress',
      title: 'Syncing cookies…',
      detail: 'Opening your browser and contacting the V-Download extension.'
    })

    try {
      const res = await window.api.requestBrowserCookieSync()
      if (!cookieSyncSessionRef.current) {
        cookieSyncInFlightRef.current = false
        return
      }
      setCookieSyncBanner({
        kind: 'wait',
        title: 'Waiting for Chrome',
        detail: res.openedBrowser
          ? 'Switch to the new tab — it should show “Saved” when finished. If the tab opened in a browser that is not Chrome, copy http://127.0.0.1:18765/cookie-sync-landing into Chrome. Keep V-Download running (we wait up to ~2 min for the extension’s background sync).'
          : res.message ||
            'Open http://127.0.0.1:18765/cookie-sync-landing in Chrome with the V-Download extension, or leave Chrome open — background sync can take up to about 2 minutes.'
      })
      cookieSyncWaitRef.current = window.setTimeout(() => {
        cookieSyncWaitRef.current = null
        if (!cookieSyncSessionRef.current) return
        cookieSyncSessionRef.current = false
        cookieSyncInFlightRef.current = false
        setCookieSyncBanner({
          kind: 'warn',
          title: 'Still no cookies from Chrome',
          detail:
            'Open http://127.0.0.1:18765/cookie-sync-landing in Chrome (with the V-Download extension). If your default browser is not Chrome, the first tab may be the wrong app. Then browse the site you need (e.g. Douyin) and click Sync cookies again.'
        })
      }, 125000)
    } catch (err) {
      cookieSyncSessionRef.current = false
      cookieSyncInFlightRef.current = false
      clearCookieSyncTimers()
      setCookieSyncBanner({
        kind: 'warn',
        title: 'Could not start sync',
        detail: err instanceof Error ? err.message : String(err)
      })
    }
  }, [clearCookieSyncTimers])

  const cookieSyncBusy =
    cookieSyncBanner?.kind === 'progress' || cookieSyncBanner?.kind === 'wait'
  const syncCookiesPhase =
    cookieSyncBanner?.kind === 'progress'
      ? ('opening' as const)
      : cookieSyncBanner?.kind === 'wait'
        ? ('waiting' as const)
        : null

  useEffect(() => {
    if (!window.api?.onYtdlUrl) return
    const unsub = window.api.onYtdlUrl((url: string) => handleExternalUrl(url))
    return unsub
  }, [handleExternalUrl])

  const handleDownload = useCallback(
    async (_url: string, format: string, quality: string) => {
      if (!window.api) return

      let consumeResolver = true
      try {
        if (pendingResolverId && pendingVideoInfo) {
          const imgs = pendingVideoInfo.image_urls
          const galleryType = pendingVideoInfo._type
          const isGallery =
            (galleryType === 'douyin_gallery' || galleryType === 'xhs_gallery') && Boolean(imgs?.length)
          const imageMetaKey = galleryType === 'xhs_gallery' ? 'xhsImageUrls' : 'douyinImageUrls'
          const noteMeta = noteMetadataFromVideoInfo(pendingVideoInfo)
          const promoted = await window.api.promoteInfoResolve({
            id: pendingResolverId,
            url: pendingVideoInfo.webpage_url || _url,
            title: pendingVideoInfo.title || 'Download',
            format,
            quality,
            thumbnail: pendingVideoInfo.thumbnail,
            duration: pendingVideoInfo.duration,
            metadata: isGallery
              ? { [imageMetaKey]: imgs, channel: pendingVideoInfo.channel ?? '', ...noteMeta }
              : {
                  ...(pendingVideoInfo.channel ? { channel: pendingVideoInfo.channel } : {}),
                  ...(pendingVideoInfo.id ? { ytdlpId: pendingVideoInfo.id } : {}),
                  ...noteMeta
                }
          })
          if (promoted?.error) consumeResolver = false
        } else if (pendingEntries && pendingEntries.length > 0) {
          const playlistTitle = pendingPlaylistMeta?.title ?? 'Playlist'
          const listUrl = pendingPlaylistMeta?.url ?? ''
          const useNativePlaylist =
            settings.youtubePlaylistMode === 'native' && listUrl && isPlaylistUrl(listUrl)

          if (useNativePlaylist) {
            await window.api.startDownload({
              url: listUrl,
              title: playlistTitle,
              format,
              quality,
              thumbnail: pendingEntries[0]?.thumbnail,
              duration: pendingEntries[0]?.duration ?? 0,
              playlistId: playlistTitle,
              metadata: {
                nativeYoutubePlaylist: true,
                channel: pendingEntries[0]?.channel ?? ''
              }
            })
          } else {
            for (let i = 0; i < pendingEntries.length; i++) {
              const entry = pendingEntries[i]
              const videoUrl = entry.webpage_url || `https://www.youtube.com/watch?v=${entry.id}`
              await window.api.startDownload({
                url: videoUrl,
                title: entry.title,
                format,
                quality,
                thumbnail: entry.thumbnail,
                duration: entry.duration,
                playlistId: playlistTitle,
                playlistIndex: i,
                playlistTitle,
                metadata: entry.id ? { ytdlpId: entry.id } : undefined
              })
            }
          }
        } else {
          const title = pendingVideoInfo?.title ?? 'Unknown'
          const pageUrl = pendingVideoInfo?.webpage_url ?? _url
          const imgs = pendingVideoInfo?.image_urls
          const galleryType = pendingVideoInfo?._type
          const isGallery =
            (galleryType === 'douyin_gallery' || galleryType === 'xhs_gallery') && imgs && imgs.length > 0
          const imageMetaKey = galleryType === 'xhs_gallery' ? 'xhsImageUrls' : 'douyinImageUrls'
          const noteMeta = pendingVideoInfo ? noteMetadataFromVideoInfo(pendingVideoInfo) : {}

          await window.api.startDownload({
            url: pageUrl,
            title,
            format,
            quality,
            thumbnail: pendingVideoInfo?.thumbnail,
            duration: pendingVideoInfo?.duration,
            metadata: isGallery
              ? {
                  [imageMetaKey]: imgs,
                  channel: pendingVideoInfo?.channel ?? '',
                  ...noteMeta
                }
              : {
                  ...(pendingVideoInfo?.channel ? { channel: pendingVideoInfo.channel } : {}),
                  ...(pendingVideoInfo?.id ? { ytdlpId: pendingVideoInfo.id } : {}),
                  ...noteMeta
                }
          })
        }
      } finally {
        clearPending({ consumeResolver })
        loadSettings()
      }
    },
    [pendingResolverId, pendingVideoInfo, pendingEntries, pendingPlaylistMeta, settings.youtubePlaylistMode, loadSettings, clearPending]
  )

  const handleClearCompleted = useCallback(async () => {
    if (window.api) {
      await window.api.clearDownloads('completed')
      refreshDownloads()
    }
  }, [refreshDownloads])

  const handleClearAll = useCallback(async () => {
    if (window.api) {
      await window.api.clearDownloads('all')
      refreshDownloads()
    }
  }, [refreshDownloads])

  const handleResumeAll = useCallback(async () => {
    if (window.api) {
      await window.api.resumeAll()
      refreshDownloads()
    }
  }, [refreshDownloads])

  const handlePauseAll = useCallback(async () => {
    if (window.api) {
      await window.api.pauseAll()
      refreshDownloads()
    }
  }, [refreshDownloads])

  const filteredDownloads = useMemo(
    () => filterQueueDownloads(downloads, searchQuery, queueFilter),
    [downloads, searchQuery, queueFilter]
  )
  const attentionCount = useMemo(() => countQueueAttention(downloads), [downloads])
  const grouped = useMemo(() => groupDownloadsByPlaylist(filteredDownloads), [filteredDownloads])
  const emptyKind = useMemo(
    () =>
      getQueueEmptyKind({
        totalCount: downloads.length,
        visibleCount: grouped.length,
        searchQuery,
        filter: queueFilter
      }),
    [downloads.length, grouped.length, searchQuery, queueFilter]
  )
  const visibleSelectionIds = useMemo(
    () => getVisibleQueueSelectionIds(grouped, playlistViewStates),
    [grouped, playlistViewStates]
  )
  const visibleSelectionIdSet = useMemo(() => new Set(visibleSelectionIds), [visibleSelectionIds])

  useEffect(() => {
    setSelectedIds((previous) => {
      const next = retainSelection(previous, visibleSelectionIdSet)
      if (next.size === previous.size && Array.from(next).every((id) => previous.has(id))) return previous
      return next
    })
    setSelectionAnchorId((previous) => (previous && visibleSelectionIdSet.has(previous) ? previous : null))
    setFocusedId((previous) => (previous && visibleSelectionIdSet.has(previous) ? previous : null))
  }, [visibleSelectionIdSet])

  const selectDownload = useCallback(
    (id: string, modifiers = {}) => {
      const next = applySelectionClick(
        visibleSelectionIds,
        selectedIds,
        selectionAnchorId,
        id,
        modifiers
      )
      const wasSingle = selectedIds.size === 1
      setSelectedIds(next.selected)
      setSelectionAnchorId(next.anchor)
      setFocusedId(next.selected.size === 1 && next.selected.has(id) ? id : null)
      if (next.selected.size === 1 && (!wasSingle || shouldOpenDownloadDetails(focusedId, id))) {
        setRightInspectorCollapsed(false)
      }
    },
    [visibleSelectionIds, selectedIds, selectionAnchorId, focusedId]
  )

  const selectPlaylist = useCallback(
    (playlistId: string, modifiers = {}) => {
      const selectionId = getPlaylistSelectionId(playlistId)
      const next = applySelectionClick(
        visibleSelectionIds,
        selectedIds,
        selectionAnchorId,
        selectionId,
        modifiers
      )
      setSelectedIds(next.selected)
      setSelectionAnchorId(next.anchor)
      const onlySelectedId = next.selected.size === 1 ? next.selected.values().next().value ?? null : null
      const nextFocusedId = onlySelectedId && !getPlaylistIdFromSelectionId(onlySelectedId) ? onlySelectedId : null
      setFocusedId(nextFocusedId)
      setRightInspectorCollapsed(!nextFocusedId)
    },
    [visibleSelectionIds, selectedIds, selectionAnchorId]
  )

  const selectAllVisible = useCallback(() => {
    const next = selectAllInOrder(visibleSelectionIds, selectionAnchorId)
    setSelectedIds(next.selected)
    setSelectionAnchorId(next.anchor)
    setFocusedId(next.selected.size === 1 && next.anchor && !getPlaylistIdFromSelectionId(next.anchor) ? next.anchor : null)
    if (next.selected.size === 1 && next.anchor && !getPlaylistIdFromSelectionId(next.anchor)) {
      setRightInspectorCollapsed(false)
    } else {
      setRightInspectorCollapsed(true)
    }
  }, [visibleSelectionIds, selectionAnchorId])

  const selectedDownloadIds = useMemo(() => {
    return expandQueueSelectionToDownloadIds(selectedIds, grouped)
  }, [grouped, selectedIds])

  const requestDeleteSelectedDownloads = useCallback(() => {
    if (selectedDownloadIds.length === 0) return
    setPendingDeleteIds(selectedDownloadIds)
  }, [selectedDownloadIds])

  const confirmDeleteSelectedDownloads = useCallback(() => {
    const ids = pendingDeleteIds
    if (!ids || ids.length === 0) return

    // Cmd/Ctrl+Delete removes queue records but deliberately keeps files on
    // disk. Deleting files remains an explicit action in the row/inspector.
    setPendingDeleteIds(null)
    clearQueueSelection()
    removeDownloads(ids)
    if (window.api?.deleteTasks) {
      void window.api.deleteTasks(ids).catch(() => {
        void refreshDownloads()
      })
    }
  }, [pendingDeleteIds, clearQueueSelection, removeDownloads, refreshDownloads])

  const downloadShortcutScopeEnabled =
    mainView === 'downloads' &&
    !showFormatDialog &&
    !showDouyinProfilePicker &&
    !showCollectionPicker &&
    !showClearDialog &&
    pendingDeleteIds === null

  const focusDownloadSearch = useCallback(() => {
    if (!downloadShortcutScopeEnabled) return
    setSearchFocusSignal((value) => value + 1)
  }, [downloadShortcutScopeEnabled])

  const refreshDownloadQueue = useCallback(() => {
    if (!downloadShortcutScopeEnabled) return
    void refreshDownloads()
  }, [downloadShortcutScopeEnabled, refreshDownloads])

  useEffect(() => {
    const unsubscribeFocus = window.api?.onFocusDownloadSearch?.(focusDownloadSearch)
    const unsubscribeRefresh = window.api?.onRefreshDownloads?.(refreshDownloadQueue)
    return () => {
      unsubscribeFocus?.()
      unsubscribeRefresh?.()
    }
  }, [focusDownloadSearch, refreshDownloadQueue])

  useKeyboardShortcuts({
    onPaste: handlePaste,
    onOpenPreferences: mainView === 'downloads' ? openPreferences : undefined,
    onFocusSearch: downloadShortcutScopeEnabled ? focusDownloadSearch : undefined,
    onRefresh: downloadShortcutScopeEnabled ? refreshDownloadQueue : undefined,
    onSelectAll: selectAllVisible,
    onClearSelection: clearQueueSelection,
    onDeleteSelection: requestDeleteSelectedDownloads,
    selectionEnabled: downloadShortcutScopeEnabled
  })

  const selectedDownload = useMemo(
    () => (focusedId ? downloads.find((d) => d.id === focusedId) ?? null : null),
    [downloads, focusedId]
  )

  const handlePlaylistViewStateChange = useCallback(
    (playlistId: string, state: PlaylistViewState) => {
      setPlaylistViewStates((previous) => {
        const current = previous[playlistId]
        if (current?.expanded === state.expanded && current?.showAll === state.showAll) return previous
        return { ...previous, [playlistId]: state }
      })
    },
    []
  )

  const queueSummary = useMemo(() => {
    let completeCount = 0
    let hasResumable = false
    let hasActive = false
    let totalSpeedBytes = 0
    for (const download of downloads) {
      if (download.status === 'complete') completeCount += 1
      if (RESUMABLE_STATUSES.has(download.status)) hasResumable = true
      if (download.status === 'downloading' || download.status === 'queued') hasActive = true
      if (download.status === 'downloading' && download.speed) totalSpeedBytes += parseSpeedToBytes(download.speed)
    }
    return { completeCount, hasResumable, hasActive, totalSpeedBytes }
  }, [downloads])
  const { completeCount, hasResumable, hasActive, totalSpeedBytes } = queueSummary
  const statusText = `${downloads.length} Download${downloads.length !== 1 ? 's' : ''} · ${completeCount} Complete`
  const rawTotalSpeed = totalSpeedBytes > 0 ? formatSpeed(totalSpeedBytes) : null
  const totalSpeed = useThrottledValue(rawTotalSpeed, 2000)

  const onDropUrl = useCallback(
    (url: string) => {
      void handleExternalUrl(url)
    },
    [handleExternalUrl]
  )

  const preferencesMode = mainView === 'preferences'
  const trafficInset = typeof window !== 'undefined' && window.api?.platform === 'darwin'

  return (
    <DownloadActionsProvider
      refreshDownloads={refreshDownloads}
      removeDownload={removeDownload}
      removeDownloads={removeDownloads}
      updateDownload={updateDownload}
    >
      <div className="flex h-screen min-h-0 min-w-0 w-full flex-col bg-background text-foreground">
        <TitleBar
          title={preferencesMode ? 'Preferences' : 'V-Download'}
          trafficInset={trafficInset}
          showInspectorToggle={!preferencesMode}
          inspectorAvailable={selectedIds.size === 1 && Boolean(selectedDownload)}
          inspectorCollapsed={rightInspectorCollapsed}
          onToggleInspector={() => setRightInspectorCollapsed((c) => !c)}
          themePreference={themePreference}
          onThemePreference={setThemePreference}
          resolvedTheme={resolvedTheme}
        />

        {cookieSyncBanner && (
          <div
            className={cn(
              'flex-shrink-0 flex items-start gap-3 px-4 py-3 border-b border-divider-subtle',
              cookieSyncBanner.kind === 'ok' && 'bg-state-complete-bg',
              (cookieSyncBanner.kind === 'progress' || cookieSyncBanner.kind === 'wait') && 'bg-selection',
              cookieSyncBanner.kind === 'warn' && 'bg-state-error-bg'
            )}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            role="status"
          >
            {(cookieSyncBanner.kind === 'progress' || cookieSyncBanner.kind === 'wait') && (
              <Loader2 className="w-5 h-5 shrink-0 mt-0.5 animate-spin text-foreground" aria-hidden />
            )}
            {cookieSyncBanner.kind === 'ok' && (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-foreground" aria-hidden />
            )}
            {cookieSyncBanner.kind === 'warn' && (
              <Info className="w-5 h-5 shrink-0 text-foreground" aria-hidden />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{cookieSyncBanner.title}</p>
              {cookieSyncBanner.detail && (
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{cookieSyncBanner.detail}</p>
              )}
            </div>
            <HoverHintWrap text="Dismiss cookie sync message" side="bottom">
              <button
                type="button"
                className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-control transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                onClick={dismissCookieSyncBanner}
                aria-label="Dismiss cookie sync message"
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
            </HoverHintWrap>
          </div>
        )}

        <div className="flex h-0 min-h-0 min-w-0 flex-1 flex-row items-stretch overflow-hidden bg-background">
          <AppSidebar
            collapsed={leftSidebarCollapsed}
            onToggleCollapsed={() => setLeftSidebarCollapsed((c) => !c)}
            mainView={mainView}
            prefSection={prefSection}
            onSelectQueue={() => setMainView('downloads')}
            onSelectPrefSection={(id) => {
              setMainView('preferences')
              setPrefSection(id)
            }}
          />

          {preferencesMode ? (
            <PreferencesPanel section={prefSection} />
          ) : (
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
              <div
                className={cn(
                  'flex min-h-0 min-w-0 flex-1 flex-col bg-window',
                  selectedIds.size === 1 && selectedDownload && !rightInspectorCollapsed && 'border-r border-border'
                )}
              >
                <QueueToolbar
                  searchQuery={searchQuery}
                  onSearchQuery={setSearchQuery}
                  onDropUrl={onDropUrl}
                  selectedCount={selectedIds.size}
                  onClearSelection={clearQueueSelection}
                  focusSearchSignal={searchFocusSignal > 0 ? searchFocusSignal : undefined}
                  visibleCount={filteredDownloads.length}
                  attentionCount={attentionCount}
                  queueFilter={queueFilter}
                  onQueueFilter={setQueueFilter}
                />

                <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  {errorMsg && (
                    <StatusBlock tone="error" className="shrink-0 rounded-none border-b border-divider-subtle px-4 py-2 text-xs">
                      {errorMsg}
                    </StatusBlock>
                  )}

                  {emptyKind === 'ready' ? (
                    <EmptyState
                      className="flex-1"
                      title="Your queue is ready"
                      description="Paste a URL with Cmd+V, drop a link here, or use the browser companion for logged-in pages."
                    />
                  ) : emptyKind === 'noSearchMatches' ? (
                    <EmptyState
                      className="flex-1"
                      title={`No downloads match “${searchQuery.trim()}”`}
                      description="Try another title, URL, or clear the search to see the full queue."
                      action={
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="min-h-10 rounded-button bg-action px-4 text-sm font-medium text-action-fg hover:bg-action-hover"
                        >
                          Clear search
                        </button>
                      }
                    />
                  ) : emptyKind === 'noFilterMatches' ? (
                    <EmptyState
                      className="flex-1"
                      title="No items in this view"
                      description="This filter has no matching downloads right now."
                      action={
                        <button
                          type="button"
                          onClick={() => setQueueFilter('all')}
                          className="min-h-10 rounded-button bg-action px-4 text-sm font-medium text-action-fg hover:bg-action-hover"
                        >
                          Show all
                        </button>
                      }
                    />
                  ) : (
                    <VirtualizedQueue
                      items={grouped}
                      selectedIds={selectedIds}
                      onSelectDownload={selectDownload}
                      onSelectReadyResolve={selectReadyResolve}
                      onSelectPlaylist={selectPlaylist}
                      playlistViewStates={playlistViewStates}
                      onPlaylistViewStateChange={handlePlaylistViewStateChange}
                    />
                  )}
                </main>
                <BottomBar
                  statusText={statusText}
                  totalSpeed={totalSpeed}
                  hasResumable={hasResumable}
                  hasActive={hasActive}
                  hasDownloads={downloads.length > 0}
                  onResumeAll={handleResumeAll}
                  onPauseAll={handlePauseAll}
                  onSyncCookies={handleBrowserCookieSync}
                  syncCookiesBusy={cookieSyncBusy}
                  syncCookiesPhase={syncCookiesPhase}
                  onClear={() => setShowClearDialog(true)}
                />
              </div>

              {selectedIds.size === 1 && shouldRenderDownloadDetails(selectedDownload?.id ?? null, rightInspectorCollapsed) && selectedDownload && (
                <DownloadInspector
                  download={selectedDownload}
                  downloadDir={settings.downloadDir}
                  onSyncBrowserCookies={handleBrowserCookieSync}
                  onClose={closeDownloadDetails}
                />
              )}
            </div>
          )}
        </div>

        {showDouyinProfilePicker && douyinProfileUrl ? (
          <DouyinProfilePickerDialog
            profileUrl={douyinProfileUrl}
            settings={settings}
            onClose={closeDouyinProfilePicker}
          />
        ) : null}

        {showCollectionPicker && collectionPickerUrl ? (
          <CollectionPickerDialog
            sourceUrl={collectionPickerUrl}
            settings={settings}
            onClose={closeCollectionPicker}
          />
        ) : null}

        {showFormatDialog && pendingVideoInfo && (
          <FormatDialog
            videoInfo={pendingVideoInfo}
            onClose={() => {
              setShowFormatDialog(false)
              clearPending()
            }}
            onDownload={handleDownload}
            settings={settings}
            siteRule={(() => { try { const host = new URL(pendingVideoInfo.webpage_url).hostname.toLowerCase(); return (settings.siteRules ?? []).find((r) => { const domain = r.domain.trim().toLowerCase(); return r.enabled && domain && (host === domain || host.endsWith(`.${domain}`)) }) } catch { return undefined } })()}
            queueCount={queueCount}
            onSkipAll={() => {
              clearQueue()
              setShowFormatDialog(false)
              clearPending()
            }}
            onOpenPreferencesForDouyinBulk={openDouyinBulkPreferences}
          />
        )}

        {showClearDialog && (
          <ClearDialog
            onClose={() => setShowClearDialog(false)}
            onClearCompleted={handleClearCompleted}
            onClearAll={handleClearAll}
          />
        )}

        {pendingDeleteIds && (
          <DeleteSelectionDialog
            count={pendingDeleteIds.length}
            onClose={() => setPendingDeleteIds(null)}
            onConfirm={confirmDeleteSelectedDownloads}
          />
        )}

        {settings.onboardingCompleted === false && (
          <OnboardingWizard settings={settings} onComplete={completeOnboarding} />
        )}
      </div>
    </DownloadActionsProvider>
  )
}
