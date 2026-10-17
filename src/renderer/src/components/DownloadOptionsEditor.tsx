import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  allDownloadPlans, EMPTY_DOWNLOAD_PLAN_LIBRARY, reusableSelection,
  type DownloadPlanLibrary, type DownloadPlanMutation, type DownloadSelection
} from '@v-download/shared'
import type { SettingsData } from '@/types'
import { draftFromPlan, legacyDownloadDraft, initialDownloadDraft, type DownloadOptionsDraft } from './downloadOptionsModel'

export function DownloadOptionsEditor({ value, onChange, settings, showFolder = true, showNote = true }: {
  value: DownloadOptionsDraft; onChange: (value: DownloadOptionsDraft) => void; settings: SettingsData; showFolder?: boolean; showNote?: boolean
}) {
  const { t } = useTranslation()
  const [localLibrary, setLibrary] = useState<DownloadPlanLibrary | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const library = localLibrary ?? settings.downloadPlanLibrary ?? EMPTY_DOWNLOAD_PLAN_LIBRARY
  useEffect(() => setLibrary(null), [settings.downloadPlanLibrary])
  const plans = allDownloadPlans(library)
  const chosen = plans.find((p) => p.id === value.planId)
  const selectClass = 'v-input min-h-8 w-full rounded-md border border-border-strong bg-control px-2 py-1 text-[13px]'
  const change = (patch: Partial<DownloadSelection>) => onChange({ ...value, selection: { ...reusableSelection(value.selection), ...patch } })
  const mutate = async (mutation: DownloadPlanMutation, selectSaved = false) => {
    if (!window.api?.mutateDownloadPlan) return
    setBusy(true); setError('')
    try {
      const result = await window.api.mutateDownloadPlan(mutation)
      if (!result.data) throw new Error(result.error || t('plans.saveFailed'))
      setLibrary(result.data)
      if (selectSaved && mutation.action === 'save') {
        const saved = result.data.custom.find((p) => p.id === mutation.plan.id)
        if (saved) { onChange(draftFromPlan(saved, settings)); setName('') }
      }
      if (mutation.action === 'delete') onChange({ ...value, planId: undefined, planRevision: undefined })
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const save = (update: boolean) => {
    const current = update ? chosen : undefined
    const plan = { id: current?.id ?? crypto.randomUUID(), name: update ? name.trim() || current!.name : name.trim(), revision: current?.revision ?? 1,
      selection: reusableSelection(value.selection), outputDir: value.outputDir || undefined, filenameTemplate: value.filenameTemplate || undefined, includeNote: value.includeNote }
    void mutate({ action: 'save', plan, expectedRevision: current ? value.planRevision ?? current.revision : 0 }, true)
  }
  return <section className="space-y-3 py-3" aria-label={t('plans.title')}>
    <label className="block text-xs font-medium">{t('plans.title')}
      <select aria-label={t('plans.title')} value={value.planId ?? ''} disabled={busy} onChange={(e) => {
        const plan = plans.find((p) => p.id === e.target.value)
        onChange(plan ? draftFromPlan(plan, settings) : legacyDownloadDraft(settings)); setName(''); setError('')
      }} className={`${selectClass} mt-1`}>
        <option value="">{t('plans.custom')}</option>
        {value.planId && !chosen && <option value={value.planId}>{t('plans.unavailable')}</option>}
        {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.id.startsWith('builtin:') ? t(`plans.${plan.id.slice(8)}`) : plan.name}{library.defaultId === plan.id ? ` · ${t('plans.default')}` : ''}</option>)}
      </select>
    </label>
    <div className="grid grid-cols-2 gap-3">
      <label className="text-xs">{t('plans.media')}<select aria-label={t('plans.media')} className={`${selectClass} mt-1`} value={value.selection.target} onChange={(e) => change({ target: e.target.value as 'video' | 'audio', output: e.target.value === 'audio' ? 'mp3' : 'original', audioBitrate: e.target.value === 'audio' ? Number(settings.defaultAudioQuality) || undefined : undefined, postprocess: 'none' })}><option value="video">{t('format.video')}</option><option value="audio">{t('format.audio')}</option></select></label>
      <label className="text-xs">{t('plans.output')}<select aria-label={t('plans.output')} className={`${selectClass} mt-1`} value={value.selection.output} onChange={(e) => change({ output: e.target.value as DownloadSelection['output'], postprocess: 'none' })}>
        <option value="original">{t('plans.original')}</option>{(value.selection.target === 'video' ? ['mp4'] : ['mp3','m4a','opus']).map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
      </select></label>
    </div>
    {value.selection.target === 'video' ? <label className="block text-xs">{t('plans.height')}<select aria-label={t('plans.height')} className={`${selectClass} mt-1`} value={String(value.selection.maxHeight)} onChange={(e) => change({ maxHeight: e.target.value === 'best' ? 'best' : Number(e.target.value) })}>
      {[...new Set(['best','2160','1440','1080','720','480','360','240',String(value.selection.maxHeight)])].map((h) => <option key={h} value={h}>{h === 'best' ? t('plans.best') : `${h}p`}</option>)}
    </select></label> : value.selection.output !== 'original' && <label className="block text-xs">{t('plans.bitrate')}<select aria-label={t('plans.bitrate')} className={`${selectClass} mt-1`} value={value.selection.audioBitrate ?? ''} onChange={(e) => change({ audioBitrate: e.target.value ? Number(e.target.value) : undefined })}><option value="">{t('plans.vbr')}</option>{[128,192,256,320].map((b) => <option key={b} value={b}>{b} kbps</option>)}</select></label>}
    {value.selection.target === 'video' && value.selection.output === 'mp4' && <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" checked={value.selection.postprocess === 'h264-mp4'} disabled={value.selection.dynamicRange === 'hdr'} onChange={(e) => change({ postprocess: e.target.checked ? 'h264-mp4' : 'none' })} />{t('plans.convert')}</label>}
    {value.selection.exact && <p className="text-xs text-muted-foreground">{t('plans.exact')} <button type="button" className="underline" onClick={() => change({})}>{t('plans.unlock')}</button></p>}
    {showNote && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={value.includeNote} onChange={(e) => onChange({ ...value, includeNote: e.target.checked })} />{t('format.includeNote')}</label>}
    <details className="v-disclosure"><summary>{t('plans.advanced')}</summary><div className="space-y-3 py-3">
      {value.selection.target === 'video' && <div className="grid grid-cols-2 gap-3">
        <label className="text-xs">{t('plans.codec')}<select aria-label={t('plans.codec')} className={`${selectClass} mt-1`} value={value.selection.videoCodec} onChange={(e) => change({ videoCodec: e.target.value as DownloadSelection['videoCodec'] })}>{['any','h264','hevc','vp9','av1'].map((c) => <option key={c} value={c}>{c === 'any' ? t('plans.any') : c.toUpperCase()}</option>)}</select></label>
        <label className="text-xs">{t('plans.fps')}<select aria-label={t('plans.fps')} className={`${selectClass} mt-1`} value={value.selection.maxFps ?? ''} onChange={(e) => change({ maxFps: e.target.value ? Number(e.target.value) : undefined })}><option value="">{t('plans.any')}</option>{[24,25,30,50,60,120].map((f) => <option key={f} value={f}>{f} fps</option>)}</select></label>
        <label className="text-xs">HDR<select aria-label="HDR" className={`${selectClass} mt-1`} value={value.selection.dynamicRange} onChange={(e) => change({ dynamicRange: e.target.value as DownloadSelection['dynamicRange'] })}><option value="any">{t('plans.any')}</option><option value="sdr">SDR</option><option value="hdr" disabled={value.selection.postprocess === 'h264-mp4'}>HDR</option></select></label>
      </div>}
      <label className="block text-xs">{t('plans.language')}<select aria-label={t('plans.language')} className={`${selectClass} mt-1`} value={value.selection.audioLanguage ?? ''} onChange={(e) => change({ audioLanguage: e.target.value || undefined })}><option value="">{t('plans.any')}</option><option value="en">English</option><option value="zh">中文</option><option value="ja">日本語</option></select></label>
      {showFolder && <div className="text-xs"><span>{t('plans.folder')}</span><div className="mt-1 flex items-center gap-2"><span className="min-w-0 flex-1 truncate" title={value.outputDir}>{value.outputDir || t('plans.defaultFolder')}</span><button className="v-button-ghost" type="button" onClick={async () => { const folder = await window.api?.selectDownloadFolder(); if (folder) onChange({ ...value, outputDir: folder }) }}>{t('common.change')}</button></div></div>}
      <label className="block text-xs">{t('plans.filename')}<input aria-label={t('plans.filename')} className={`${selectClass} mt-1`} value={value.filenameTemplate} onChange={(e) => onChange({ ...value, filenameTemplate: e.target.value })} /></label>
      <p className="text-xs leading-5 text-muted-foreground">{t('plans.noFallback')}</p>
    </div></details>
    <details className="v-disclosure"><summary>{t('plans.save')}</summary><div className="space-y-2 pt-3">
      <div className="flex gap-2"><input aria-label={t('plans.name')} placeholder={t('plans.name')} value={name} onChange={(e) => setName(e.target.value)} className={`${selectClass} min-w-0 flex-1`} /><button type="button" disabled={!name.trim() || busy} className="v-button-secondary shrink-0" onClick={() => save(false)}>{t('plans.saveNew')}</button></div>
      <div className="flex flex-wrap gap-2">
        {chosen && !chosen.id.startsWith('builtin:') && <><button type="button" disabled={busy} className="v-button-ghost" onClick={() => save(true)}>{t('plans.update')}</button><button type="button" disabled={busy} className="v-button-ghost" onClick={() => void mutate({ action: 'delete', id: chosen.id, expectedRevision: value.planRevision ?? chosen.revision })}>{t('plans.delete')}</button></>}
        {chosen && <button type="button" disabled={busy} className="v-button-ghost" onClick={() => void mutate({ action: 'default', id: chosen.id })}>{t('plans.makeDefault')}</button>}
        {library.defaultId && <button type="button" disabled={busy} className="v-button-ghost" onClick={() => void mutate({ action: 'default', id: null })}>{t('plans.resetDefault')}</button>}
      </div><p className="text-xs leading-5 text-muted-foreground">{t('plans.snapshotHint')}</p>
    </div></details>
    {error && <p role="alert" className="text-xs text-error">{error}</p>}
  </section>
}
export function DownloadPlansPreferences({ settings }: { settings: SettingsData }) {
  const [draft, setDraft] = useState(() => initialDownloadDraft(settings))
  return <DownloadOptionsEditor value={draft} onChange={setDraft} settings={settings} />
}
