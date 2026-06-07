import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { Folder, RefreshCw, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Stepper } from './Stepper'
import { HoverHintWrap } from './HoverHintWrap'
import type { PrefSection } from '@/preferencesNav'
import { PREF_SECTION_HEADER } from '@/preferencesNav'
import type { DouyinBulkJobStatus, SettingsData } from '@/types'
import { DOUYIN_BULK_URL_PREFILL_SESSION_KEY } from '@/utils/douyinBulk'

const VIDEO_QUALITIES = ['2160', '1080', '720', '360', '240', '144']
const AUDIO_QUALITIES = ['320', '256', '128']

export interface PreferencesPanelProps {
  section: PrefSection
}

function PrefCard({
  title,
  subtitle,
  children
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {subtitle ? (
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </div>
  )
}

function FieldBlock({
  label,
  description,
  children
}: {
  label: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description ? (
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  )
}

export function PreferencesPanel({ section }: PreferencesPanelProps) {
  const [cookieSyncNote, setCookieSyncNote] = useState('')
  const [cookieSyncBusy, setCookieSyncBusy] = useState(false)
  const cookieSyncWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const awaitingCookiePushRef = useRef(false)
  const [settings, setSettings] = useState<SettingsData>({
    downloadDir: '',
    concurrency: 3,
    showFormatDialog: true,
    playlistSubfolder: true,
    defaultVideoQuality: '1080',
    defaultAudioQuality: '320',
    sleepInterval: 3,
    cookiesPath: '',
    cookiesFromBrowser: 'chrome',
    douyinUseCloakBrowser: false,
    youtubePlaylistMode: 'native',
    youtubePlaylistSleepRequests: 0,
    youtubePlaylistMaxDownloads: 0,
    douyinBulkRunPyPath: '',
    douyinBulkConfigPath: '',
    douyinBulkOutputPath: '',
    douyinBulkThreads: 5,
    douyinBulkVerboseWarnings: false,
    ytdlpPath: '',
    ffmpegPath: '',
    directMediaEngine: 'auto',
    concurrentFragments: 5,
    downloadSpeedMode: 'balanced',
    turboRiskAcknowledged: false,
    ytdlpExternalDownloader: ''
  })
  const [bulkUrl, setBulkUrl] = useState('')
  const [bulkJobId, setBulkJobId] = useState('')
  const [bulkJob, setBulkJob] = useState<DouyinBulkJobStatus | null>(null)
  const [bulkJobBusy, setBulkJobBusy] = useState(false)
  const [bulkJobNote, setBulkJobNote] = useState('')
  const [turboModalOpen, setTurboModalOpen] = useState(false)

  const header = PREF_SECTION_HEADER[section]

  useEffect(() => {
    if (!window.api) return
    window.api.getSettings().then((res) => {
      const data = (res as { data?: SettingsData })?.data ?? res
      if (data) setSettings((prev) => ({ ...prev, ...data }))
    })
  }, [])

  useEffect(() => {
    if (!window.api?.onSettingsChanged) return
    const unsub = window.api.onSettingsChanged(() => {
      window.api?.getSettings().then((res) => {
        const data = (res as { data?: SettingsData })?.data ?? res
        if (data) setSettings((prev) => ({ ...prev, ...data }))
      })
    })
    return unsub
  }, [])

  useEffect(() => {
    if (section !== 'downloads') return
    try {
      const v = sessionStorage.getItem(DOUYIN_BULK_URL_PREFILL_SESSION_KEY)
      if (v) {
        sessionStorage.removeItem(DOUYIN_BULK_URL_PREFILL_SESSION_KEY)
        setBulkUrl(v)
        setBulkJobNote(
          'Profile URL prefilled. Ensure run.py, config.yml, and `mode` / `number` in config match upstream docs, then Start bulk.'
        )
      }
    } catch {
      /* ignore */
    }
  }, [section])

  useEffect(() => {
    if (!window.api?.onCookiesSynced) return
    const unsub = window.api.onCookiesSynced((data) => {
      if (!awaitingCookiePushRef.current) {
        window.api?.getSettings().then((res) => {
          const d = (res as { data?: SettingsData })?.data ?? res
          if (d) setSettings((prev) => ({ ...prev, ...d }))
        })
        return
      }
      awaitingCookiePushRef.current = false
      if (cookieSyncWaitTimerRef.current) {
        window.clearTimeout(cookieSyncWaitTimerRef.current)
        cookieSyncWaitTimerRef.current = null
      }
      setCookieSyncBusy(false)
      setCookieSyncNote(`Cookies saved (${data.count} entries). You can retry your download now.`)
      window.setTimeout(() => setCookieSyncNote(''), 6000)
      window.api?.getSettings().then((res) => {
        const d = (res as { data?: SettingsData })?.data ?? res
        if (d) setSettings((prev) => ({ ...prev, ...d }))
      })
    })
    return unsub
  }, [])

  useEffect(() => {
    return () => {
      if (cookieSyncWaitTimerRef.current) window.clearTimeout(cookieSyncWaitTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!bulkJobId || !window.api?.getDouyinBulkStatus) return

    let active = true
    let intervalId: ReturnType<typeof window.setInterval> | null = null

    const pollStatus = async () => {
      if (!active) return
      try {
        const result = await window.api.getDouyinBulkStatus!(bulkJobId)
        if (!active) return

        if (result.error) {
          setBulkJobNote(result.error)
          return
        }

        if (result.data) {
          setBulkJob(result.data)
          if (result.data.state !== 'running' && intervalId !== null) {
            window.clearInterval(intervalId)
            intervalId = null
          }
        }
      } catch (err) {
        if (!active) return
        setBulkJobNote(err instanceof Error ? err.message : String(err))
      }
    }

    void pollStatus()
    intervalId = window.setInterval(() => {
      void pollStatus()
    }, 1200)

    return () => {
      active = false
      if (intervalId !== null) window.clearInterval(intervalId)
    }
  }, [bulkJobId])

  const onUpdate = useCallback(async (key: string, value: unknown) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    if (window.api) await window.api.updateSettings(key, value)
  }, [])

  const refreshSettingsFromMain = useCallback(async () => {
    if (!window.api) return
    const res = await window.api.getSettings()
    const data = (res as { data?: SettingsData })?.data ?? res
    if (data) setSettings((prev) => ({ ...prev, ...data }))
  }, [])

  const handleDownloadSpeedMode = useCallback(
    async (mode: 'balanced' | 'turbo' | 'gentle') => {
      if (!window.api?.applyDownloadSpeedMode) return
      const current = settings.downloadSpeedMode ?? 'balanced'
      if (mode === current) return
      if (mode === 'turbo' && !settings.turboRiskAcknowledged) {
        setTurboModalOpen(true)
        return
      }
      const result = await window.api.applyDownloadSpeedMode(mode, {})
      if (!result.ok && result.error === 'turbo_ack_required') {
        setTurboModalOpen(true)
        return
      }
      await refreshSettingsFromMain()
    },
    [refreshSettingsFromMain, settings.downloadSpeedMode, settings.turboRiskAcknowledged]
  )

  const confirmTurboMode = useCallback(async () => {
    if (!window.api?.applyDownloadSpeedMode) return
    await window.api.applyDownloadSpeedMode('turbo', { acknowledgeTurboRisk: true })
    setTurboModalOpen(false)
    await refreshSettingsFromMain()
  }, [refreshSettingsFromMain])

  const handleForceCookieSync = async () => {
    if (!window.api?.requestBrowserCookieSync || cookieSyncBusy) return
    if (cookieSyncWaitTimerRef.current) {
      window.clearTimeout(cookieSyncWaitTimerRef.current)
      cookieSyncWaitTimerRef.current = null
    }
    awaitingCookiePushRef.current = true
    setCookieSyncBusy(true)
    setCookieSyncNote('Opening your browser — you will see progress here when cookies arrive.')

    try {
      const res = await window.api.requestBrowserCookieSync()
      setCookieSyncNote(
        res.openedBrowser
          ? 'Waiting for Chrome: use the new tab and wait for “Saved”. If it opened in Safari or another browser, paste http://127.0.0.1:18765/cookie-sync-landing into Chrome. Background sync can take up to ~2 minutes — keep this window open.'
          : res.message ||
            'Open http://127.0.0.1:18765/cookie-sync-landing in Chrome with the V-Download extension.'
      )
      cookieSyncWaitTimerRef.current = window.setTimeout(() => {
        cookieSyncWaitTimerRef.current = null
        awaitingCookiePushRef.current = false
        setCookieSyncBusy(false)
        setCookieSyncNote(
          'Still waiting. Open the sync URL in Chrome with the extension (not Safari). Visit the site you need, then click Sync cookies again.'
        )
      }, 125000)
    } catch (err) {
      awaitingCookiePushRef.current = false
      setCookieSyncBusy(false)
      setCookieSyncNote(err instanceof Error ? err.message : String(err))
    }
  }

  const handleBrowse = async () => {
    if (!window.api?.selectDownloadFolder) return
    try {
      const result = await window.api.selectDownloadFolder()
      if (result) onUpdate('downloadDir', result)
    } catch {
      // ignore
    }
  }

  const handleBrowseBulkOutput = async () => {
    if (!window.api?.selectDownloadFolder) return
    try {
      const result = await window.api.selectDownloadFolder()
      if (result) onUpdate('douyinBulkOutputPath', result)
    } catch {
      // ignore
    }
  }

  const handleStartDouyinBulk = async () => {
    const url = bulkUrl.trim()
    if (!url || !window.api?.startDouyinBulk || bulkJobBusy) return

    setBulkJobBusy(true)
    setBulkJobNote('')
    try {
      const result = await window.api.startDouyinBulk(url)
      const id = result.data?.id
      if (result.error) {
        setBulkJobNote(result.error)
        return
      }
      if (!id) {
        setBulkJobNote('Bulk job did not return a job id.')
        return
      }

      setBulkJobId(id)
      setBulkJob({
        id,
        state: 'running',
        startedAt: new Date().toISOString(),
        stderrTail: ''
      })
      setBulkJobNote('Douyin bulk job started. Status updates every 1.2s.')
    } catch (err) {
      setBulkJobNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBulkJobBusy(false)
    }
  }

  const handleCancelDouyinBulk = async () => {
    if (!bulkJobId || !window.api?.cancelDouyinBulk || bulkJobBusy) return

    setBulkJobBusy(true)
    setBulkJobNote('')
    try {
      const result = await window.api.cancelDouyinBulk(bulkJobId)
      if (result.error) {
        setBulkJobNote(result.error)
        return
      }
      if (!result.ok) {
        setBulkJobNote('Cancel request was not accepted for this job.')
        return
      }
      setBulkJob((prev) => (prev ? { ...prev, state: 'cancelled', endedAt: new Date().toISOString() } : prev))
      setBulkJobNote('Cancel request sent.')
    } catch (err) {
      setBulkJobNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBulkJobBusy(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 min-w-0 bg-window">
      <header
        className="shrink-0 px-6 py-4 border-b border-border bg-window"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground tracking-tight">{header.title}</h1>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-2xl">{header.subtitle}</p>
        </div>
      </header>

      <div
        className="flex-1 overflow-y-auto p-6 min-h-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {section === 'general' && (
          <div className="max-w-2xl space-y-6">
            <PrefCard title="Behavior" subtitle="What happens before each download starts.">
              <ToggleRow
                label="Show format picker before download"
                checked={settings.showFormatDialog}
                onChange={(v) => onUpdate('showFormatDialog', v)}
              />
              <ToggleRow
                label="Create playlist and channel subfolders"
                checked={settings.playlistSubfolder}
                onChange={(v) => onUpdate('playlistSubfolder', v)}
              />
            </PrefCard>
          </div>
        )}

        {section === 'downloads' && (
          <div className="max-w-2xl space-y-6">
            <PrefCard
              title="Storage"
              subtitle="Default folder for completed files (you can still pick another destination in the format dialog)."
            >
              <FieldBlock label="Download location" description="Shown in the sidebar for quick reference.">
                <div className="flex gap-2">
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-raised border border-border min-w-0">
                    <Folder className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
                    <span className="text-sm text-foreground truncate">{settings.downloadDir}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleBrowse}
                    className="px-4 py-2 rounded-lg bg-elevated border border-border text-sm font-medium text-foreground hover:bg-control transition-colors shrink-0"
                  >
                    Browse
                  </button>
                </div>
              </FieldBlock>
            </PrefCard>

            <PrefCard
              title="Download speed"
              subtitle="Presets tune parallel queue slots, yt-dlp sleep between operations, fragment concurrency, and the direct-media engine. Default is Balanced."
            >
              <FieldBlock
                label="Mode"
                description="Turbo enables higher parallelism and zero sleep between operations; some CDNs may return HTTP 429 (rate limit)."
              >
                <div className="flex flex-wrap gap-2">
                  {(['balanced', 'turbo', 'gentle'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => void handleDownloadSpeedMode(mode)}
                      className={cn(
                        'px-4 py-2 rounded-lg border text-sm font-medium transition-colors capitalize',
                        (settings.downloadSpeedMode ?? 'balanced') === mode
                          ? 'border-white/40 bg-control text-foreground'
                          : 'border-border bg-elevated text-foreground hover:bg-control'
                      )}
                    >
                      {mode === 'balanced' ? 'Balanced' : mode === 'turbo' ? 'Turbo' : 'Gentle'}
                    </button>
                  ))}
                </div>
              </FieldBlock>
            </PrefCard>

            <PrefCard
              title="Queue"
              subtitle="Balance speed with system and network reliability. A short delay between starts helps with rate limits."
            >
              <FieldBlock
                label="Concurrent downloads"
                description="Limit parallel downloads when the host or your connection is sensitive to bursts."
              >
                <Stepper value={settings.concurrency} min={1} max={10} onChange={(v) => onUpdate('concurrency', v)} />
              </FieldBlock>
              <FieldBlock
                label="Delay between download starts"
                description="Maps to yt-dlp --sleep-interval for normal page URLs (not extension direct-media tasks). Minimum wait before each download operation."
              >
                <Stepper
                  value={settings.sleepInterval}
                  min={0}
                  max={30}
                  suffix="s"
                  onChange={(v) => onUpdate('sleepInterval', v)}
                />
              </FieldBlock>
              <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-3">
                Automatic retry for interrupted items and battery-aware pauses are on the roadmap (see v2 Downloads
                mockup); today you can use <span className="text-foreground">Retry</span> on failed rows in the queue.
              </p>
            </PrefCard>

            <PrefCard
              title="Direct media (sniff / extension)"
              subtitle="URLs with a detected media type (HLS, MP4, …). Auto uses yt-dlp first for HLS (.m3u8) for faster parallel fragments; other types still try ffmpeg first with yt-dlp fallback."
            >
              <FieldBlock
                label="Direct media engine"
                description="Applies to sniffed or extension-sent CDN URLs, not full watch pages (those stay on yt-dlp)."
              >
                <select
                  value={settings.directMediaEngine ?? 'auto'}
                  onChange={(e) =>
                    onUpdate('directMediaEngine', e.target.value as 'auto' | 'ffmpeg' | 'ytdlp')
                  }
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-white/30"
                >
                  <option value="auto">Auto — HLS via yt-dlp first; other CDN URLs ffmpeg first</option>
                  <option value="ffmpeg">ffmpeg only</option>
                  <option value="ytdlp">yt-dlp only</option>
                </select>
              </FieldBlock>
              <FieldBlock
                label="Concurrent fragments (yt-dlp)"
                description="Passed as --concurrent-fragments for fragmented streams (HLS, DASH, ISM) on all yt-dlp downloads when set above 1. Higher values can be faster but may trigger rate limits."
              >
                <Stepper
                  value={settings.concurrentFragments ?? 5}
                  min={1}
                  max={32}
                  onChange={(v) => onUpdate('concurrentFragments', v)}
                />
              </FieldBlock>
              <FieldBlock
                label="External downloader (optional)"
                description="yt-dlp --downloader, e.g. aria2c (must be installed and on PATH). Leave empty for the built-in downloader."
              >
                <input
                  type="text"
                  value={settings.ytdlpExternalDownloader ?? ''}
                  onChange={(e) => onUpdate('ytdlpExternalDownloader', e.target.value)}
                  placeholder="aria2c"
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-white/30"
                />
              </FieldBlock>
            </PrefCard>

            <PrefCard
              title="YouTube playlists"
              subtitle="Channel and list URLs can be one yt-dlp job (fewer tasks, stable ordering) or many parallel tasks (legacy)."
            >
              <FieldBlock label="Playlist mode" description="Native mode uses the original list/channel URL with yt-dlp’s playlist options. Fan-out queues one task per video.">
                <select
                  value={settings.youtubePlaylistMode ?? 'native'}
                  onChange={(e) => onUpdate('youtubePlaylistMode', e.target.value)}
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-white/30"
                >
                  <option value="native">Single yt-dlp job (recommended)</option>
                  <option value="fanout">One task per video</option>
                </select>
              </FieldBlock>
              <FieldBlock
                label="Sleep between playlist requests"
                description="Maps to yt-dlp --sleep-requests for native playlist downloads (seconds)."
              >
                <Stepper
                  value={settings.youtubePlaylistSleepRequests ?? 0}
                  min={0}
                  max={30}
                  suffix="s"
                  onChange={(v) => onUpdate('youtubePlaylistSleepRequests', v)}
                />
              </FieldBlock>
              <FieldBlock
                label="Max videos per native playlist"
                description="0 = no limit. Passed as --max-downloads for native playlist mode."
              >
                <Stepper
                  value={settings.youtubePlaylistMaxDownloads ?? 0}
                  min={0}
                  max={500}
                  onChange={(v) => onUpdate('youtubePlaylistMaxDownloads', v)}
                />
              </FieldBlock>
            </PrefCard>

            <PrefCard
              title="Douyin bulk (optional)"
              subtitle="Creator/profile bulk via external jiji262/douyin-downloader. Align `-p` with your app download folder using the fields below; `mode`, `number`, and cookies stay in config.yml per upstream README."
            >
              <div className="text-xs text-muted-foreground leading-relaxed">
                <a
                  href="https://github.com/jiji262/douyin-downloader#minimal-working-config"
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline font-medium hover:no-underline"
                >
                  Open upstream README (minimal config)
                </a>
                <span className="text-muted-foreground"> — link, mode, number.post, browser_fallback, cookies.</span>
              </div>
              <FieldBlock label="Path to run.py" description="Absolute path to douyin-downloader run.py.">
                <input
                  type="text"
                  value={settings.douyinBulkRunPyPath ?? ''}
                  onChange={(e) => onUpdate('douyinBulkRunPyPath', e.target.value)}
                  placeholder="/path/to/douyin-downloader/run.py"
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-white/30"
                />
              </FieldBlock>
              <FieldBlock label="Path to config.yml" description="Config file passed as -c to run.py.">
                <input
                  type="text"
                  value={settings.douyinBulkConfigPath ?? ''}
                  onChange={(e) => onUpdate('douyinBulkConfigPath', e.target.value)}
                  placeholder="/path/to/douyin-downloader/config.yml"
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-white/30"
                />
              </FieldBlock>
              <FieldBlock
                label="Bulk output directory (-p)"
                description="Passed to run.py as -p / --path. Empty uses the same folder as Default download directory above."
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="text"
                    value={settings.douyinBulkOutputPath ?? ''}
                    onChange={(e) => onUpdate('douyinBulkOutputPath', e.target.value)}
                    placeholder="(use default download directory)"
                    className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-white/30"
                  />
                  <button
                    type="button"
                    onClick={handleBrowseBulkOutput}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-elevated text-xs font-medium text-foreground hover:bg-control"
                  >
                    <Folder size={14} aria-hidden />
                    Choose folder
                  </button>
                </div>
              </FieldBlock>
              <FieldBlock
                label="Downloader threads (-t)"
                description="Maps to douyin-downloader --thread (parallel work inside the Python tool; separate from app queue concurrency)."
              >
                <Stepper
                  value={settings.douyinBulkThreads ?? 5}
                  min={1}
                  max={32}
                  onChange={(v) => onUpdate('douyinBulkThreads', v)}
                />
              </FieldBlock>
              <FieldBlock
                label="Verbose CLI warnings"
                description="Adds --show-warnings so stderr may include more detail for troubleshooting (see job log below)."
              >
                <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={Boolean(settings.douyinBulkVerboseWarnings)}
                    onChange={(e) => onUpdate('douyinBulkVerboseWarnings', e.target.checked)}
                    className="rounded border-border"
                  />
                  Enable
                </label>
              </FieldBlock>
              <FieldBlock
                label="Bulk source URL"
                description="Paste a Douyin creator/profile URL and start a cancellable bulk job."
              >
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={bulkUrl}
                    onChange={(e) => setBulkUrl(e.target.value)}
                    placeholder="https://www.douyin.com/user/..."
                    className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-white/30"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleStartDouyinBulk}
                      disabled={!bulkUrl.trim() || bulkJobBusy || bulkJob?.state === 'running'}
                      className={cn(
                        'px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
                        !bulkUrl.trim() || bulkJobBusy || bulkJob?.state === 'running'
                          ? 'border-border/50 text-muted-foreground/50 cursor-not-allowed'
                          : 'border-border bg-elevated text-foreground hover:bg-control'
                      )}
                    >
                      {bulkJobBusy ? 'Working…' : 'Start bulk'}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelDouyinBulk}
                      disabled={!bulkJobId || bulkJobBusy || bulkJob?.state !== 'running'}
                      className={cn(
                        'px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
                        !bulkJobId || bulkJobBusy || bulkJob?.state !== 'running'
                          ? 'border-border/50 text-muted-foreground/50 cursor-not-allowed'
                          : 'border-border bg-elevated text-foreground hover:bg-control'
                      )}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </FieldBlock>
              {(bulkJob || bulkJobNote) && (
                <div className="rounded-lg border border-border bg-raised px-3 py-2 space-y-1">
                  {bulkJob && (
                    <>
                      <p className="text-xs text-foreground">
                        Job <code>{bulkJob.id}</code> - <span className="capitalize">{bulkJob.state}</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Started: {new Date(bulkJob.startedAt).toLocaleString()}
                        {bulkJob.endedAt ? `  Ended: ${new Date(bulkJob.endedAt).toLocaleString()}` : ''}
                      </p>
                      {bulkJob.stderrTail ? (
                        <pre className="text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words border border-border rounded-md p-2 max-h-32 overflow-y-auto">
                          {bulkJob.stderrTail}
                        </pre>
                      ) : null}
                    </>
                  )}
                  {bulkJobNote ? <p className="text-xs text-muted-foreground">{bulkJobNote}</p> : null}
                </div>
              )}
            </PrefCard>

            <PrefCard
              title="Output format"
              subtitle="Defaults used when the format picker is off or when you skip the picker for a quick download."
            >
              <FieldBlock
                label="Preferred video quality"
                description="Maps to yt-dlp height selection; container follows what yt-dlp chooses for the site."
              >
                <select
                  value={settings.defaultVideoQuality}
                  onChange={(e) => onUpdate('defaultVideoQuality', e.target.value)}
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-white/30"
                >
                  {VIDEO_QUALITIES.map((q) => (
                    <option key={q} value={q}>
                      {q}p
                    </option>
                  ))}
                </select>
              </FieldBlock>
              <FieldBlock label="Audio-only default" description="Bitrate preset when saving audio-only tracks.">
                <select
                  value={settings.defaultAudioQuality}
                  onChange={(e) => onUpdate('defaultAudioQuality', e.target.value)}
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-white/30"
                >
                  {AUDIO_QUALITIES.map((q) => (
                    <option key={q} value={q}>
                      {q}kbps
                    </option>
                  ))}
                </select>
              </FieldBlock>
              <FieldBlock
                label="Filename template"
                description="Custom patterns like {title} - {site} - {quality} will ship with per-site rules; not persisted yet."
              >
                <input
                  type="text"
                  readOnly
                  value="{title} - {site} - {quality}"
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised/50 border border-dashed border-border text-sm text-muted-foreground cursor-not-allowed"
                  aria-readonly
                />
              </FieldBlock>
            </PrefCard>
          </div>
        )}

        {section === 'browser' && (
          <div className="max-w-2xl space-y-6">
            <PrefCard title="Chrome companion" subtitle="Extension, cookie sync, and browser profile for logged-in pages.">
              {(cookieSyncBusy || cookieSyncNote) && (
                <div
                  className={cn(
                    'rounded-lg border px-3 py-3 flex gap-3 items-start',
                    cookieSyncBusy ? 'border-border-strong bg-state-active-bg' : 'border-border bg-raised'
                  )}
                  role="status"
                >
                  {cookieSyncBusy && (
                    <Loader2 className="w-5 h-5 shrink-0 mt-0.5 animate-spin text-foreground" aria-hidden />
                  )}
                  <p className="text-sm text-foreground leading-relaxed flex-1 min-w-0">{cookieSyncNote}</p>
                  {!cookieSyncBusy && cookieSyncNote && (
                    <HoverHintWrap text="Dismiss message" side="bottom">
                      <button
                        type="button"
                        onClick={() => setCookieSyncNote('')}
                        className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-control transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                        aria-label="Dismiss message"
                      >
                        <X className="w-4 h-4" aria-hidden />
                      </button>
                    </HoverHintWrap>
                  )}
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <p className="text-sm text-foreground">Chrome extension</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {settings.cookiesPath ? 'Connected — cookies synced' : 'Detect videos and sync cookies'}
                    {' '}
                    Douyin uses your real browser profile (see below), not only this file.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-stretch">
                  <button
                    type="button"
                    onClick={handleForceCookieSync}
                    disabled={cookieSyncBusy}
                    className={cn(
                      'inline-flex min-h-[2.25rem] flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors sm:min-w-0 sm:flex-initial',
                      cookieSyncBusy
                        ? 'cursor-wait border-border-strong bg-control text-foreground ring-1 ring-inset ring-border'
                        : 'border-border bg-elevated text-foreground hover:bg-control'
                    )}
                    title="Push fresh cookies from Chrome into V-Download"
                    aria-busy={cookieSyncBusy}
                  >
                    {cookieSyncBusy ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    )}
                    {cookieSyncBusy ? 'Syncing…' : 'Sync browser cookies'}
                  </button>
                  <button
                    type="button"
                    onClick={() => window.api?.installChromeExtension?.()}
                    disabled={cookieSyncBusy}
                    className={cn(
                      'inline-flex min-h-[2.25rem] flex-1 items-center justify-center rounded-lg border px-3 py-2 text-xs font-medium transition-colors sm:flex-initial sm:px-4',
                      cookieSyncBusy
                        ? 'cursor-not-allowed border-border/50 text-muted-foreground/50'
                        : 'border-border bg-elevated text-foreground hover:bg-control'
                    )}
                    title={cookieSyncBusy ? 'Wait until cookie sync finishes' : undefined}
                  >
                    Install guide
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs text-muted-foreground mb-2">
                  Browser profile for Douyin / TikTok (yt-dlp)
                </label>
                <select
                  value={settings.cookiesFromBrowser ?? 'chrome'}
                  onChange={(e) => onUpdate('cookiesFromBrowser', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-white/30"
                >
                  <option value="chrome">Google Chrome</option>
                  <option value="chromium">Chromium</option>
                  <option value="brave">Brave</option>
                  <option value="edge">Microsoft Edge</option>
                  <option value="opera">Opera</option>
                  <option value="vivaldi">Vivaldi</option>
                  <option value="firefox">Firefox</option>
                  <option value="safari">Safari (macOS)</option>
                </select>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  Open Douyin in this browser at least once so cookies exist. Update yt-dlp (
                  <code className="text-foreground/90">brew upgrade yt-dlp</code> or{' '}
                  <code className="text-foreground/90">yt-dlp -U</code>) if errors persist.
                </p>
              </div>

              <ToggleRow
                label="Use CloakBrowser for Douyin (beta)"
                checked={settings.douyinUseCloakBrowser === true}
                onChange={(v) => onUpdate('douyinUseCloakBrowser', v)}
              />
              <p className="text-xs text-muted-foreground -mt-2 leading-relaxed pl-0.5">
                Uses a separate patched Chromium (~200 MB first-run download to the vendor cache) when Douyin pages fail
                to hydrate in Electron. See the main README for{' '}
                <a
                  href="https://github.com/CloakHQ/cloakbrowser/blob/main/BINARY-LICENSE.md"
                  className="text-foreground/90 underline underline-offset-2 hover:text-foreground"
                >
                  binary license terms
                </a>
                , macOS Gatekeeper, and env overrides (
                <code className="text-foreground/90">V_DOWNLOAD_CLOAKBROWSER</code>,{' '}
                <code className="text-foreground/90">V_DOWNLOAD_CLOAK_FALLBACK</code>).
              </p>
            </PrefCard>
          </div>
        )}

        {section === 'sites' && (
          <div className="max-w-2xl space-y-6">
            <div className="rounded-xl border border-dashed border-border-strong bg-surface p-6">
              <p className="text-sm text-foreground font-medium">Coming soon</p>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                Per-site download rules, allowlists, and overrides will live here. The v2 design pack includes table
                mockups for this section.
              </p>
            </div>
          </div>
        )}

        {section === 'advanced' && (
          <div className="max-w-2xl space-y-6">
            <PrefCard title="Engine" subtitle="Resolved paths from your environment (read-only).">
              <div>
                <label className="block text-xs text-muted-foreground mb-2">yt-dlp path</label>
                <input
                  type="text"
                  value={settings.ytdlpPath ?? ''}
                  readOnly
                  className="w-full px-3 py-2 rounded-lg bg-raised border border-border text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-white/30"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-2">ffmpeg path</label>
                <input
                  type="text"
                  value={settings.ffmpegPath ?? ''}
                  readOnly
                  className="w-full px-3 py-2 rounded-lg bg-raised border border-border text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-white/30"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-2">Version</label>
                <p className="text-sm text-muted-foreground">1.0.0</p>
              </div>
            </PrefCard>
          </div>
        )}
      </div>

      {turboModalOpen ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="turbo-modal-title"
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl space-y-3">
            <h2 id="turbo-modal-title" className="text-sm font-semibold text-foreground">
              Enable Turbo mode?
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Turbo raises parallel fragment downloads and removes the delay between yt-dlp operations. Some hosts may
              respond with HTTP 429 (Too Many Requests) or throttle your connection. You can switch back to Balanced
              anytime.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setTurboModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-border bg-elevated text-sm font-medium text-foreground hover:bg-control transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmTurboMode()}
                className="px-4 py-2 rounded-lg border border-white/30 bg-control text-sm font-medium text-foreground hover:opacity-95 transition-opacity"
              >
                Enable Turbo
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-sm text-foreground">{label}</label>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn('w-11 h-6 rounded-full transition-colors shrink-0', checked ? 'bg-foreground' : 'bg-border')}
        aria-pressed={checked}
      >
        <span
          className={cn(
            'block w-5 h-5 rounded-full bg-background shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5'
          )}
        />
      </button>
    </div>
  )
}
