import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Folder, Loader2, Puzzle, RefreshCw, X } from 'lucide-react'
import type { EngineStatus, SettingsData } from '@/types'
import { cn } from '@/lib/cn'
import { useTranslation } from 'react-i18next'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { DialogShell } from './ui'

interface OnboardingWizardProps {
  settings: SettingsData
  onComplete: () => Promise<void>
}

const steps = ['ui.enginesStep', 'ui.browserStep', 'ui.folderStep', 'ui.proxyStep'] as const

export function OnboardingWizard({ settings, onComplete }: OnboardingWizardProps) {
  const { t } = useTranslation()
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
      setNote(result.error || t('prefs.settingsSaveFailed'))
      return false
    }
    return true
  }, [t])

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
      if (!result.ok) setNote(result.error || t('ui.extensionSetupFailed'))
      else {
        setExtensionReady(true)
        setNote(t('prefs.chromeCookie.extensionToLoad'))
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [t])

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
      setNote(t('ui.engineMissing'))
      return
    }
    if (step === 2 && !destination) {
      setNote(t('ui.chooseFolder'))
      return
    }
    if (step === 3) {
      await complete()
      return
    }
    setStep((current) => Math.min(steps.length - 1, current + 1))
  }, [complete, destination, enginesReady, step, t])

  const skip = useCallback(async () => {
    setBusy(true)
    try {
      await onComplete()
    } finally {
      setBusy(false)
    }
  }, [onComplete])

  const dialogRef = useDialogFocus<HTMLDivElement>(() => { if (!busy) void skip() })
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4">
      <DialogShell ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="onboarding-title" className="flex max-h-[calc(100dvh-32px)] max-w-[720px] flex-col outline-none">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-divider-subtle px-5 py-4">
          <div><h1 id="onboarding-title" className="text-base font-semibold">{t('ui.welcome')}</h1><p className="mt-1 text-xs text-muted-foreground">{t('ui.welcomeHint')}</p></div>
          <button type="button" onClick={() => void skip()} disabled={busy} aria-label={t('ui.skipSetup')} className="v-button-ghost h-9 w-9 !p-0"><X className="h-4 w-4" aria-hidden /></button>
        </header>
        <nav className="shrink-0 border-b border-divider-subtle px-5 py-3" aria-label={t('ui.welcome')}>
          <ol className="flex items-center justify-between gap-2">
            {steps.map((label, index) => <li key={label} className="min-w-0"><button type="button" disabled={index > step} aria-current={index === step ? 'step' : undefined} onClick={() => index <= step && setStep(index)} className={cn('flex min-h-8 items-center gap-2 rounded-button px-1 text-xs disabled:opacity-40', index === step ? 'text-foreground' : 'text-muted-foreground')}>
              <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', index === step ? 'bg-action text-action-fg' : 'bg-control')}>{index < step ? <Check className="h-3 w-3" aria-hidden /> : index + 1}</span><span className="hidden sm:block">{t(label)}</span>
            </button></li>)}
          </ol>
        </nav>
        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <p className="mb-3 text-xs text-muted-foreground">{t('ui.stepOf', { step: step + 1, total: steps.length })}{(step === 1 || step === 3) && ` · ${t('ui.optional')}`}</p>
          {step === 0 && <section><h2 className="text-lg font-semibold">{t(enginesReady ? 'ui.engineReady' : 'ui.engineMissing')}</h2><p className="mt-2 text-sm text-muted-foreground">{t('ui.engineHint')}</p>
            <details className="v-disclosure mt-4" open={!enginesReady}><summary><ChevronDown className="v-chevron h-3.5 w-3.5" aria-hidden />{t('ui.technicalDetails')}</summary>
              <dl className="space-y-3 py-3">{engines.map((engine) => <div key={engine.name} className="flex items-center justify-between gap-3 text-xs"><dt className="font-medium">{engine.name}</dt><dd className="text-muted-foreground">{engine.version || t('ui.engineNotFound')}</dd><dd className={engine.version ? 'text-success' : 'text-error'}>{t(engine.version ? 'prefs.system.ready' : 'prefs.system.missing')}</dd></div>)}</dl>
              <button type="button" onClick={() => void loadEngines(true)} disabled={busy} className="v-button-secondary">{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}{t('ui.checkTools')}</button>
            </details>
          </section>}
          {step === 1 && <section><h2 className="text-lg font-semibold">{t('ui.browserStep')}</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('ui.browserSetupHint')}</p>
            <button type="button" onClick={() => void installExtension()} disabled={busy} className="v-button-secondary mt-4"><Puzzle className="h-4 w-4" aria-hidden />{t('ui.installExtension')}</button>
            {extensionReady && <p className="mt-2 text-xs text-muted-foreground">{t('ui.extensionOpened')}</p>}
            <details className="v-disclosure mt-3"><summary><ChevronDown className="v-chevron h-3.5 w-3.5" aria-hidden />{t('ui.technicalDetails')}</summary><p className="py-2 text-xs leading-relaxed text-muted-foreground">{t('prefs.chromeCookie.extensionToLoad')}</p></details>
          </section>}
          {step === 2 && <section><h2 className="text-lg font-semibold">{t('ui.folderStep')}</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('ui.folderSetupHint')}</p>
            <div className="mt-4 flex items-center gap-2 rounded-button bg-control px-3 py-2"><Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /><span className="min-w-0 flex-1 truncate text-[13px]" title={destination}>{destination || t('ui.chooseFolder')}</span><button type="button" onClick={() => void chooseDestination()} className="v-button-ghost !px-2">{t('common.change')}</button></div>
          </section>}
          {step === 3 && <section><h2 className="text-lg font-semibold">{t('ui.proxyStep')}</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('ui.proxySetupHint')}</p>
            <details className="v-disclosure mt-4"><summary><ChevronDown className="v-chevron h-3.5 w-3.5" aria-hidden />{t('ui.proxySetup')}</summary>
              <label className="mt-2 block text-xs" htmlFor="onboarding-proxy">{t('prefs.saveFiles.proxyUrl')}</label><input id="onboarding-proxy" value={proxyUrl} onChange={(event) => setProxyUrl(event.target.value)} placeholder="http://127.0.0.1:8080" className="v-input mt-2" /><p className="mt-2 text-xs text-muted-foreground">{t('prefs.saveFiles.credentialsHint')}</p>
            </details>
          </section>}
          {note && <p className="mt-4 break-words text-xs leading-relaxed text-error" role="status">{note}</p>}
        </main>
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-divider-subtle px-5 py-4">
          <button type="button" onClick={() => step === 0 ? void skip() : setStep((current) => current - 1)} disabled={busy} className="v-button-ghost">{step > 0 && <ChevronLeft className="h-3.5 w-3.5" aria-hidden />}{t(step === 0 ? 'ui.skipSetup' : 'ui.back')}</button>
          <button type="button" onClick={() => void next()} disabled={busy} className="v-button-primary">{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{t(step === 3 ? 'ui.finish' : 'ui.continue')}{step < 3 && <ChevronRight className="h-3.5 w-3.5" aria-hidden />}</button>
        </footer>
      </DialogShell>
    </div>
  )
}
