import { useState, useEffect, useCallback, useRef } from 'react'
import { Folder, RefreshCw, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Stepper } from './Stepper'
import type { SettingsData } from '@/types'

const VIDEO_QUALITIES = ['2160', '1080', '720', '360', '240', '144']
const AUDIO_QUALITIES = ['320', '256', '128']

export function SettingsPage() {
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
    ytdlpPath: '',
    ffmpegPath: '',
  })

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
      setCookieSyncNote(`Cookies saved (${data.count} entries). You can retry your download in the main window.`)
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
            'Open http://127.0.0.1:18765/cookie-sync-landing in Chrome with the V-Download extension.',
      )
      cookieSyncWaitTimerRef.current = window.setTimeout(() => {
        cookieSyncWaitTimerRef.current = null
        awaitingCookiePushRef.current = false
        setCookieSyncBusy(false)
        setCookieSyncNote(
          'Still waiting. Open the sync URL in Chrome with the extension (not Safari). Visit the site you need, then click Sync cookies again.',
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

  const handleDone = () => {
    window.api?.closeWindow()
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <header
        className="h-11 flex-shrink-0 relative flex items-center bg-elevated border-b border-border"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-foreground pointer-events-none">
          Settings
        </span>
      </header>

      <div
        className="flex-1 overflow-y-auto p-6"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <section className="mb-8">
          <h3 className="text-sm font-semibold text-foreground mb-4">General</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-muted-foreground mb-2">Download Location</label>
              <div className="flex gap-2">
                <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-surface border border-border">
                  <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm text-foreground truncate">{settings.downloadDir}</span>
                </div>
                <button
                  onClick={handleBrowse}
                  className="px-4 py-2 rounded-lg bg-elevated border border-border text-sm font-medium text-foreground hover:bg-surface transition-colors"
                >
                  Browse
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-2">Concurrent Downloads</label>
              <Stepper
                value={settings.concurrency}
                min={1}
                max={10}
                onChange={(v) => onUpdate('concurrency', v)}
              />
            </div>

            <ToggleRow
              label="Show Format Dialog"
              checked={settings.showFormatDialog}
              onChange={(v) => onUpdate('showFormatDialog', v)}
            />

            <ToggleRow
              label="Playlist/Channel Subfolder"
              checked={settings.playlistSubfolder}
              onChange={(v) => onUpdate('playlistSubfolder', v)}
            />

            {(cookieSyncBusy || cookieSyncNote) && (
              <div
                className={cn(
                  'rounded-lg border px-3 py-3 flex gap-3 items-start',
                  cookieSyncBusy
                    ? 'border-accent-indigo/40 bg-accent-indigo/10'
                    : 'border-border bg-surface',
                )}
                role="status"
              >
                {cookieSyncBusy && (
                  <Loader2
                    className="w-5 h-5 shrink-0 mt-0.5 animate-spin text-accent-indigo"
                    aria-hidden
                  />
                )}
                <p className="text-sm text-foreground leading-relaxed flex-1 min-w-0">{cookieSyncNote}</p>
                {!cookieSyncBusy && cookieSyncNote && (
                  <button
                    type="button"
                    onClick={() => setCookieSyncNote('')}
                    className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-elevated transition-colors"
                    aria-label="Dismiss message"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground">Chrome Extension</p>
                <p className="text-xs text-muted-foreground">
                  {settings.cookiesPath ? 'Connected — cookies synced' : 'Detect videos & sync cookies'}
                  {' '}
                  Douyin uses your real browser profile (see “Browser for Douyin” below), not only this file.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {settings.cookiesPath && (
                  <span className="px-2.5 py-1 rounded-md bg-accent-green/20 text-accent-green text-xs font-medium">
                    Connected
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleForceCookieSync}
                  disabled={cookieSyncBusy}
                  className={cn(
                    'min-w-[7.75rem] justify-center px-3 py-1.5 rounded-lg border text-xs font-medium inline-flex items-center gap-2 transition-colors',
                    cookieSyncBusy
                      ? 'border-accent-indigo/40 bg-accent-indigo/10 text-accent-indigo cursor-wait ring-1 ring-inset ring-accent-indigo/25'
                      : 'bg-elevated border-border text-foreground hover:bg-surface',
                  )}
                  title="Push fresh cookies from Chrome into V-Download"
                  aria-busy={cookieSyncBusy}
                >
                  {cookieSyncBusy ? (
                    <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" aria-hidden />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  )}
                  {cookieSyncBusy ? 'Syncing…' : 'Sync cookies'}
                </button>
                <button
                  type="button"
                  onClick={() => window.api?.installChromeExtension?.()}
                  disabled={cookieSyncBusy}
                  className={cn(
                    'px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                    cookieSyncBusy
                      ? 'border-border/50 text-muted-foreground/50 cursor-not-allowed'
                      : 'bg-elevated border-border text-foreground hover:bg-surface',
                  )}
                  title={cookieSyncBusy ? 'Wait until cookie sync finishes' : undefined}
                >
                  Install Guide
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-2">Browser for Douyin (yt-dlp)</label>
              <select
                value={settings.cookiesFromBrowser ?? 'chrome'}
                onChange={(e) => onUpdate('cookiesFromBrowser', e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-white/30"
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
                Open Douyin in this browser at least once so cookies exist. Update yt-dlp (<code className="text-foreground/90">brew upgrade yt-dlp</code> or{' '}
                <code className="text-foreground/90">yt-dlp -U</code>) if errors persist.
              </p>
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-2">Delay Between Downloads</label>
              <Stepper
                value={settings.sleepInterval}
                min={0}
                max={30}
                suffix="s"
                onChange={(v) => onUpdate('sleepInterval', v)}
              />
            </div>
          </div>
        </section>

        <section className="mb-8">
          <h3 className="text-sm font-semibold text-foreground mb-4">Default Format</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-muted-foreground mb-2">Video Quality</label>
              <select
                value={settings.defaultVideoQuality}
                onChange={(e) => onUpdate('defaultVideoQuality', e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-white/30"
              >
                {VIDEO_QUALITIES.map((q) => (
                  <option key={q} value={q}>{q}p</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-2">Audio Quality</label>
              <select
                value={settings.defaultAudioQuality}
                onChange={(e) => onUpdate('defaultAudioQuality', e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-white/30"
              >
                {AUDIO_QUALITIES.map((q) => (
                  <option key={q} value={q}>{q}kbps</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-foreground mb-4">Advanced</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-muted-foreground mb-2">yt-dlp Path</label>
              <input
                type="text"
                value={settings.ytdlpPath ?? ''}
                readOnly
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-white/30"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-2">ffmpeg Path</label>
              <input
                type="text"
                value={settings.ffmpegPath ?? ''}
                readOnly
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-white/30"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-2">Version</label>
              <p className="text-sm text-muted-foreground">1.0.0</p>
            </div>
          </div>
        </section>
      </div>

      <footer
        className="flex-shrink-0 p-4 border-t border-border bg-elevated"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          type="button"
          onClick={handleDone}
          disabled={cookieSyncBusy}
          title={cookieSyncBusy ? 'Wait until cookie sync finishes' : undefined}
          className={cn(
            'w-full py-2.5 rounded-lg font-medium transition-colors',
            cookieSyncBusy
              ? 'bg-muted-foreground/25 text-muted-foreground cursor-not-allowed'
              : 'bg-accent-indigo text-background hover:bg-accent-indigo-dark',
          )}
        >
          {cookieSyncBusy ? 'Syncing cookies…' : 'Done'}
        </button>
      </footer>
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-sm text-foreground">{label}</label>
      <button
        onClick={() => onChange(!checked)}
        className={cn('w-11 h-6 rounded-full transition-colors', checked ? 'bg-foreground' : 'bg-border')}
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
