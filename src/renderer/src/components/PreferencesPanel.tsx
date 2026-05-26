import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { Folder, RefreshCw, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Stepper } from './Stepper'
import { HoverHintWrap } from './HoverHintWrap'
import type { PrefSection } from '@/preferencesNav'
import { PREF_SECTION_HEADER } from '@/preferencesNav'
import type { SettingsData } from '@/types'

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
    ytdlpPath: '',
    ffmpegPath: ''
  })

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

  const onUpdate = useCallback(async (key: string, value: unknown) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    if (window.api) await window.api.updateSettings(key, value)
  }, [])

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
                description="Pause after each new task begins before starting the next (0–30s). Helps avoid hammering the same origin."
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
