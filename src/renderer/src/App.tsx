import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Loader2, CheckCircle2, Info, X } from 'lucide-react'
import { TitleBar } from '@/components/TitleBar'
import { BottomBar } from '@/components/BottomBar'
import { DownloadItem } from '@/components/DownloadItem'
import { PlaylistGroup } from '@/components/PlaylistGroup'
import { FormatDialog } from '@/components/FormatDialog'
import { DouyinProfilePickerDialog } from '@/components/DouyinProfilePickerDialog'
import { CollectionPickerDialog } from '@/components/CollectionPickerDialog'
import { MediaPickerDialog } from '@/components/MediaPickerDialog'
import type { DetectedMedia } from '@/components/MediaPickerDialog'
import { ClearDialog } from '@/components/ClearDialog'
import { PreferencesPanel } from '@/components/PreferencesPanel'
import { CoinLoader } from '@/components/CoinLoader'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { DownloadActionsProvider } from '@/contexts/DownloadActionsContext'
import { AppSidebar } from '@/components/AppSidebar'
import { HoverHintWrap } from '@/components/HoverHintWrap'
import { QueueToolbar } from '@/components/QueueToolbar'
import { DownloadInspector } from '@/components/DownloadInspector'
import { useDownloads } from '@/hooks/useDownloads'
import { useSettings } from '@/hooks/useSettings'
import { useUrlHandler } from '@/hooks/useUrlHandler'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { groupDownloadsByPlaylist } from '@/utils/downloads'
import { filterDownloadsBySearch } from '@/utils/queueFilters'
import { isPlaylistUrl } from '@/utils/youtube'
import { DOUYIN_BULK_URL_PREFILL_SESSION_KEY } from '@/utils/douyinBulk'
import { parseSpeedToBytes, formatSpeed } from '@/utils/format'
import { useThrottledValue } from '@/hooks/useThrottledValue'
import { useThemePreference } from '@/hooks/useThemePreference'
import { cn } from '@/lib/cn'
import type { Download, Playlist } from '@/types'
import type { PrefSection } from '@/preferencesNav'

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

function collectIdsFromGrouped(grouped: (Download | Playlist)[]): Set<string> {
  const ids = new Set<string>()
  for (const item of grouped) {
    if ('downloads' in item && Array.isArray(item.downloads)) {
      for (const d of item.downloads) ids.add(d.id)
    } else if ('status' in item) {
      ids.add((item as Download).id)
    }
  }
  return ids
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
    loading,
    loadingPhase,
    errorMsg,
    showFormatDialog,
    showDouyinProfilePicker,
    douyinProfileUrl,
    showCollectionPicker,
    collectionPickerUrl,
    pendingVideoInfo,
    pendingEntries,
    pendingPlaylistMeta,
    sniffedMedia,
    sniffedPageUrl,
    sniffedPageTitle,
    queueCount,
    handlePaste,
    handleExternalUrl,
    clearPending,
    clearSniffed,
    clearQueue,
    setShowFormatDialog,
    closeDouyinProfilePicker,
    closeCollectionPicker
  } = useUrlHandler(settings)

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showClearDialog, setShowClearDialog] = useState(false)
  const [cookieSyncBanner, setCookieSyncBanner] = useState<CookieSyncBanner>(null)
  const cookieSyncWaitRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cookieSyncDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cookieSyncSessionRef = useRef(false)
  const cookieSyncInFlightRef = useRef(false)

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
    setSelectedId(null)
    setPrefSection('general')
  }, [])

  const openDouyinBulkPreferences = useCallback((homepageUrl: string) => {
    try {
      sessionStorage.setItem(DOUYIN_BULK_URL_PREFILL_SESSION_KEY, homepageUrl)
    } catch {
      /* ignore */
    }
    setMainView('preferences')
    setSelectedId(null)
    setPrefSection('downloads')
  }, [])

  useEffect(() => {
    if (mainView === 'preferences' && window.location.hash === '#/settings') {
      normalizeSettingsHash()
    }
  }, [mainView])

  useEffect(() => {
    const syncFromHash = () => {
      if (window.location.hash === '#/settings') {
        setMainView('preferences')
        setSelectedId(null)
        setPrefSection('general')
        normalizeSettingsHash()
      }
    }
    syncFromHash()
    window.addEventListener('hashchange', syncFromHash)
    return () => window.removeEventListener('hashchange', syncFromHash)
  }, [])

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
      setSelectedId(null)
      setPrefSection('general')
    })
    return unsub
  }, [])

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

  useKeyboardShortcuts({
    onPaste: handlePaste,
    onOpenPreferences: mainView === 'downloads' ? openPreferences : undefined
  })

  useEffect(() => {
    if (!window.api?.onYtdlUrl) return
    const unsub = window.api.onYtdlUrl((url: string) => handleExternalUrl(url))
    return unsub
  }, [handleExternalUrl])

  const handleDownload = useCallback(
    async (_url: string, format: string, quality: string) => {
      if (!window.api) return

      if (pendingEntries && pendingEntries.length > 0) {
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
                channel: pendingVideoInfo?.channel ?? ''
              }
            : {
                ...(pendingVideoInfo?.channel ? { channel: pendingVideoInfo.channel } : {}),
                ...(pendingVideoInfo?.id ? { ytdlpId: pendingVideoInfo.id } : {})
              }
        })
      }

      clearPending()
      loadSettings()
    },
    [pendingVideoInfo, pendingEntries, pendingPlaylistMeta, settings.youtubePlaylistMode, loadSettings, clearPending]
  )

  const handleMediaDownload = useCallback(
    async (items: DetectedMedia[]) => {
      if (!window.api) return
      const baseTitle = sniffedPageTitle || 'download'
      for (let i = 0; i < items.length; i++) {
        const title = items.length > 1 ? `${baseTitle} (${i + 1})` : baseTitle

        await window.api.startDownload({
          url: items[i].url,
          title,
          format: 'video',
          quality: settings.defaultVideoQuality,
          referer: sniffedPageUrl || undefined,
          mediaType: items[i].type
        })
      }
      clearSniffed()
    },
    [settings.defaultVideoQuality, sniffedPageUrl, sniffedPageTitle, clearSniffed]
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
    () => filterDownloadsBySearch(downloads, searchQuery),
    [downloads, searchQuery]
  )

  const grouped = useMemo(() => groupDownloadsByPlaylist(filteredDownloads), [filteredDownloads])

  const visibleIds = useMemo(() => collectIdsFromGrouped(grouped), [grouped])

  useEffect(() => {
    if (selectedId && !visibleIds.has(selectedId)) {
      setSelectedId(null)
    }
  }, [selectedId, visibleIds])

  const selectedDownload = useMemo(
    () => (selectedId ? downloads.find((d) => d.id === selectedId) ?? null : null),
    [downloads, selectedId]
  )

  const completeCount = downloads.filter((d) => d.status === 'complete').length
  /** Matches resumeAll(): bulk resume skips user-cancelled tasks. */
  const resumableStatuses = ['paused', 'interrupted', 'error', 'queued']
  const hasResumable = downloads.some((d) => resumableStatuses.includes(d.status))
  const hasActive = downloads.some((d) => d.status === 'downloading' || d.status === 'queued')
  const statusText = `${downloads.length} Download${downloads.length !== 1 ? 's' : ''} · ${completeCount} Complete`

  const totalSpeedBytes = downloads
    .filter((d) => d.status === 'downloading' && d.speed)
    .reduce((sum, d) => sum + parseSpeedToBytes(d.speed!), 0)
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
          inspectorCollapsed={rightInspectorCollapsed}
          onToggleInspector={() => setRightInspectorCollapsed((c) => !c)}
          themePreference={themePreference}
          onThemePreference={setThemePreference}
          resolvedTheme={resolvedTheme}
        />

        {cookieSyncBanner && (
          <div
            className={cn(
              'flex-shrink-0 flex items-start gap-3 px-4 py-3 border-b border-border',
              cookieSyncBanner.kind === 'ok' && 'bg-state-complete-bg',
              (cookieSyncBanner.kind === 'progress' || cookieSyncBanner.kind === 'wait') && 'bg-state-active-bg',
              cookieSyncBanner.kind === 'warn' && 'bg-state-error-bg border-dashed'
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

        <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden bg-background">
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
            <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
              <div
                className={cn(
                  'flex min-h-0 min-w-0 flex-1 flex-col bg-window',
                  !rightInspectorCollapsed && 'border-r border-border'
                )}
              >
                <QueueToolbar
                  searchQuery={searchQuery}
                  onSearchQuery={setSearchQuery}
                  onDropUrl={onDropUrl}
                />

                <main className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">
                  {loading && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/85 backdrop-blur-sm">
                      <CoinLoader />
                      <p className="mt-4 text-sm text-muted-foreground">
                        {loadingPhase === 'sniffing' ? 'Scanning page for media' : 'Fetching video info…'}
                      </p>
                    </div>
                  )}

                  {errorMsg && (
                    <div className="shrink-0 border-b border-dashed border-border-strong bg-state-error-bg px-4 py-2">
                      <p className="text-xs text-foreground">{errorMsg}</p>
                    </div>
                  )}

                  {grouped.length === 0 && !loading ? (
                    <div className="flex h-full flex-col items-center justify-center px-8 py-12 text-center">
                      <p className="mb-2 max-w-sm text-sm text-muted-foreground">
                        Paste a URL (Cmd+V), drop a link on the queue, or use the browser companion for logged-in pages.
                      </p>
                      <p className="max-w-sm text-xs text-tertiary-foreground">
                        Supports YouTube, direct media links, and page scanning
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1 px-2 py-2">
                      {grouped.map((item) =>
                        'downloads' in item && Array.isArray(item.downloads) ? (
                          <PlaylistGroup
                            key={item.id}
                            playlist={item as Playlist}
                            selectedId={selectedId}
                            onSelectDownload={setSelectedId}
                          />
                        ) : 'status' in item ? (
                          <DownloadItem
                            key={item.id}
                            download={item as Download}
                            selected={selectedId === (item as Download).id}
                            onSelect={() => setSelectedId((item as Download).id)}
                          />
                        ) : null
                      )}
                    </div>
                  )}
                </main>
              </div>

              {!rightInspectorCollapsed && (
                <DownloadInspector
                  download={selectedDownload}
                  downloadDir={settings.downloadDir}
                  onSyncBrowserCookies={handleBrowserCookieSync}
                />
              )}
            </div>
          )}
        </div>

        {!preferencesMode && (
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
            onSettings={openPreferences}
            onClear={() => setShowClearDialog(true)}
          />
        )}

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
            queueCount={queueCount}
            onSkipAll={() => {
              clearQueue()
              setShowFormatDialog(false)
              clearPending()
            }}
            onOpenPreferencesForDouyinBulk={openDouyinBulkPreferences}
          />
        )}

        {sniffedMedia && sniffedMedia.length > 0 && (
          <MediaPickerDialog
            media={sniffedMedia}
            pageUrl={sniffedPageUrl}
            pageTitle={sniffedPageTitle}
            onClose={clearSniffed}
            onDownload={handleMediaDownload}
            queueCount={queueCount}
            onSkipAll={() => {
              clearQueue()
              clearSniffed()
            }}
          />
        )}

        {showClearDialog && (
          <ClearDialog
            onClose={() => setShowClearDialog(false)}
            onClearCompleted={handleClearCompleted}
            onClearAll={handleClearAll}
          />
        )}
      </div>
    </DownloadActionsProvider>
  )
}
