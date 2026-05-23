import { useEffect, useState, useCallback, useRef } from 'react'
import { Loader2, CheckCircle2, Info, X } from 'lucide-react'
import { TitleBar } from '@/components/TitleBar'
import { BottomBar } from '@/components/BottomBar'
import { DownloadItem } from '@/components/DownloadItem'
import { PlaylistGroup } from '@/components/PlaylistGroup'
import { FormatDialog } from '@/components/FormatDialog'
import { MediaPickerDialog } from '@/components/MediaPickerDialog'
import type { DetectedMedia } from '@/components/MediaPickerDialog'
import { ClearDialog } from '@/components/ClearDialog'
import { SettingsPage } from '@/components/Settings'
import { CoinLoader } from '@/components/CoinLoader'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { DownloadActionsProvider } from '@/contexts/DownloadActionsContext'
import { useDownloads } from '@/hooks/useDownloads'
import { useSettings } from '@/hooks/useSettings'
import { useUrlHandler } from '@/hooks/useUrlHandler'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { groupDownloadsByPlaylist } from '@/utils/downloads'
import { parseSpeedToBytes, formatSpeed } from '@/utils/format'
import { useThrottledValue } from '@/hooks/useThrottledValue'
import { cn } from '@/lib/cn'
import type { Download, Playlist } from '@/types'

export default function App() {
  const [route, setRoute] = useState(window.location.hash)

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  if (route === '#/settings') {
    return <SettingsPage />
  }

  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  )
}

type CookieSyncBanner =
  | null
  | {
      kind: 'progress' | 'wait' | 'ok' | 'warn'
      title: string
      detail?: string
    }

function MainApp() {
  const { downloads, removeDownload, updateDownload, refreshDownloads } = useDownloads()
  const { settings, loadSettings } = useSettings()
  const {
    loading,
    loadingPhase,
    errorMsg,
    showFormatDialog,
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
    setShowFormatDialog
  } = useUrlHandler(settings)

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

  const scheduleBannerDismiss = useCallback(
    (ms: number) => {
      if (cookieSyncDismissRef.current) window.clearTimeout(cookieSyncDismissRef.current)
      cookieSyncDismissRef.current = window.setTimeout(() => {
        setCookieSyncBanner(null)
        cookieSyncDismissRef.current = null
      }, ms)
    },
    [],
  )

  useEffect(() => {
    return () => clearCookieSyncTimers()
  }, [clearCookieSyncTimers])

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
        detail: `Chrome sent ${data.count} cookie entries. You can retry your download now.`,
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
      detail: 'Opening your browser and contacting the V-Download extension.',
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
            'Open http://127.0.0.1:18765/cookie-sync-landing in Chrome with the V-Download extension, or leave Chrome open — background sync can take up to about 2 minutes.',
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
            'Open http://127.0.0.1:18765/cookie-sync-landing in Chrome (with the V-Download extension). If your default browser is not Chrome, the first tab may be the wrong app. Then browse the site you need (e.g. Douyin) and click Sync cookies again.',
        })
      }, 125000)
    } catch (err) {
      cookieSyncSessionRef.current = false
      cookieSyncInFlightRef.current = false
      clearCookieSyncTimers()
      setCookieSyncBanner({
        kind: 'warn',
        title: 'Could not start sync',
        detail: err instanceof Error ? err.message : String(err),
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

  useKeyboardShortcuts({ onPaste: handlePaste })

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
            playlistTitle
          })
        }
      } else {
        const title = pendingVideoInfo?.title ?? 'Unknown'
        await window.api.startDownload({
          url: pendingVideoInfo?.webpage_url ?? _url,
          title,
          format,
          quality,
          thumbnail: pendingVideoInfo?.thumbnail,
          duration: pendingVideoInfo?.duration
        })
      }

      clearPending()
      loadSettings()
    },
    [pendingVideoInfo, pendingEntries, pendingPlaylistMeta, loadSettings, clearPending]
  )

  const handleMediaDownload = useCallback(
    async (items: DetectedMedia[]) => {
      if (!window.api) return
      const baseTitle = sniffedPageTitle || 'download'
      for (let i = 0; i < items.length; i++) {
        const title = items.length > 1
          ? `${baseTitle} (${i + 1})`
          : baseTitle

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

  const grouped = groupDownloadsByPlaylist(downloads)
  const completeCount = downloads.filter((d) => d.status === 'complete').length
  const resumableStatuses = ['paused', 'interrupted', 'cancelled', 'error', 'queued']
  const hasResumable = downloads.some((d) => resumableStatuses.includes(d.status))
  const hasActive = downloads.some((d) => d.status === 'downloading' || d.status === 'queued')
  const statusText = `${downloads.length} Download${downloads.length !== 1 ? 's' : ''} · ${completeCount} Complete`

  const totalSpeedBytes = downloads
    .filter((d) => d.status === 'downloading' && d.speed)
    .reduce((sum, d) => sum + parseSpeedToBytes(d.speed!), 0)
  const rawTotalSpeed = totalSpeedBytes > 0 ? formatSpeed(totalSpeedBytes) : null
  const totalSpeed = useThrottledValue(rawTotalSpeed, 2000)

  return (
    <DownloadActionsProvider
      refreshDownloads={refreshDownloads}
      removeDownload={removeDownload}
      updateDownload={updateDownload}
    >
      <div className="h-screen flex flex-col bg-background">
        <TitleBar />

        {cookieSyncBanner && (
          <div
            className={cn(
              'flex-shrink-0 flex items-start gap-3 px-4 py-3 border-b',
              cookieSyncBanner.kind === 'ok' && 'bg-accent-green/12 border-accent-green/30',
              (cookieSyncBanner.kind === 'progress' || cookieSyncBanner.kind === 'wait') &&
                'bg-accent-indigo/12 border-accent-indigo/35',
              cookieSyncBanner.kind === 'warn' && 'bg-accent-amber/10 border-accent-amber/25',
            )}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            role="status"
          >
            {(cookieSyncBanner.kind === 'progress' || cookieSyncBanner.kind === 'wait') && (
              <Loader2
                className="w-5 h-5 shrink-0 mt-0.5 animate-spin text-accent-indigo"
                aria-hidden
              />
            )}
            {cookieSyncBanner.kind === 'ok' && (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-accent-green" aria-hidden />
            )}
            {cookieSyncBanner.kind === 'warn' && (
              <Info className="w-5 h-5 shrink-0 text-accent-amber" aria-hidden />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{cookieSyncBanner.title}</p>
              {cookieSyncBanner.detail && (
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{cookieSyncBanner.detail}</p>
              )}
            </div>
            <button
              type="button"
              className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface/80 transition-colors"
              onClick={dismissCookieSyncBanner}
              aria-label="Dismiss cookie sync message"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <main className="flex-1 overflow-y-auto min-h-0 relative">
          {loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
              <CoinLoader />
              <p className="text-accent-indigo text-sm animate-pulse mt-4">
                {loadingPhase === 'sniffing' ? 'Scanning page for media...' : 'Fetching video info...'}
              </p>
            </div>
          )}

          {errorMsg && (
            <div className="px-4 py-2 bg-accent-coral/10 border-b border-accent-coral/20">
              <p className="text-accent-coral text-xs">{errorMsg}</p>
            </div>
          )}

          {grouped.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <p className="text-muted-foreground text-sm mb-2">
                Paste a URL (Cmd+V) to add a download
              </p>
              <p className="text-tertiary-foreground text-xs">
                Supports YouTube, direct media links, and page scanning
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {grouped.map((item) =>
                'downloads' in item && Array.isArray(item.downloads) ? (
                  <PlaylistGroup key={item.id} playlist={item as Playlist} />
                ) : 'status' in item ? (
                  <DownloadItem key={item.id} download={item as Download} />
                ) : null
              )}
            </div>
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
          onSettings={() => window.api?.openSettings()}
          onClear={() => setShowClearDialog(true)}
        />

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
