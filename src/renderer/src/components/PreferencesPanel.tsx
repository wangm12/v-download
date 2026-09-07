import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { Check, ChevronDown, Copy, Download, Folder, Globe, RefreshCw, Loader2, X, Puzzle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { Stepper } from './Stepper'
import { HoverHintWrap } from './HoverHintWrap'
import type { PrefSection } from '@/preferencesNav'
import type { DouyinBulkJobStatus, EngineStatus, NativeAuthAccountStatus, NativeAuthEvent, NativeAuthSite, SettingsData, SiteRule } from '@/types'
import { DOUYIN_BULK_URL_PREFILL_SESSION_KEY } from '@/utils/douyinBulk'
import {
  GENERAL_SECTION_CLASS,
  LANGUAGE_PREFERENCE_VALUES,
  OUTPUT_FILENAME_TOKENS,
  OUTPUT_FOLDER_TOKENS,
  PREFERENCES_WORKSPACE_CLASS,
  THEME_PREFERENCE_VALUES,
  canPersistSiteRule,
  languageSelectValue,
  outputTemplateError,
  previewOutputPath,
  themeSelectValue,
  type OutputTemplateError
} from './preferencesPanelPresentation'
import { DOWNLOAD_SPEED_MODES, getDownloadSpeedPresentation, getEffectiveIndividualLimit } from './preferencesPanelPresentation'
import { changeAppLanguage, type UiLanguagePreference } from '@/i18n'
import type { ThemePreference } from '@/hooks/useThemePreference'

const VIDEO_QUALITIES = ['2160', '1080', '720', '360', '240', '144']
const AUDIO_QUALITIES = ['320', '256', '128']

export interface PreferencesPanelProps {
  section: PrefSection
  themePreference: ThemePreference
  onThemePreference: (value: ThemePreference) => void
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
    <section className={cn('overflow-hidden rounded-card bg-surface/70 ring-1 ring-inset ring-divider-subtle', className)}>
      <div className="px-5 pt-5">
        <h3 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h3>
        {subtitle ? (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{subtitle}</p>
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
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
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
        {description ? <p className="mt-0.5 max-w-[46ch] text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
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
    <details className={cn('v-settings-disclosure overflow-hidden rounded-card bg-surface/35 ring-1 ring-inset ring-divider-subtle', className)} open={defaultOpen || undefined}>
      <summary className="v-settings-summary flex cursor-pointer items-center justify-between gap-4 px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus">
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-foreground">{title}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{subtitle}</span>
        </span>
        <ChevronDown className="v-settings-chevron h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="border-t border-divider-subtle px-5 pb-5 pt-4">{children}</div>
    </details>
  )
}

const controlClass = 'min-h-10 rounded-lg bg-raised px-3 py-2 text-[13px] text-foreground ring-1 ring-inset ring-divider-subtle outline-none transition-colors focus:ring-2 focus:ring-border-focus'
const secondaryButtonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-elevated px-3.5 py-2 text-[13px] font-medium text-foreground ring-1 ring-inset ring-divider-subtle transition-colors hover:bg-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:cursor-wait disabled:opacity-50'

export function PreferencesPanel({ section, themePreference, onThemePreference }: PreferencesPanelProps) {
  const { t } = useTranslation()
  const [cookieSyncNote, setCookieSyncNote] = useState('')
  const [cookieSyncBusy, setCookieSyncBusy] = useState(false)
  const [extensionPath, setExtensionPath] = useState<string | null>(null)
  const [extensionInstallBusy, setExtensionInstallBusy] = useState(false)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [engineStatuses, setEngineStatuses] = useState<EngineStatus[]>([])
  const [engineBusy, setEngineBusy] = useState(false)
  const [engineNote, setEngineNote] = useState('')
  const [nativeAccounts, setNativeAccounts] = useState<NativeAuthAccountStatus[]>([])
  const [nativeAuthSite, setNativeAuthSite] = useState<NativeAuthSite>('douyin')
  const [nativeAuthBusy, setNativeAuthBusy] = useState(false)
  const cookieSyncWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const awaitingCookiePushRef = useRef(false)
  const [settings, setSettings] = useState<SettingsData>({
    downloadDir: '',
    concurrency: 3,
    showFormatDialog: true,
    playlistSubfolder: true,
    filenameTemplate: '{title} [{id}]',
    folderNameTemplate: '{author}',
    archiveByAuthor: false,
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
    siteRules: [],
    proxyUrl: '',
    launchAtStartup: false,
    notifyOnComplete: true,
    notifyOnError: true,
    warnBeforeQuit: true,
    showTray: true,
    onboardingCompleted: false,
    remoteApiEnabled: false,
    remoteApiToken: '',
    remoteApiBind: '127.0.0.1',
    remoteApiPort: 18766,
    remoteApiMcpAllowWrite: false,
    remoteApiMcpRequireConfirm: true,
    uiLanguage: 'en'
  })
  const [filenameDraft, setFilenameDraft] = useState<string | null>(null)
  const [folderDraft, setFolderDraft] = useState<string | null>(null)
  const [filenameError, setFilenameError] = useState<OutputTemplateError | null>(null)
  const [folderError, setFolderError] = useState<OutputTemplateError | null>(null)
  const [bulkUrl, setBulkUrl] = useState('')
  const [bulkJobId, setBulkJobId] = useState('')
  const [bulkJob, setBulkJob] = useState<DouyinBulkJobStatus | null>(null)
  const [bulkJobBusy, setBulkJobBusy] = useState(false)
  const [bulkJobNote, setBulkJobNote] = useState('')
  const [turboModalOpen, setTurboModalOpen] = useState(false)
  const turboDialogRef = useRef<HTMLDivElement>(null)
  const [remoteTokenCopied, setRemoteTokenCopied] = useState(false)
  const [mcpConfigCopied, setMcpConfigCopied] = useState(false)
  const [mcpLogs, setMcpLogs] = useState<Array<{
    timestamp: string
    tool: string
    argumentSummary: string
    success: boolean
    elapsedMs: number
    errorCode?: string | null
    message: string
  }>>([])

  useEffect(() => {
    if (section !== 'advanced' || !settings.remoteApiEnabled) return
    let cancelled = false
    const pull = () => {
      void window.api?.getRemoteMcpLogs?.(20).then((result) => {
        if (!cancelled && Array.isArray(result?.data)) setMcpLogs(result.data)
      })
    }
    pull()
    const timer = window.setInterval(pull, 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [section, settings.remoteApiEnabled])

  useEffect(() => {
    if (!turboModalOpen) return
    turboDialogRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setTurboModalOpen(false) }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [turboModalOpen])

  const header = { title: t(`prefs.header.${section}Title`), subtitle: t(`prefs.header.${section}Subtitle`) }

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

  const refreshEngineStatuses = useCallback(async (checkForUpdates = false) => {
    const loader = checkForUpdates ? window.api?.checkEngineUpdates : window.api?.getEngineStatus
    if (!loader) return
    setEngineBusy(true)
    setEngineNote('')
    try {
      const result = await loader()
      if (result.error) {
        setEngineNote(result.error)
      } else if (result.data) {
        setEngineStatuses(result.data)
      }
    } catch (err) {
      setEngineNote(err instanceof Error ? err.message : String(err))
    } finally {
      setEngineBusy(false)
    }
  }, [])

  const updateEngine = useCallback(async (name: 'yt-dlp' | 'ffmpeg') => {
    if (!window.api?.updateEngine || engineBusy) return
    setEngineBusy(true)
    setEngineNote('')
    try {
      const result = await window.api.updateEngine(name)
      if (result.error) setEngineNote(result.error)
      else if (result.data) setEngineStatuses(result.data)
    } catch (err) {
      setEngineNote(err instanceof Error ? err.message : String(err))
    } finally {
      setEngineBusy(false)
    }
  }, [engineBusy])

  useEffect(() => {
    if (section !== 'advanced') return
    void refreshEngineStatuses()
  }, [refreshEngineStatuses, section])

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
        setBulkJobNote(t('prefs.expert.prefilled'))
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
      setCookieSyncNote(t('banner.cookiesSavedDetail', { count: data.count }))
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

  const filenameValue = filenameDraft ?? settings.filenameTemplate ?? '{title} [{id}]'
  const folderValue = folderDraft ?? settings.folderNameTemplate ?? '{author}'
  const archiveByAuthor = settings.archiveByAuthor === true

  const persistTemplate = useCallback((key: 'filenameTemplate' | 'folderNameTemplate', value: string) => {
    const kind = key === 'filenameTemplate' ? 'filename' : 'folder'
    const error = outputTemplateError(value, kind)
    if (key === 'filenameTemplate') {
      setFilenameDraft(value)
      setFilenameError(error)
    } else {
      setFolderDraft(value)
      setFolderError(error)
    }
    if (error) return
    void onUpdate(key, value)
  }, [onUpdate])

  const insertTemplateToken = useCallback((key: 'filenameTemplate' | 'folderNameTemplate', token: string) => {
    const current = key === 'filenameTemplate' ? filenameValue : folderValue
    persistTemplate(key, `${current}${token}`)
  }, [filenameValue, folderValue, persistTemplate])

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

  useEffect(() => {
    if (section !== 'browser' || !window.api?.getNativeAuthAccounts) return
    void window.api.getNativeAuthAccounts().then((res) => {
      if (res.data) setNativeAccounts(res.data)
    })
    if (!window.api.onNativeAuthEvent) return
    const unsubscribe = window.api.onNativeAuthEvent((event: NativeAuthEvent) => {
      if (event.type === 'saved') {
        setNativeAccounts((current) => [
          ...current.filter((account) => account.site !== event.site),
          event.account
        ])
        setCookieSyncNote(t('prefs.inAppLogin.accountConnected', { site: event.site }))
      } else if (event.type === 'error') {
        setCookieSyncNote(event.message)
      }
    })
    return unsubscribe
  }, [section])

  const handleInstallExtension = async () => {
    if (!window.api?.installChromeExtension || extensionInstallBusy || cookieSyncBusy) return
    setExtensionInstallBusy(true)
    setCookieSyncNote(t('prefs.chromeCookie.openingFolder'))
    try {
      const res = await window.api.installChromeExtension()
      if (res.ok) {
        if (res.path) setExtensionPath(res.path)
        setCookieSyncNote(
          res.path
            ? t('prefs.chromeCookie.loadUnpacked')
            : t('prefs.chromeCookie.followSteps')
        )
      } else {
        setCookieSyncNote(res.error || t('prefs.chromeCookie.folderMissing'))
      }
    } catch (err) {
      setCookieSyncNote(err instanceof Error ? err.message : String(err))
    } finally {
      setExtensionInstallBusy(false)
    }
  }

  const handleStartNativeAuth = async () => {
    if (!window.api?.startNativeAuth || nativeAuthBusy) return
    setNativeAuthBusy(true)
    setCookieSyncNote(t('prefs.inAppLogin.opening', { site: nativeAuthSite }))
    try {
      const result = await window.api.startNativeAuth(nativeAuthSite)
      if (!result.ok) setCookieSyncNote(result.error || t('prefs.inAppLogin.openFailed'))
    } catch (err) {
      setCookieSyncNote(err instanceof Error ? err.message : String(err))
    } finally {
      setNativeAuthBusy(false)
    }
  }

  const handleClearNativeAuth = async (site: NativeAuthSite) => {
    if (!window.api?.clearNativeAuth || nativeAuthBusy) return
    setNativeAuthBusy(true)
    try {
      const result = await window.api.clearNativeAuth(site)
      if (result.ok) {
        setNativeAccounts((current) => current.filter((account) => account.site !== site))
        setCookieSyncNote(t('prefs.inAppLogin.disconnected', { site }))
      } else {
        setCookieSyncNote(result.error || t('prefs.inAppLogin.disconnectFailed'))
      }
    } finally {
      setNativeAuthBusy(false)
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
    setCookieSyncNote(t('banner.syncingDetail'))

    try {
      const res = await window.api.requestBrowserCookieSync()
      setCookieSyncNote(
        res.openedBrowser
          ? t('banner.waitingChromeOpened')
          : res.message || t('banner.waitingChromeManual')
      )
      cookieSyncWaitTimerRef.current = window.setTimeout(() => {
        cookieSyncWaitTimerRef.current = null
        awaitingCookiePushRef.current = false
        setCookieSyncBusy(false)
        setCookieSyncNote(t('prefs.chromeCookie.stillWaiting'))
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
        setBulkJobNote(t('prefs.expert.noJobId'))
        return
      }

      setBulkJobId(id)
      setBulkJob({
        id,
        state: 'running',
        startedAt: new Date().toISOString(),
        stderrTail: ''
      })
      setBulkJobNote(t('prefs.expert.started'))
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
        setBulkJobNote(t('prefs.expert.cancelRejected'))
        return
      }
      setBulkJob((prev) => (prev ? { ...prev, state: 'cancelled', endedAt: new Date().toISOString() } : prev))
      setBulkJobNote(t('prefs.expert.cancelSent'))
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-tertiary-foreground">{t('prefs.heading')}</p>
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
            <PrefCard title={t('prefs.language.label')} subtitle={t('prefs.language.description')} className={GENERAL_SECTION_CLASS}>
              <FieldBlock label={t('prefs.language.label')}>
                <select
                  value={languageSelectValue(settings.uiLanguage)}
                  onChange={(event) => {
                    const next = event.target.value as UiLanguagePreference
                    setSettings((prev) => ({ ...prev, uiLanguage: next }))
                    void changeAppLanguage(next)
                  }}
                  className={controlClass}
                >
                  {LANGUAGE_PREFERENCE_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {value === 'system'
                        ? t('language.system')
                        : value === 'zh-CN'
                          ? t('language.simplifiedChinese')
                          : value === 'zh-TW'
                            ? t('language.traditionalChinese')
                            : t('language.english')}
                    </option>
                  ))}
                </select>
              </FieldBlock>
            </PrefCard>
            <PrefCard title={t('prefs.theme.label')} subtitle={t('prefs.theme.description')} className={GENERAL_SECTION_CLASS}>
              <FieldBlock label={t('prefs.theme.label')}>
                <select
                  value={themeSelectValue(themePreference)}
                  onChange={(event) => onThemePreference(event.target.value as ThemePreference)}
                  className={controlClass}
                >
                  {THEME_PREFERENCE_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {value === 'device' ? t('theme.system') : value === 'light' ? t('theme.light') : t('theme.dark')}
                    </option>
                  ))}
                </select>
              </FieldBlock>
            </PrefCard>
            <PrefCard
              title={t('prefs.downloadBehavior.title')}
              subtitle={t('prefs.downloadBehavior.subtitle')}
              className={GENERAL_SECTION_CLASS}
            >
              <ToggleRow
                label={t('prefs.downloadBehavior.askBefore')}
                description={t('prefs.downloadBehavior.askBeforeDesc')}
                checked={settings.showFormatDialog}
                onChange={(v) => onUpdate('showFormatDialog', v)}
              />
              <ToggleRow
                label={t('prefs.downloadBehavior.organizePlaylist')}
                description={t('prefs.downloadBehavior.organizePlaylistDesc')}
                checked={settings.playlistSubfolder}
                onChange={(v) => onUpdate('playlistSubfolder', v)}
              />
            </PrefCard>
            <PrefCard
              title={t('prefs.startup.title')}
              subtitle={t('prefs.startup.subtitle')}
              className={GENERAL_SECTION_CLASS}
            >
              <ToggleRow
                label={t('prefs.startup.launchAtLogin')}
                checked={settings.launchAtStartup === true}
                onChange={(v) => onUpdate('launchAtStartup', v)}
              />
              <ToggleRow
                label={t('prefs.startup.notifyComplete')}
                checked={settings.notifyOnComplete !== false}
                onChange={(v) => onUpdate('notifyOnComplete', v)}
              />
              <ToggleRow
                label={t('prefs.startup.notifyError')}
                checked={settings.notifyOnError !== false}
                onChange={(v) => onUpdate('notifyOnError', v)}
              />
              <ToggleRow
                label={t('prefs.startup.warnQuit')}
                checked={settings.warnBeforeQuit !== false}
                onChange={(v) => onUpdate('warnBeforeQuit', v)}
              />
              <ToggleRow
                label={t('prefs.startup.showTray')}
                checked={settings.showTray !== false}
                onChange={(v) => onUpdate('showTray', v)}
              />
            </PrefCard>
          </div>
        )}

        {section === 'downloads' && (
          <div className={PREFERENCES_WORKSPACE_CLASS}>
            <PrefCard
              title={t('prefs.saveFiles.title')}
              subtitle={t('prefs.saveFiles.subtitle')}
            >
              <FieldBlock label={t('prefs.saveFiles.downloadFolder')}>
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
                    {t('prefs.saveFiles.browse')}
                  </button>
                </div>
              </FieldBlock>
              <FieldBlock
                label={t('prefs.saveFiles.proxyUrl')}
                description={t('prefs.saveFiles.proxyUrlDesc')}
              >
                <input
                  type="text"
                  value={settings.proxyUrl ?? ''}
                  onChange={(e) => onUpdate('proxyUrl', e.target.value)}
                  placeholder="http://127.0.0.1:8080"
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-border-focus"
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t('prefs.saveFiles.credentialsRejected')} {t('prefs.saveFiles.credentialsHint')}
                </p>
              </FieldBlock>
              <FieldBlock
                label={t('prefs.saveFiles.filename')}
                description={t('prefs.saveFiles.filenameDesc')}
              >
                <input
                  type="text"
                  value={filenameValue}
                  onChange={(e) => persistTemplate('filenameTemplate', e.target.value)}
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-border-focus"
                  aria-invalid={Boolean(filenameError)}
                />
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {OUTPUT_FILENAME_TOKENS.map((token) => (
                    <button
                      key={token}
                      type="button"
                      onClick={() => insertTemplateToken('filenameTemplate', token)}
                      className="rounded-full bg-elevated px-2.5 py-1 text-xs font-medium text-foreground ring-1 ring-inset ring-divider-subtle hover:bg-control"
                    >
                      {token}
                    </button>
                  ))}
                </div>
                {filenameError ? <p className="text-xs text-red-400">{t(filenameError.key, filenameError.vars)}</p> : null}
              </FieldBlock>
              <ToggleRow
                label={t('prefs.saveFiles.archiveByAuthor')}
                description={t('prefs.saveFiles.archiveByAuthorDesc')}
                checked={archiveByAuthor}
                onChange={(v) => onUpdate('archiveByAuthor', v)}
              />
              <FieldBlock
                label={t('prefs.saveFiles.authorFolder')}
                description={t('prefs.saveFiles.authorFolderDesc')}
              >
                <input
                  type="text"
                  value={folderValue}
                  onChange={(e) => persistTemplate('folderNameTemplate', e.target.value)}
                  disabled={!archiveByAuthor}
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-border-focus disabled:opacity-50"
                  aria-invalid={Boolean(folderError)}
                />
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {OUTPUT_FOLDER_TOKENS.map((token) => (
                    <button
                      key={token}
                      type="button"
                      onClick={() => insertTemplateToken('folderNameTemplate', token)}
                      disabled={!archiveByAuthor}
                      className="rounded-full bg-elevated px-2.5 py-1 text-xs font-medium text-foreground ring-1 ring-inset ring-divider-subtle hover:bg-control disabled:opacity-50"
                    >
                      {token}
                    </button>
                  ))}
                </div>
                {folderError ? <p className="text-xs text-red-400">{t(folderError.key, folderError.vars)}</p> : null}
              </FieldBlock>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('prefs.saveFiles.preview', {
                  path: (() => {
                    const fileErr = outputTemplateError(filenameValue, 'filename')
                    if (fileErr) return t(fileErr.key, fileErr.vars)
                    const folderErr = outputTemplateError(folderValue, 'folder')
                    if (folderErr) return t(folderErr.key, folderErr.vars)
                    return previewOutputPath({
                      downloadDir: settings.downloadDir || '~/Downloads',
                      filenameTemplate: filenameValue,
                      folderNameTemplate: folderValue,
                      archiveByAuthor
                    })
                  })()
                })}
              </p>
            </PrefCard>

            <PrefCard
              title={t('prefs.speed.title')}
              subtitle={t('prefs.speed.subtitle')}
            >
              <FieldBlock
                label={t('prefs.speed.preset')}
                description={t('prefs.speed.presetDesc')}
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label={t('prefs.speed.mode')}>
                  {DOWNLOAD_SPEED_MODES.map((mode) => {
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
                        <span>{t(`prefs.speed.${mode}`)}{selected ? ` · ${t('prefs.speed.selected')}` : ''}</span>
                      </span>
                    </button>
                    )
                  })}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground" aria-live="polite">
                  {t(`prefs.speed.${settings.downloadSpeedMode ?? 'balanced'}Short`)}
                </p>
              </FieldBlock>
            </PrefCard>

            <SettingsDisclosure
              title={t('prefs.queueBehavior.title')}
              subtitle={t('prefs.queueBehavior.subtitle')}
              className="order-3"
            >
            <PrefCard
              title={t('prefs.queueBehavior.queueTitle')}
              subtitle={t('prefs.queueBehavior.queueSubtitle')}
            >
              <FieldBlock
                label={t('prefs.queueBehavior.individualLimit')}
                description={t('prefs.queueBehavior.individualLimitDesc', {
                  individual: getEffectiveIndividualLimit(settings.downloadSpeedMode ?? 'balanced', settings.concurrency),
                  collection: getDownloadSpeedPresentation(settings.downloadSpeedMode ?? 'balanced').policy.collectionLimit,
                  active: getDownloadSpeedPresentation(settings.downloadSpeedMode ?? 'balanced').policy.activeCollectionLimit
                })}
              >
                <Stepper value={getEffectiveIndividualLimit(settings.downloadSpeedMode ?? 'balanced', settings.concurrency)} min={1} max={3} onChange={(v) => onUpdate('concurrency', v)} />
              </FieldBlock>
              <FieldBlock
                label={t('prefs.queueBehavior.delayStarts')}
                description={t('prefs.queueBehavior.delayStartsDesc')}
              >
                <Stepper
                  value={settings.sleepInterval}
                  min={0}
                  max={30}
                  suffix="s"
                  onChange={(v) => onUpdate('sleepInterval', v)}
                />
              </FieldBlock>
              <p className="text-xs text-muted-foreground leading-relaxed border-t border-border pt-3">{t('prefs.queueBehavior.retryNote')}</p>
            </PrefCard>
            </SettingsDisclosure>

            <SettingsDisclosure
              title={t('prefs.network.title')}
              subtitle={t('prefs.network.subtitle')}
              className="order-4"
            >
            <PrefCard
              title={t('prefs.network.directTitle')}
              subtitle={t('prefs.network.directSubtitle')}
            >
              <FieldBlock
                label={t('prefs.network.engine')}
                description={t('prefs.network.engineDesc')}
              >
                <select
                  value={settings.directMediaEngine ?? 'auto'}
                  onChange={(e) =>
                    onUpdate('directMediaEngine', e.target.value as 'auto' | 'ffmpeg' | 'ytdlp')
                  }
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-border-focus"
                >
                  <option value="auto">{t('prefs.network.engineAuto')}</option>
                  <option value="ffmpeg">{t('prefs.network.engineFfmpeg')}</option>
                  <option value="ytdlp">{t('prefs.network.engineYtdlp')}</option>
                </select>
              </FieldBlock>
              <FieldBlock
                label={t('prefs.network.fragments')}
                description={t('prefs.network.fragmentsDesc')}
              >
                <Stepper
                  value={settings.concurrentFragments ?? 5}
                  min={1}
                  max={32}
                  onChange={(v) => onUpdate('concurrentFragments', v)}
                />
              </FieldBlock>
              <FieldBlock
                label={t('prefs.network.externalDl')}
                description={t('prefs.network.externalDlDesc')}
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
            </SettingsDisclosure>

            <SettingsDisclosure
              title={t('prefs.playlists.title')}
              subtitle={t('prefs.playlists.subtitle')}
              className="order-5"
            >
            <PrefCard
              title={t('prefs.playlists.youtubeTitle')}
              subtitle={t('prefs.playlists.youtubeSubtitle')}
            >
              <FieldBlock label={t('prefs.playlists.mode')} description={t('prefs.playlists.modeDesc')}>
                <select
                  value={settings.youtubePlaylistMode ?? 'native'}
                  onChange={(e) => onUpdate('youtubePlaylistMode', e.target.value)}
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-border-focus"
                >
                  <option value="native">{t('prefs.playlists.native')}</option>
                  <option value="fanout">{t('prefs.playlists.fanout')}</option>
                </select>
              </FieldBlock>
              <FieldBlock
                label={t('prefs.playlists.sleep')}
                description={t('prefs.playlists.sleepDesc')}
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
                label={t('prefs.playlists.max')}
                description={t('prefs.playlists.maxDesc')}
              >
                <Stepper
                  value={settings.youtubePlaylistMaxDownloads ?? 0}
                  min={0}
                  max={500}
                  onChange={(v) => onUpdate('youtubePlaylistMaxDownloads', v)}
                />
              </FieldBlock>
            </PrefCard>
            </SettingsDisclosure>

            <PrefCard
              title={t('prefs.defaultFormat.title')}
              subtitle={t('prefs.defaultFormat.subtitle')}
              className="order-2"
            >
              <FieldBlock
                label={t('prefs.defaultFormat.videoQuality')}
                description={t('prefs.defaultFormat.videoQualityDesc')}
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
              <FieldBlock label={t('prefs.defaultFormat.audioQuality')} description={t('prefs.defaultFormat.audioQualityDesc')}>
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
            <PrefCard title={t('prefs.chromeCookie.title')} subtitle={t('prefs.chromeCookie.subtitle')}>
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
                    <HoverHintWrap text={t('prefs.chromeCookie.dismiss')} side="bottom">
                      <button
                        type="button"
                        onClick={() => setCookieSyncNote('')}
                        className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-control transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                        aria-label={t('prefs.chromeCookie.dismiss')}
                      >
                        <X className="w-4 h-4" aria-hidden />
                      </button>
                    </HoverHintWrap>
                  )}
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <p className="text-sm text-foreground">{t('prefs.chromeCookie.extension')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {settings.cookiesPath ? t('prefs.chromeCookie.cookiesReady') : extensionPath ? t('prefs.chromeCookie.extensionReady') : t('prefs.chromeCookie.extensionToLoad')}
                  </p>
                  <p className="text-xs text-muted-foreground/90 mt-1.5 leading-relaxed">
                    {t('prefs.chromeCookie.cookiesLocal')}
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
                    title={t('prefs.chromeCookie.openFolder')}
                    aria-busy={extensionInstallBusy}
                  >
                    {extensionInstallBusy ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                    ) : (
                      <Puzzle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    )}
                    {extensionInstallBusy ? t('prefs.chromeCookie.opening') : t('prefs.chromeCookie.installExtension')}
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
                    title={t('prefs.chromeCookie.pushCookies')}
                    aria-busy={cookieSyncBusy}
                  >
                    {cookieSyncBusy ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    )}
                    {cookieSyncBusy ? t('prefs.chromeCookie.syncing') : t('prefs.chromeCookie.syncBrowserCookies')}
                  </button>
                </div>
              </div>

              <SettingRow
                label={t('prefs.chromeCookie.browserProfile')}
                description={t('prefs.chromeCookie.browserProfileDesc')}
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

              <SettingsDisclosure title={t('prefs.chromeCookie.ifDouyinFails')} subtitle={t('prefs.chromeCookie.ifDouyinFailsDesc')}>
                <ToggleRow
                  label={t('prefs.chromeCookie.cloak')}
                  description={t('prefs.chromeCookie.cloakDesc')}
                  checked={settings.douyinUseCloakBrowser === true}
                  onChange={(v) => onUpdate('douyinUseCloakBrowser', v)}
                />
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  {t('prefs.chromeCookie.binaryLicense')}{' '}
                  <a href="https://github.com/CloakHQ/cloakbrowser/blob/main/BINARY-LICENSE.md" className="text-foreground underline underline-offset-2 hover:no-underline">
                    binary license
                  </a>.
                </p>
              </SettingsDisclosure>
            </PrefCard>
            <PrefCard title={t('prefs.inAppLogin.title')} subtitle={t('prefs.inAppLogin.subtitle')}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <select
                  value={nativeAuthSite}
                  onChange={(event) => setNativeAuthSite(event.target.value as NativeAuthSite)}
                  className={cn(controlClass, 'w-full sm:max-w-[220px]')}
                  aria-label={t('prefs.inAppLogin.accountSite')}
                >
                  <option value="douyin">Douyin</option>
                  <option value="youtube">YouTube</option>
                  <option value="tiktok">TikTok</option>
                  <option value="bilibili">Bilibili</option>
                  <option value="xiaohongshu">Xiaohongshu</option>
                  <option value="x">X / Twitter</option>
                </select>
                <button
                  type="button"
                  onClick={() => void handleStartNativeAuth()}
                  disabled={nativeAuthBusy}
                  className={cn(secondaryButtonClass, 'sm:flex-initial')}
                >
                  {nativeAuthBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Globe className="h-3.5 w-3.5" aria-hidden />}
                  {t('prefs.inAppLogin.openLogin')}
                </button>
              </div>
              <div className="space-y-2">
                {nativeAccounts.filter((account) => account.connected).map((account) => (
                  <div key={account.site} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-raised px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">{account.site}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{t('prefs.inAppLogin.cookiesMeta', { count: account.cookieCount, when: account.lastSyncedAt ? new Date(account.lastSyncedAt).toLocaleString() : t('prefs.inAppLogin.saved') })}</p>
                    </div>
                    <button type="button" onClick={() => void handleClearNativeAuth(account.site)} disabled={nativeAuthBusy} className="min-h-8 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-control hover:text-foreground disabled:opacity-50">
                      {t('prefs.inAppLogin.disconnect')}
                    </button>
                  </div>
                ))}
                {nativeAccounts.every((account) => !account.connected) && (
                  <p className="rounded-lg bg-raised/45 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                    {t('prefs.inAppLogin.noSessions')}
                  </p>
                )}
              </div>
            </PrefCard>
          </div>
        )}

        {section === 'sites' && (
          <div className={PREFERENCES_WORKSPACE_CLASS}>
            <PrefCard title={t('prefs.siteRules.title')} subtitle={t('prefs.siteRules.subtitle')}>
              <SiteRulesEditor settings={settings} onUpdate={onUpdate} />
            </PrefCard>
          </div>
        )}

        {section === 'advanced' && (
          <div className={PREFERENCES_WORKSPACE_CLASS}>
            <PrefCard title={t('prefs.system.title')} subtitle={t('prefs.system.subtitle')}>
              <SettingRow label={t('prefs.system.appVersion')} description={t('prefs.system.appVersionDesc')}>
                <span className="text-[13px] tabular-nums text-muted-foreground">{appVersion ?? '—'}</span>
              </SettingRow>
              <div className="space-y-3 border-t border-divider-subtle pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-medium text-foreground">{t('prefs.system.engines')}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {t('prefs.system.enginesDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void refreshEngineStatuses(true)}
                    disabled={engineBusy}
                    className={cn(secondaryButtonClass, 'shrink-0')}
                  >
                    {engineBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                    {engineBusy ? t('prefs.system.checking') : t('prefs.system.checkUpdates')}
                  </button>
                </div>
                <div className="space-y-2">
                  {engineStatuses.map((engine) => (
                    <div key={engine.name} className="rounded-xl bg-raised/45 px-3 py-3 ring-1 ring-inset ring-divider-subtle">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-foreground">{engine.name}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={engine.path || undefined}>
                            {engine.version ? t('prefs.system.version', { version: engine.version }) : t('prefs.system.notAvailable')} · {engine.source}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            'rounded-full px-2 py-1 text-[10px] font-semibold',
                            engine.source === 'missing'
                              ? 'border border-dashed border-border-strong bg-state-error-bg text-foreground'
                              : engine.updateState === 'available'
                                ? 'bg-selection text-foreground'
                                : 'bg-state-complete-bg text-foreground'
                          )}>
                            {engine.source === 'missing' ? t('prefs.system.missing') : engine.updateState === 'available' ? `${t('prefs.system.update')} ${engine.latestVersion}` : engine.version ? t('prefs.system.ready') : t('prefs.system.unavailable')}
                          </span>
                          {engine.canUpdate && (
                            <button
                              type="button"
                              onClick={() => void updateEngine(engine.name)}
                              disabled={engineBusy}
                              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-action px-2.5 text-xs font-semibold text-action-fg hover:bg-action-hover disabled:cursor-wait disabled:opacity-50"
                            >
                              <Download className="h-3 w-3" aria-hidden />
                              {t('prefs.system.update')}
                            </button>
                          )}
                        </div>
                      </div>
                      {engine.updateMessage && (
                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{engine.updateMessage}</p>
                      )}
                    </div>
                  ))}
                </div>
                {engineNote && <p className="text-xs leading-relaxed text-muted-foreground">{engineNote}</p>}
              </div>
              <SettingsDisclosure title={t('prefs.system.enginePaths')} subtitle={t('prefs.system.enginePathsDesc')}>
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
            <PrefCard
              title={t('prefs.expert.title')}
              subtitle={t('prefs.expert.subtitle')}
            >
              <div className="text-xs text-muted-foreground leading-relaxed">
                <a
                  href="https://github.com/jiji262/douyin-downloader#minimal-working-config"
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline font-medium hover:no-underline"
                >
                  {t('prefs.expert.upstreamReadme')}
                </a>
                <span className="text-muted-foreground"> — link, mode, number.post, browser_fallback, cookies.</span>
              </div>
              <FieldBlock label={t('prefs.expert.runPy')} description={t('prefs.expert.runPyDesc')}>
                <input
                  type="text"
                  value={settings.douyinBulkRunPyPath ?? ''}
                  onChange={(e) => onUpdate('douyinBulkRunPyPath', e.target.value)}
                  placeholder="/path/to/douyin-downloader/run.py"
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-border-focus"
                />
              </FieldBlock>
              <FieldBlock label={t('prefs.expert.configYml')} description={t('prefs.expert.configYmlDesc')}>
                <input
                  type="text"
                  value={settings.douyinBulkConfigPath ?? ''}
                  onChange={(e) => onUpdate('douyinBulkConfigPath', e.target.value)}
                  placeholder="/path/to/douyin-downloader/config.yml"
                  className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-border-focus"
                />
              </FieldBlock>
              <FieldBlock
                label={t('prefs.expert.bulkOutput')}
                description={t('prefs.expert.bulkOutputDesc')}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="text"
                    value={settings.douyinBulkOutputPath ?? ''}
                    onChange={(e) => onUpdate('douyinBulkOutputPath', e.target.value)}
                    placeholder={t('prefs.expert.useDefaultDir')}
                    className="w-full max-w-md px-3 py-2 rounded-lg bg-raised border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-border-focus"
                  />
                  <button
                    type="button"
                    onClick={handleBrowseBulkOutput}
                    className="inline-flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-elevated text-xs font-medium text-foreground hover:bg-control"
                  >
                    <Folder size={14} aria-hidden />
                    {t('prefs.expert.chooseFolder')}
                  </button>
                </div>
              </FieldBlock>
              <FieldBlock
                label={t('prefs.expert.threads')}
                description={t('prefs.expert.threadsDesc')}
              >
                <Stepper
                  value={settings.douyinBulkThreads ?? 5}
                  min={1}
                  max={32}
                  onChange={(v) => onUpdate('douyinBulkThreads', v)}
                />
              </FieldBlock>
              <FieldBlock
                label={t('prefs.expert.verbose')}
                description={t('prefs.expert.verboseDesc')}
              >
                <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={Boolean(settings.douyinBulkVerboseWarnings)}
                    onChange={(e) => onUpdate('douyinBulkVerboseWarnings', e.target.checked)}
                    className="rounded border-border"
                  />
                  {t('common.enable')}
                </label>
              </FieldBlock>
              <FieldBlock
                label={t('prefs.expert.bulkUrl')}
                description={t('prefs.expert.bulkUrlDesc')}
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
                      {bulkJobBusy ? t('prefs.expert.working') : t('prefs.expert.startBulk')}
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
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              </FieldBlock>
              {(bulkJob || bulkJobNote) && (
                <div className="rounded-lg border border-border bg-raised px-3 py-2 space-y-1">
                  {bulkJob && (
                    <>
                      <p className="text-xs text-foreground">
                        {t('prefs.expert.job')} <code>{bulkJob.id}</code> - <span>{t(`prefs.expert.jobState.${bulkJob.state}`)}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('prefs.expert.startedLabel')} {new Date(bulkJob.startedAt).toLocaleString()}
                        {bulkJob.endedAt ? `  ${t('prefs.expert.endedLabel')} ${new Date(bulkJob.endedAt).toLocaleString()}` : ''}
                      </p>
                      {bulkJob.stderrTail ? (
                        <pre className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words border border-border rounded-md p-2 max-h-32 overflow-y-auto">
                          {bulkJob.stderrTail}
                        </pre>
                      ) : null}
                    </>
                  )}
                  {bulkJobNote ? <p className="text-xs text-muted-foreground">{bulkJobNote}</p> : null}
                </div>
              )}
            </PrefCard>
            <PrefCard title={t('prefs.remote.title')} subtitle={t('prefs.remote.subtitle')}>
              <ToggleRow
                label={t('prefs.remote.enable')}
                description={t('prefs.remote.enableDesc')}
                checked={settings.remoteApiEnabled === true}
                onChange={(v) => {
                  void (async () => {
                    await onUpdate('remoteApiEnabled', v)
                    await refreshSettingsFromMain()
                  })()
                }}
              />
              <FieldBlock label={t('prefs.remote.token')} description={t('prefs.remote.tokenDesc')}>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={settings.remoteApiToken || ''}
                    className={cn(controlClass, 'min-w-0 flex-1 font-mono text-[12px]')}
                  />
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    disabled={!settings.remoteApiToken}
                    onClick={() => {
                      if (!settings.remoteApiToken) return
                      void navigator.clipboard.writeText(settings.remoteApiToken).then(() => {
                        setRemoteTokenCopied(true)
                        window.setTimeout(() => setRemoteTokenCopied(false), 1500)
                      })
                    }}
                  >
                    {remoteTokenCopied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                    {remoteTokenCopied ? t('common.copied') : t('common.copy')}
                  </button>
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    onClick={() => {
                      void (async () => {
                        await onUpdate('remoteApiToken', '')
                        await refreshSettingsFromMain()
                      })()
                    }}
                  >
                    {t('prefs.remote.regenerate')}
                  </button>
                </div>
              </FieldBlock>
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldBlock label={t('prefs.remote.bind')}>
                  <select
                    value={settings.remoteApiBind ?? '127.0.0.1'}
                    onChange={(event) => void onUpdate('remoteApiBind', event.target.value === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1')}
                    className={cn(controlClass, 'w-full')}
                  >
                    <option value="127.0.0.1">{t('prefs.remote.thisMac')}</option>
                    <option value="0.0.0.0">{t('prefs.remote.lan')}</option>
                  </select>
                </FieldBlock>
                <FieldBlock label={t('prefs.remote.port')}>
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={settings.remoteApiPort ?? 18766}
                    onChange={(event) => {
                      const port = Number(event.target.value)
                      if (Number.isFinite(port)) void onUpdate('remoteApiPort', port)
                    }}
                    className={cn(controlClass, 'w-full')}
                  />
                </FieldBlock>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground break-all">
                {`curl -H "Authorization: Bearer ${settings.remoteApiToken || 'YOUR_TOKEN'}" -d '{"url":"https://example.com/watch?v=1"}' http://${(settings.remoteApiBind === '0.0.0.0' ? '<host>' : '127.0.0.1')}:${settings.remoteApiPort ?? 18766}/v1/jobs`}
              </p>
              <FieldBlock
                label={t('prefs.remote.mcp')}
                description={t('prefs.remote.mcpDesc')}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    disabled={!settings.remoteApiEnabled || !settings.remoteApiToken}
                    onClick={() => {
                      const host = settings.remoteApiBind === '0.0.0.0' ? '127.0.0.1' : (settings.remoteApiBind || '127.0.0.1')
                      const port = settings.remoteApiPort ?? 18766
                      const text = `URL: http://${host}:${port}/mcp\nHeader: Authorization: Bearer ${settings.remoteApiToken}`
                      void navigator.clipboard.writeText(text).then(() => {
                        setMcpConfigCopied(true)
                        window.setTimeout(() => setMcpConfigCopied(false), 1500)
                      })
                    }}
                  >
                    {mcpConfigCopied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                    {mcpConfigCopied ? t('common.copied') : t('prefs.remote.copyMcp')}
                  </button>
                </div>
              </FieldBlock>
              <ToggleRow
                label={t('prefs.remote.allowWrite')}
                description={t('prefs.remote.allowWriteDesc')}
                checked={settings.remoteApiMcpAllowWrite === true}
                onChange={(v) => void onUpdate('remoteApiMcpAllowWrite', v)}
              />
              <ToggleRow
                label={t('prefs.remote.requireConfirm')}
                description={t('prefs.remote.requireConfirmDesc')}
                checked={settings.remoteApiMcpRequireConfirm !== false}
                onChange={(v) => void onUpdate('remoteApiMcpRequireConfirm', v)}
              />
              {settings.remoteApiEnabled ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-muted-foreground">{t('prefs.remote.recentMcp')}</p>
                  {mcpLogs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t('prefs.remote.noMcp')}</p>
                  ) : (
                    <ul className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-border p-2 text-[11px] leading-relaxed text-muted-foreground">
                      {mcpLogs.map((entry) => (
                        <li key={`${entry.timestamp}-${entry.tool}-${entry.elapsedMs}`}>
                          {entry.success ? 'ok' : entry.errorCode || 'error'} · {entry.argumentSummary} · {entry.elapsedMs}ms
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
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
              {t('prefs.speed.turboTitle')}
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t('prefs.speed.turboBody')}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setTurboModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-border bg-elevated text-sm font-medium text-foreground hover:bg-control transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void confirmTurboMode()}
                className="px-4 py-2 rounded-lg border border-border-strong bg-control text-sm font-medium text-foreground hover:opacity-95 transition-opacity"
              >
                {t('prefs.speed.enableTurbo')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SiteRulesEditor({ settings, onUpdate }: { settings: SettingsData; onUpdate: (key: string, value: unknown) => Promise<void> }) {
  const { t } = useTranslation()
  const persisted = settings.siteRules ?? []
  const [drafts, setDrafts] = useState<SiteRule[]>([])
  const rows = [...persisted, ...drafts]
  const persist = (next: SiteRule[]) => void onUpdate('siteRules', next.filter((rule) => canPersistSiteRule(rule.domain)))

  const add = () => {
    setDrafts((current) => [
      ...current,
      { id: crypto.randomUUID(), domain: '', format: 'best', quality: '1080', enabled: true } satisfies SiteRule
    ])
  }

  const updateRow = (id: string, patch: Partial<SiteRule>) => {
    const draft = drafts.find((rule) => rule.id === id)
    if (draft) {
      const nextDraft = { ...draft, ...patch }
      if (canPersistSiteRule(nextDraft.domain)) {
        setDrafts((current) => current.filter((rule) => rule.id !== id))
        persist([...persisted, nextDraft])
        return
      }
      setDrafts((current) => current.map((rule) => (rule.id === id ? nextDraft : rule)))
      return
    }
    persist(persisted.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)))
  }

  const removeRow = (id: string) => {
    if (drafts.some((rule) => rule.id === id)) {
      setDrafts((current) => current.filter((rule) => rule.id !== id))
      return
    }
    persist(persisted.filter((rule) => rule.id !== id))
  }

  return (
    <div className="space-y-4">
      {rows.length > 0 ? (
        <div className="space-y-3">
          {rows.map((rule, index) => (
            <div key={rule.id} className="rounded-lg bg-raised/45 p-3 ring-1 ring-inset ring-divider-subtle">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-end">
                <FieldBlock label={t('prefs.siteRules.website')}>
                  <input
                    aria-label={`Site rule ${index + 1} domain`}
                    value={rule.domain}
                    onChange={(e) => updateRow(rule.id, { domain: e.target.value })}
                    placeholder="youtube.com"
                    className={cn(controlClass, 'w-full')}
                  />
                </FieldBlock>
                <FieldBlock label={t('prefs.siteRules.downloadAs')}>
                  <select
                    aria-label={`Site rule ${index + 1} output type`}
                    value={rule.format}
                    onChange={(e) => updateRow(rule.id, { format: e.target.value as SiteRule['format'] })}
                    className={controlClass}
                  >
                    <option value="best">{t('prefs.siteRules.best')}</option>
                    <option value="video">{t('prefs.siteRules.video')}</option>
                    <option value="audio">{t('prefs.siteRules.audio')}</option>
                  </select>
                </FieldBlock>
                <FieldBlock label={rule.format === 'audio' ? t('prefs.siteRules.kbps') : t('prefs.siteRules.quality')}>
                  <input
                    aria-label={`Site rule ${index + 1} quality`}
                    inputMode="numeric"
                    value={rule.quality}
                    onChange={(e) => updateRow(rule.id, { quality: e.target.value.replace(/[^0-9]/g, '') })}
                    onBlur={() => {
                      const n = Number(rule.quality)
                      if (!Number.isFinite(n) || n <= 0) updateRow(rule.id, { quality: rule.format === 'audio' ? '320' : '1080' })
                    }}
                    className={cn(controlClass, 'w-full sm:w-24')}
                  />
                </FieldBlock>
                <div className="flex items-center gap-2 sm:pb-0.5">
                  <label className="inline-flex min-h-10 items-center gap-2 text-[13px] text-foreground">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) => updateRow(rule.id, { enabled: e.target.checked })}
                      className="h-4 w-4 accent-[rgb(var(--color-accent))]"
                    />
                    {t('prefs.siteRules.active')}
                  </label>
                  <button
                    type="button"
                    aria-label={`Remove ${rule.domain || 'site'} rule`}
                    onClick={() => removeRow(rule.id)}
                    className="inline-flex min-h-10 items-center justify-center rounded-lg px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-control hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                  >
                    <X className="h-4 w-4" aria-hidden />
                    <span className="sr-only">{t('prefs.siteRules.remove')}</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg bg-raised/35 px-4 py-4 text-xs leading-relaxed text-muted-foreground ring-1 ring-inset ring-divider-subtle">
          {t('prefs.siteRules.empty')}
        </div>
      )}
      <button type="button" onClick={add} className={secondaryButtonClass}>
        {t('prefs.siteRules.add')}
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
  const { t } = useTranslation()
  return (
    <div className="v-settings-row flex min-h-11 items-center justify-between gap-6 py-2 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-[13px] text-foreground">{label}</p>
        {description ? <p className="mt-0.5 max-w-[46ch] text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="flex h-10 w-12 shrink-0 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus max-sm:self-end"
        aria-pressed={checked}
        aria-label={`${label}: ${checked ? t('common.on') : t('common.off')}`}
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
