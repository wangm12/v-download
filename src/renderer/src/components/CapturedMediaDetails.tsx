import { useEffect, useRef, useState } from 'react'
import type { MediaCaptureCommand, MediaInspection } from '@v-download/shared'
import { useTranslation } from 'react-i18next'
import type { Download } from '@/types'

export function CapturedMediaDetails({ download }: { download: Download }) {
  const { t } = useTranslation()
  const [inspection, setInspection] = useState<MediaInspection | null>(null)
  const [busy, setBusy] = useState(false)
  const [capture, setCapture] = useState<MediaCaptureCommand | null>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const [sourcePage, setSourcePage] = useState(download.sourceContext?.pageUrl || download.url)
  const generation = useRef(0)
  useEffect(() => () => { generation.current++; void window.api.cancelMediaInspection(download.id) }, [download.id])
  useEffect(() => { generation.current++; setInspection(null); setBusy(false); void window.api.cancelMediaInspection(download.id) }, [download.id, download.mediaUrl])
  const inactive = ['error', 'paused', 'interrupted', 'cancelled'].includes(download.status)
  const inspect = async () => {
    const token = ++generation.current
    setBusy(true); setError('')
    try {
      const result = await window.api.inspectDownloadMedia(download.id)
      if (token !== generation.current) return
      if (result.data) setInspection(result.data)
      else setError(result.error || t('capture.failed'))
    } catch { if (token === generation.current) setError(t('capture.failed')) }
    finally { if (token === generation.current) setBusy(false) }
  }
  const begin = async () => {
    setOpening(true); setError('')
    try {
      const result = await window.api.beginMediaCapture(download.id, sourcePage)
      if (result.data) setCapture(result.data)
      else setError(result.error || t('capture.failed'))
    } catch { setError(t('capture.failed')) }
    finally { setOpening(false) }
  }
  return <section className="space-y-2 border-t border-divider-subtle pt-2" aria-label={t('capture.details')}>
    <p className="text-xs font-medium">{t('capture.details')}</p>
    {download.sourceContext && <p className="break-all text-xs text-muted-foreground">{t('capture.page')}: {download.sourceContext.documentUrl || download.sourceContext.pageUrl}</p>}
    {download.mediaUrl && <details className="v-disclosure"><summary>{t('capture.mediaUrl')}</summary><p className="select-text break-all text-xs text-muted-foreground">{download.mediaUrl}</p></details>}
    {download.recaptureAt && <p className="text-xs text-muted-foreground">{t('capture.restarted')}</p>}
    <button type="button" className="v-button-secondary w-full" disabled={busy} onClick={() => void inspect()}>{busy ? t('capture.inspecting') : t('capture.inspect')}</button>
    {busy && <button type="button" className="v-button-secondary w-full" onClick={() => { generation.current++; setBusy(false); void window.api.cancelMediaInspection(download.id) }}>{t('capture.cancel')}</button>}
    {inspection && <div className="space-y-1 break-words text-xs text-muted-foreground" role="status">
      <p>{inspection.kind}{inspection.duration ? ` · ${inspection.duration.toFixed(1)}s` : ''}</p>
      {inspection.streams.map((s) => <p key={s.index}>{s.kind} · {s.codec || t('capture.unknown')}{s.height ? ` · ${s.width || '?'}×${s.height}` : ''}{s.fps ? ` · ${s.fps.toFixed(2)} fps` : ''}{s.language ? ` · ${s.language}` : ''}</p>)}
      {!inspection.streams.length && <p>{t('capture.unknown')}</p>}
      {inspection.resources.length > 0 && <p>{t('capture.linked', { count: inspection.resources.length })}</p>}
      {inspection.resources.length > 0 && <details className="v-disclosure"><summary>{t('capture.relationships')}</summary>{inspection.resources.map((resource, i) => <p key={i} className="select-text break-all">{resource.relation}{resource.height ? ` · ${resource.height}p` : ''}{resource.language ? ` · ${resource.language}` : ''}: {resource.url}</p>)}</details>}
      {inspection.warnings.map((warning, i) => <p key={i}>{warning}</p>)}
      <p>{t('capture.pointInTime')}</p>
    </div>}
    {inactive && <>
      <details className="v-disclosure"><summary>{t('capture.sourcePage')}</summary><label htmlFor={`capture-page-${download.id}`} className="sr-only">{t('capture.sourcePage')}</label><input id={`capture-page-${download.id}`} type="url" className="v-input my-2 w-full" value={sourcePage} onChange={(event) => setSourcePage(event.target.value)} /><p className="mb-2 text-xs text-muted-foreground">{t('capture.sourcePageHint')}</p></details>
      <button type="button" className="v-button-secondary w-full" disabled={opening} onClick={() => void begin()}>{opening ? t('capture.opening') : t('capture.begin')}</button>
      <p className="text-xs text-muted-foreground">{t('capture.keep')}</p>
      {capture && <div className="space-y-2" role="status"><p className="text-xs text-muted-foreground">{t('capture.instructions')}</p><button type="button" className="v-button-secondary w-full" onClick={() => { void window.api.cancelMediaCapture(download.id); setCapture(null) }}>{t('capture.cancel')}</button></div>}
    </>}
    {error && <p role="alert" className="break-words text-xs text-danger">{error}</p>}
  </section>
}
