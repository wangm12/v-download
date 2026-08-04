import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { Check, ChevronDown, Folder, RefreshCw, Loader2, X, Puzzle } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Stepper } from './Stepper'
import { HoverHintWrap } from './HoverHintWrap'
import type { PrefSection } from '@/preferencesNav'
import { PREF_SECTION_HEADER } from '@/preferencesNav'
import type { DouyinBulkJobStatus, SettingsData, SiteRule } from '@/types'
import { DOUYIN_BULK_URL_PREFILL_SESSION_KEY } from '@/utils/douyinBulk'
import {
  GENERAL_SECTION_CLASS,
  PREFERENCES_WORKSPACE_CLASS
} from './preferencesPanelPresentation'
import { DOWNLOAD_SPEED_MODES, getDownloadSpeedPresentation, getEffectiveIndividualLimit } from './preferencesPanelPresentation'

const VIDEO_QUALITIES = ['2160', '1080', '720', '360', '240', '144']
const AUDIO_QUALITIES = ['320', '256', '128']

export interface PreferencesPanelProps {
  section: PrefSection
}

function PrefCard({
  title,
  subtitle,
  children,
  className
}: {
  title: string
  subtitle?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('overflow-hidden rounded-2xl bg-surface/70 ring-1 ring-inset ring-divider-subtle', className)}>
      <div className="px-5 pt-5">
        <h3 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h3>
        {subtitle ? (
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      <div className="space-y-4 px-5 pb-5 pt-4">{children}</div>
    </section>
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
    <div className="space-y-1.5">
      <div>
        <p className="text-[13px] font-medium text-foreground">{label}</p>
        {description ? (
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  )
}

function SettingRow({
  label,
  description,
  children,
  className
}: {
  label: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('v-settings-row flex items-center justify-between gap-6 py-2 first:pt-0 last:pb-0 max-sm:flex-col max-sm:items-start', className)}>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">{label}</p>
        {description ? <p className="mt-0.5 max-w-[46ch] text-[11px] leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      <div className="shrink-0 max-sm:w-full">{children}</div>
    </div>
  )
}

function SettingsDisclosure({
  title,
  subtitle,
  children,
  defaultOpen = false,
  className
}: {
  title: string
  subtitle: string
  children: ReactNode
  defaultOpen?: boolean
  className?: string
}) {
  return (
    <details className={cn('v-settings-disclosure overflow-hidden rounded-2xl bg-surface/35 ring-1 ring-inset ring-divider-subtle', className)} open={defaultOpen || undefined}>
      <summary className="v-settings-summary flex cursor-pointer items-center justify-between gap-4 px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus">
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-foreground">{title}</span>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{subtitle}</span>
        </span>
        <ChevronDown className="v-settings-chevron h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="border-t border-divider-subtle px-5 pb-5 pt-4">{children}</div>
    </details>
  )
}

const controlClass = 'min-h-10 rounded-lg bg-raised px-3 py-2 text-[13px] text-foreground ring-1 ring-inset ring-divider-subtle outline-none transition-colors focus:ring-2 focus:ring-border-focus'
const secondaryButtonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-elevated px-3.5 py-2 text-[13px] font-medium text-foreground ring-1 ring-inset ring-divider-subtle transition-colors hover:bg-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:cursor-wait disabled:opacity-50'

export function PreferencesPanel({ section }: PreferencesPanelProps) {
  const [cookieSyncNote, setCookieSyncNote] = useState('')
  const [cookieSyncBusy, setCookieSyncBusy] = useState(false)
  const [extensionPath, setExtensionPath] = useState<string | null>(null)
  const [extensionInstallBusy, setExtensionInstallBusy] = useState(false)
  const [appVersion, setAppVersion] = useState<string | null>(null)
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
    ytdlpExternalDownloader: '',
    siteRules: []
  })
  const [bulkUrl, setBulkUrl] = useState('')
  const [bulkJobId, setBulkJobId] = useState('')
  const [bulkJob, setBulkJob] = useState<DouyinBulkJobStatus | null>(null)
  const [bulkJobBusy, setBulkJobBusy] = useState(false)
  const [bulkJobNote, setBulkJobNote] = useState('')
  const [turboModalOpen, setTurboModalOpen] = useState(false)
  const turboDialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!turboModalOpen) return
    turboDialogRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setTurboModalOpen(false) }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [turboModalOpen])

  const header = PREF_SECTION_HEADER[section]

  useEffect(() => {
    if (!window.api) return
    window.api.getSettings().then((res) => {
      const data = (res as { data?: SettingsData })?.data ?? res
      if (data) setSettings((prev) => ({ ...prev, ...data }))
    })
  }, [])

  useEffect(() => {
    if (!window.api?.getAppVersion) return
    void window.api.getAppVersion().then(setAppVersion).catch(() => setAppVersion(null))
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

  useEffect(() => {
    if (section !== 'browser' || !window.api?.getChromeExtensionPath) return
    void window.api.getChromeExtensionPath().then((res) => {
      if (res.ok && res.path) setExtensionPath(res.path)
    })
  }, [section])

  const handleInstallExtension = async () => {
    if (!window.api?.installChromeExtension || extensionInstallBusy || cookieSyncBusy) return
    setExtensionInstallBusy(true)
    setCookieSyncNote('Opening the extension folder and Chrome Extensions page…')
    try {
      const res = await window.api.installChromeExtension()
      if (res.ok) {
        if (res.path) setExtensionPath(res.path)
        setCookieSyncNote(
          res.path
            ? `In Chrome: turn on Developer mode → Load unpacked → select the folder shown in Finder.`
            : 'Follow the steps in Chrome to load the unpacked extension.'
        )
      } else {
        setCookieSyncNote(res.error || 'Could not find the extension folder.')
      }
    } catch (err) {
      setCookieSyncNote(err instanceof Error ? err.message : String(err))
    } finally {
      setExtensionInstallBusy(false)
    }
  }

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
        <div className="mx-auto w-full max-w-[760px] min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-tertiary-foreground">Preferences</p>
          <h1 className="mt-1 text-lg font-semibold tracking-tight text-foreground">{header.title}</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{header.subtitle}</p>
        </div>
      </header>

      <div
        className="flex-1 min-h-0 overflow-y-auto bg-background px-4 py-5 sm:px-6 sm:py-6"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {section === 'general' && (
          <div className={PREFERENCES_WORKSPACE_CLASS}>
            <PrefCard
              title="Download behavior"
              subtitle="Set the choices that shape every download."
              className={GENERAL_SECTION_CLASS}
            >
              <ToggleRow
                label="Ask before downloading"
                description="Show the format picker instead of starting immediately."
                checked={settings.showFormatDialog}
                onChange={(v) => onUpdate('showFormatDialog', v)}
              />
              <ToggleRow
                label="Organize playlist downloads"
                description="Create a folder for each playlist or channel."
                checked={settings.playlistSubfolder}
                onChange={(v) => onUpdate('playlistSubfolder', v)}
              />
            </PrefCard>
          </div>
        )}

        {section === 'downloads' && (
          <div className={PREFERENCES_WORKSPACE_CLASS}>
            <PrefCard
              title="Save files"
              subtitle="Choose the folder used for completed downloads."
            >
              <FieldBlock label="Download folder">
                <div className="flex gap-2">
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-raised border border-border min-w-0">
                    <Folder className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
                    <span className="text-sm text-foreground truncate">{settings.downloadDir}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleBrowse}
                    className="min-h-11 px-4 py-2 rounded-lg bg-elevated border border-border text-sm font-medium text-foreground hover:bg-control transition-colors shrink-0"
                  >
                    Browse
                  </button>
                </div>
              </FieldBlock>
            </PrefCard>

            <PrefCard
              title="Download speed"
              subtitle="Balanced is recommended. Choose Gentle for stricter sites or Turbo for faster starts."
            >
              <FieldBlock
                label="Preset"
                description="Balanced is a good default."
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label="Download speed mode">
                  {DOWNLOAD_SPEED_MODES.map((mode) => {
                    const presentation = getDownloadSpeedPresentation(mode)
                    const selected = (settings.downloadSpeedMode ?? 'balanced') === mode
                    return (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => void handleDownloadSpeedMode(mode)}
                      className={cn(
                        'min-h-11 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-action focus:ring-offset-2 focus:ring-offset-surface',
                        selected ? 'border-action bg-action text-action-fg shadow-sm' : 'border-border bg-elevated text-foreground hover:bg-control'
                      )}
                    >
                      <span className="flex items-center gap-2">
                        {selected ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : <span className="h-4 w-4 shrink-0" aria-hidden />}
                        <span>{presentation.label}{selected ? ' · Selected' : ''}</span>
                      </span>
                    </button>
                    )
                  })}
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground" aria-live="polite">
                  {getDownloadSpeedPresentation(settings.downloadSpeedMode ?? 'balanced').shortDescription}
                </p>
              </FieldBlock>
            </PrefCard>

            <SettingsDisclosure
              title="More download controls"
              subtitle="Queue limits, network pacing, playlist mode, and bulk tools. Most people can leave these alone."
              className="order-3"
            >
            <PrefCard
              title="Queue"
              subtitle="Balance speed with system and network reliability. A short delay between starts helps with rate limits."
            >
              <FieldBlock
                label="Individual-video pool limit"
                description={`Allows up to ${getEffectiveIndividualLimit(settings.downloadSpeedMode ?? 'balanced', settings.concurrency)} individual-video tasks. Collections use their own ${getDownloadSpeedPresentation(settings.downloadSpeedMode ?? 'balanced').policy.collectionLimit}-task and ${getDownloadSpeedPresentation(settings.downloadSpeedMode ?? 'balanced').policy.activeCollectionLimit}-collection caps.`}
              >
                <Stepper value={getEffectiveIndividualLimit(settings.downloadSpeedMode ?? 'balanced', settings.concurrency)} min={1} max={3} onChange={(v) => onUpdate('concurrency', v)} />
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
              <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-3">Failed and interrupted items expose Retry in the queue and inspector. Pause and cancel remain available while a task is active.</p>
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
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-border-focus"
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
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-border-focus"
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
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-border-focus"
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
              className="lg:col-span-2"
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
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-border-focus"
                />
              </FieldBlock>
              <FieldBlock label="Path to config.yml" description="Config file passed as -c to run.py.">
                <input
                  type="text"
                  value={settings.douyinBulkConfigPath ?? ''}
                  onChange={(e) => onUpdate('douyinBulkConfigPath', e.target.value)}
                  placeholder="/path/to/douyin-downloader/config.yml"
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-border-focus"
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
                    className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-border-focus"
                  />
                  <button
                    type="button"
                    onClick={handleBrowseBulkOutput}
                      className="inline-flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-elevated text-xs font-medium text-foreground hover:bg-control"
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
                    className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-border-focus"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleStartDouyinBulk}
                      disabled={!bulkUrl.trim() || bulkJobBusy || bulkJob?.state === 'running'}
                      className={cn(
                        'min-h-11 px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
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

            </SettingsDisclosure>

            <PrefCard
              title="Default format"
              subtitle="Used when the format picker is turned off."
              className="order-2"
            >
              <FieldBlock
                label="Video quality"
                description="Higher quality uses more storage and bandwidth."
              >
                <select
                  value={settings.defaultVideoQuality}
                  onChange={(e) => onUpdate('defaultVideoQuality', e.target.value)}
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-border-focus"
                >
                  {VIDEO_QUALITIES.map((q) => (
                    <option key={q} value={q}>
                      {q}p
                    </option>
                  ))}
                </select>
              </FieldBlock>
              <FieldBlock label="Audio quality" description="Bitrate used for audio-only downloads.">
                <select
                  value={settings.defaultAudioQuality}
                  onChange={(e) => onUpdate('defaultAudioQuality', e.target.value)}
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-border-focus"
                >
                  {AUDIO_QUALITIES.map((q) => (
                    <option key={q} value={q}>
                      {q}kbps
                    </option>
                  ))}
                </select>
              </FieldBlock>
            </PrefCard>
          </div>
        )}

        {section === 'browser' && (
          <div className={PREFERENCES_WORKSPACE_CLASS}>
            <PrefCard title="Browser connection" subtitle="Use the extension to detect media and sync login cookies.">
              {(cookieSyncBusy || extensionInstallBusy || cookieSyncNote) && (
                <div
                  className={cn(
                    'rounded-lg border px-3 py-3 flex gap-3 items-start',
                    cookieSyncBusy || extensionInstallBusy
                      ? 'border-border-strong bg-state-active-bg'
                      : 'border-border bg-raised'
                  )}
                  role="status"
                >
                  {(cookieSyncBusy || extensionInstallBusy) && (
                    <Loader2 className="w-5 h-5 shrink-0 mt-0.5 animate-spin text-foreground" aria-hidden />
                  )}
                  <p className="text-sm text-foreground leading-relaxed flex-1 min-w-0">{cookieSyncNote}</p>
                  {!cookieSyncBusy && !extensionInstallBusy && cookieSyncNote && (
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
                    {settings.cookiesPath ? 'Cookies synced and ready.' : extensionPath ? 'Extension folder ready.' : 'Extension is ready to load in Chrome.'}
                  </p>
                  <p className="text-[11px] text-muted-foreground/90 mt-1.5 leading-relaxed">
                    Cookies stay on this computer and are used for authenticated downloads.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-stretch">
                  <button
                    type="button"
                    onClick={() => void handleInstallExtension()}
                    disabled={cookieSyncBusy || extensionInstallBusy}
                    className={cn(
                      `${secondaryButtonClass} flex-1 sm:flex-initial`,
                      cookieSyncBusy || extensionInstallBusy
                        ? 'cursor-wait'
                        : ''
                    )}
                    title="Open extension folder and Chrome Extensions for Load unpacked"
                    aria-busy={extensionInstallBusy}
                  >
                    {extensionInstallBusy ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                    ) : (
                      <Puzzle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    )}
                    {extensionInstallBusy ? 'Opening…' : 'Install extension'}
                  </button>
                  <button
                    type="button"
                    onClick={handleForceCookieSync}
                    disabled={cookieSyncBusy || extensionInstallBusy}
                    className={cn(
                      `${secondaryButtonClass} flex-1 sm:flex-initial`,
                      cookieSyncBusy || extensionInstallBusy
                        ? 'cursor-wait'
                        : ''
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
                </div>
              </div>

              <SettingRow
                label="Browser profile"
                description="Used when Douyin or TikTok needs your logged-in browser session."
              >
                <select
                  value={settings.cookiesFromBrowser ?? 'chrome'}
                  onChange={(e) => onUpdate('cookiesFromBrowser', e.target.value)}
                  className={cn(controlClass, 'w-full min-w-[180px]')}
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
              </SettingRow>

              <SettingsDisclosure title="If Douyin pages fail" subtitle="Optional recovery mode for difficult pages.">
                <ToggleRow
                  label="Use CloakBrowser"
                  description="Downloads a separate patched browser on first use."
                  checked={settings.douyinUseCloakBrowser === true}
                  onChange={(v) => onUpdate('douyinUseCloakBrowser', v)}
                />
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                  See the{' '}
                  <a href="https://github.com/CloakHQ/cloakbrowser/blob/main/BINARY-LICENSE.md" className="text-foreground underline underline-offset-2 hover:no-underline">
                    binary license terms
                  </a>{' '}before enabling it.
                </p>
              </SettingsDisclosure>
            </PrefCard>
          </div>
        )}

        {section === 'sites' && (
          <div className={PREFERENCES_WORKSPACE_CLASS}>
            <PrefCard title="Per-site rules" subtitle="Override the default format for a specific website. Changes save immediately.">
              <SiteRulesEditor settings={settings} onUpdate={onUpdate} />
            </PrefCard>
          </div>
        )}

        {section === 'advanced' && (
          <div className={PREFERENCES_WORKSPACE_CLASS}>
            <PrefCard title="System" subtitle="Only open these details when troubleshooting.">
              <SettingRow label="App version" description="Installed V-Download version.">
                <span className="text-[13px] tabular-nums text-muted-foreground">{appVersion ?? '—'}</span>
              </SettingRow>
              <SettingsDisclosure title="Engine paths" subtitle="Read-only paths used by yt-dlp and ffmpeg.">
                <div className="space-y-4">
                  <FieldBlock label="yt-dlp">
                    <input type="text" value={settings.ytdlpPath ?? ''} readOnly className={cn(controlClass, 'w-full text-muted-foreground')} />
                  </FieldBlock>
                  <FieldBlock label="ffmpeg">
                    <input type="text" value={settings.ffmpegPath ?? ''} readOnly className={cn(controlClass, 'w-full text-muted-foreground')} />
                  </FieldBlock>
                </div>
              </SettingsDisclosure>
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
          <div ref={turboDialogRef} tabIndex={-1} className="w-full max-w-md rounded-panel bg-surface p-5 shadow-xl space-y-3 outline-none ring-1 ring-inset ring-divider-strong">
            <h2 id="turbo-modal-title" className="text-sm font-semibold text-foreground">
              Enable Turbo mode?
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Turbo keeps the same 12-task queue cap, but removes the start delay, uses 16 fragment downloads, and uses
              the yt-dlp direct-media path. It is faster, but some hosts may
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
                className="px-4 py-2 rounded-lg border border-border-strong bg-control text-sm font-medium text-foreground hover:opacity-95 transition-opacity"
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

function SiteRulesEditor({ settings, onUpdate }: { settings: SettingsData; onUpdate: (key: string, value: unknown) => Promise<void> }) {
  const rules = settings.siteRules ?? []
  const add = () => void onUpdate('siteRules', [...rules, { id: crypto.randomUUID(), domain: '', format: 'best', quality: '1080', enabled: true } satisfies SiteRule])

  return (
    <div className="space-y-4">
      {rules.length > 0 ? (
        <div className="space-y-3">
          {rules.map((rule, index) => (
            <div key={rule.id} className="rounded-xl bg-raised/45 p-3 ring-1 ring-inset ring-divider-subtle">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-end">
                <FieldBlock label="Website">
                  <input
                    aria-label={`Site rule ${index + 1} domain`}
                    value={rule.domain}
                    onChange={(e) => void onUpdate('siteRules', rules.map((r) => r.id === rule.id ? { ...r, domain: e.target.value } : r))}
                    placeholder="youtube.com"
                    className={cn(controlClass, 'w-full')}
                  />
                </FieldBlock>
                <FieldBlock label="Download as">
                  <select
                    aria-label={`Site rule ${index + 1} output type`}
                    value={rule.format}
                    onChange={(e) => void onUpdate('siteRules', rules.map((r) => r.id === rule.id ? { ...r, format: e.target.value as SiteRule['format'] } : r))}
                    className={controlClass}
                  >
                    <option value="best">Best</option>
                    <option value="video">Video</option>
                    <option value="audio">Audio</option>
                  </select>
                </FieldBlock>
                <FieldBlock label={rule.format === 'audio' ? 'kbps' : 'Quality'}>
                  <input
                    aria-label={`Site rule ${index + 1} quality`}
                    inputMode="numeric"
                    value={rule.quality}
                    onChange={(e) => void onUpdate('siteRules', rules.map((r) => r.id === rule.id ? { ...r, quality: e.target.value.replace(/[^0-9]/g, '') } : r))}
                    onBlur={() => {
                      const n = Number(rule.quality)
                      if (!Number.isFinite(n) || n <= 0) void onUpdate('siteRules', rules.map((r) => r.id === rule.id ? { ...r, quality: r.format === 'audio' ? '320' : '1080' } : r))
                    }}
                    className={cn(controlClass, 'w-full sm:w-24')}
                  />
                </FieldBlock>
                <div className="flex items-center gap-2 sm:pb-0.5">
                  <label className="inline-flex min-h-10 items-center gap-2 text-[13px] text-foreground">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) => void onUpdate('siteRules', rules.map((r) => r.id === rule.id ? { ...r, enabled: e.target.checked } : r))}
                      className="h-4 w-4 accent-[rgb(var(--color-accent))]"
                    />
                    Active
                  </label>
                  <button
                    type="button"
                    aria-label={`Remove ${rule.domain || 'site'} rule`}
                    onClick={() => void onUpdate('siteRules', rules.filter((r) => r.id !== rule.id))}
                    className="inline-flex min-h-10 items-center justify-center rounded-lg px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-control hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                  >
                    <X className="h-4 w-4" aria-hidden />
                    <span className="sr-only">Remove</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl bg-raised/35 px-4 py-4 text-[12px] leading-relaxed text-muted-foreground ring-1 ring-inset ring-divider-subtle">
          No site-specific rules. Downloads use the defaults from Downloads.
        </div>
      )}
      <button type="button" onClick={add} className={secondaryButtonClass}>
        Add site rule
      </button>
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="v-settings-row flex min-h-11 items-center justify-between gap-6 py-2 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-[13px] text-foreground">{label}</p>
        {description ? <p className="mt-0.5 max-w-[46ch] text-[11px] leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="flex h-10 w-12 shrink-0 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus max-sm:self-end"
        aria-pressed={checked}
        aria-label={`${label}: ${checked ? 'On' : 'Off'}`}
      >
        <span className={cn('flex h-6 w-11 items-center rounded-full transition-colors', checked ? 'bg-action' : 'bg-border')}>
          <span
            className={cn(
              'block h-5 w-5 rounded-full bg-background shadow-sm transition-transform',
              checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
            )}
          />
        </span>
      </button>
    </div>
  )
}
