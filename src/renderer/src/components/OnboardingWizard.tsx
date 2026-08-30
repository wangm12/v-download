import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Folder, Globe, Loader2, Puzzle, RefreshCw, ShieldCheck, X } from 'lucide-react'
import type { EngineStatus, SettingsData } from '@/types'
import { cn } from '@/lib/cn'

interface OnboardingWizardProps {
  settings: SettingsData
  onComplete: () => Promise<void>
}

const steps = [
  { label: 'Engines', description: 'Verify the local tools' },
  { label: 'Browser', description: 'Connect the extension' },
  { label: 'Destination', description: 'Choose where files go' },
  { label: 'Proxy', description: 'Optional network routing' }
] as const

const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:cursor-not-allowed disabled:opacity-50'

export function OnboardingWizard({ settings, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(0)
  const [engines, setEngines] = useState<EngineStatus[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [extensionReady, setExtensionReady] = useState(false)
  const [destination, setDestination] = useState(settings.downloadDir)
  const [proxyUrl, setProxyUrl] = useState(settings.proxyUrl ?? '')

  const loadEngines = useCallback(async (check = false) => {
    const loader = check ? window.api?.checkEngineUpdates : window.api?.getEngineStatus
    if (!loader) return
    setBusy(true)
    setNote('')
    try {
      const result = await loader()
      if (result.error) setNote(result.error)
      else if (result.data) setEngines(result.data)
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void loadEngines()
  }, [loadEngines])

  useEffect(() => {
    setDestination(settings.downloadDir)
    setProxyUrl(settings.proxyUrl ?? '')
  }, [settings.downloadDir, settings.proxyUrl])

  const enginesReady = useMemo(
    () => engines.length > 0 && engines.every((engine) => engine.source !== 'missing' && Boolean(engine.version)),
    [engines]
  )

  const updateSetting = useCallback(async (key: string, value: unknown): Promise<boolean> => {
    if (!window.api) return false
    const result = await window.api.updateSettings(key, value)
    if (!result.ok) {
      setNote(result.error || `Could not save ${key}.`)
      return false
    }
    return true
  }, [])

  const chooseDestination = useCallback(async () => {
    const selected = await window.api?.selectDownloadFolder?.()
    if (!selected) return
    const saved = await updateSetting('downloadDir', selected)
    if (saved) setDestination(selected)
  }, [updateSetting])

  const installExtension = useCallback(async () => {
    if (!window.api?.installChromeExtension) return
    setBusy(true)
    setNote('')
    try {
      const result = await window.api.installChromeExtension()
      if (!result.ok) setNote(result.error || 'Could not open the extension installer.')
      else {
        setExtensionReady(true)
        setNote('Load the opened folder as an unpacked extension in Chrome, then continue.')
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  const complete = useCallback(async () => {
    setBusy(true)
    try {
      if (!(await updateSetting('proxyUrl', proxyUrl.trim()))) return
      await onComplete()
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [onComplete, proxyUrl, updateSetting])

  const next = useCallback(async () => {
    setNote('')
    if (step === 0 && !enginesReady) {
      setNote('yt-dlp and ffmpeg must be available before the first download.')
      return
    }
    if (step === 2 && !destination) {
      setNote('Choose a download folder to continue.')
      return
    }
    if (step === 3) {
      await complete()
      return
    }
    setStep((current) => Math.min(steps.length - 1, current + 1))
  }, [complete, destination, enginesReady, step])

  const skip = useCallback(async () => {
    setBusy(true)
    try {
      await onComplete()
    } finally {
      setBusy(false)
    }
  }, [onComplete])

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="flex max-h-[min(760px,92vh)] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl bg-background shadow-2xl ring-1 ring-inset ring-divider-strong">
        <header className="flex items-start justify-between border-b border-divider-subtle px-6 py-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-tertiary-foreground">First run</p>
            <h1 id="onboarding-title" className="mt-1 text-lg font-semibold tracking-tight text-foreground">Set up V-Download</h1>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">A few checks now make the first download predictable.</p>
          </div>
          <button type="button" onClick={() => void skip()} disabled={busy} aria-label="Skip setup" className="rounded-lg p-2 text-muted-foreground hover:bg-control hover:text-foreground">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[220px_minmax(0,1fr)]">
          <nav className="border-b border-divider-subtle bg-sidebar px-4 py-4 md:border-b-0 md:border-r" aria-label="Setup steps">
            <ol className="flex gap-2 overflow-x-auto md:flex-col md:gap-1">
              {steps.map((item, index) => (
                <li key={item.label} className="min-w-[130px] md:min-w-0">
                  <button type="button" onClick={() => index <= step && setStep(index)} className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors', index === step ? 'bg-selection text-action' : 'text-muted-foreground hover:bg-control', index > step && 'opacity-60')}>
                    <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-inset', index < step ? 'bg-state-complete-bg text-success ring-success/30' : index === step ? 'bg-action text-action-fg ring-action' : 'bg-control text-muted-foreground ring-divider-subtle')}>
                      {index < step ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12px] font-semibold">{item.label}</span>
                      <span className="mt-0.5 hidden text-[10px] leading-relaxed md:block">{item.description}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          <main className="min-h-0 overflow-y-auto px-5 py-6 sm:px-8">
            {step === 0 && (
              <section>
                <StepHeading eyebrow="Step 1 of 4" title="Verify the download engines" description="yt-dlp extracts media and ffmpeg merges or converts it. Both run locally on your machine." />
                <div className="mt-6 space-y-3">
                  {engines.map((engine) => (
                    <div key={engine.name} className="rounded-xl bg-surface/70 p-4 ring-1 ring-inset ring-divider-subtle">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-selection text-action">
                          {engine.name === 'yt-dlp' ? <Globe className="h-4 w-4" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-semibold text-foreground">{engine.name}</p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{engine.version ? `Version ${engine.version}` : 'Not found'} · {engine.source}</p>
                        </div>
                        <span className={cn('rounded-full px-2 py-1 text-[10px] font-semibold', engine.version ? 'bg-state-complete-bg text-success' : 'bg-error/[0.12] text-error')}>
                          {engine.version ? 'Ready' : 'Missing'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => void loadEngines(true)} disabled={busy} className={cn(buttonClass, 'mt-4 bg-elevated text-foreground ring-1 ring-inset ring-divider-subtle hover:bg-control')}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                  Check again
                </button>
              </section>
            )}

            {step === 1 && (
              <section>
                <StepHeading eyebrow="Step 2 of 4" title="Connect your browser" description="The extension is optional, but it unlocks one-click downloads and logged-in page detection." />
                <div className="mt-6 rounded-xl bg-surface/70 p-5 ring-1 ring-inset ring-divider-subtle">
                  <div className="flex items-start gap-3">
                    <Puzzle className="mt-0.5 h-5 w-5 shrink-0 text-action" aria-hidden />
                    <div>
                      <p className="text-[13px] font-semibold text-foreground">Chrome extension</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Open the extension folder and Chrome’s extensions page. Choose Load unpacked, then select the folder.</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => void installExtension()} disabled={busy} className={cn(buttonClass, 'mt-5 bg-action text-action-fg hover:bg-action-hover')}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Puzzle className="h-3.5 w-3.5" aria-hidden />}
                    {extensionReady ? 'Open installer again' : 'Install extension'}
                  </button>
                </div>
              </section>
            )}

            {step === 2 && (
              <section>
                <StepHeading eyebrow="Step 3 of 4" title="Choose a download folder" description="Completed files will be saved here by default. You can change this later in Preferences." />
                <div className="mt-6 rounded-xl bg-surface/70 p-5 ring-1 ring-inset ring-divider-subtle">
                  <div className="flex items-center gap-3 rounded-lg bg-raised px-3 py-3 ring-1 ring-inset ring-divider-subtle">
                    <Folder className="h-4 w-4 shrink-0 text-action" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{destination || 'No folder selected'}</span>
                    <button type="button" onClick={() => void chooseDestination()} className={cn(buttonClass, 'min-h-9 bg-elevated px-3 text-foreground hover:bg-control')}>Browse</button>
                  </div>
                </div>
              </section>
            )}

            {step === 3 && (
              <section>
                <StepHeading eyebrow="Step 4 of 4" title="Add a proxy (optional)" description="Use a local HTTP, HTTPS, or SOCKS5 proxy for yt-dlp requests. Leave this empty if you do not use one." />
                <div className="mt-6 rounded-xl bg-surface/70 p-5 ring-1 ring-inset ring-divider-subtle">
                  <label className="block text-[12px] font-medium text-foreground" htmlFor="onboarding-proxy">Proxy URL</label>
                  <input id="onboarding-proxy" value={proxyUrl} onChange={(event) => setProxyUrl(event.target.value)} placeholder="http://127.0.0.1:8080" className="mt-2 min-h-11 w-full rounded-lg bg-raised px-3 text-[13px] text-foreground ring-1 ring-inset ring-divider-subtle outline-none placeholder:text-tertiary-foreground focus:ring-2 focus:ring-border-focus" />
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Credentials are not accepted here. Use a local proxy or configure authentication in the proxy itself.</p>
                </div>
              </section>
            )}

            {note && <p className="mt-4 rounded-lg bg-state-error-bg px-3 py-2 text-xs leading-relaxed text-error" role="status">{note}</p>}
          </main>
        </div>

        <footer className="flex items-center justify-between border-t border-divider-subtle px-5 py-4 sm:px-8">
          <button type="button" onClick={() => (step === 0 ? void skip() : setStep((current) => current - 1))} disabled={busy} className={cn(buttonClass, 'bg-elevated text-foreground ring-1 ring-inset ring-divider-subtle hover:bg-control')}>
            {step === 0 ? 'Set up later' : <><ChevronLeft className="h-3.5 w-3.5" aria-hidden />Back</>}
          </button>
          <button type="button" onClick={() => void next()} disabled={busy} className={cn(buttonClass, 'bg-action text-action-fg hover:bg-action-hover')}>
            {step === steps.length - 1 ? 'Finish setup' : 'Continue'}
            {step < steps.length - 1 && <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
          </button>
        </footer>
      </div>
    </div>
  )
}

function StepHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-tertiary-foreground">{eyebrow}</p>
      <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-2 max-w-[56ch] text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  )
}
