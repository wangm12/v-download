import { createHash } from 'crypto'
import { isAbsolute } from 'path'
import {
  readDownloadSelection, readMediaSourceContext, mediaSourceReferer,
  type DownloadPlan, type DownloadSelection
} from '@v-download/shared'
import { validateOutputTemplate } from './outputTemplateModel'

export interface DownloadRequestSnapshot {
  version: 1
  entryIndex?: number
  selection: DownloadSelection
  plan?: Pick<DownloadPlan, 'id' | 'name' | 'revision'>
  outputDir: string
  filenameTemplate: string
  includeNote: boolean
  archiveByAuthor: boolean
  folderNameTemplate: string
  playlistSubfolder: boolean
}


export function readDownloadRequestSnapshot(value: unknown): DownloadRequestSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid saved download request')
  const v = value as DownloadRequestSnapshot
  if (v.version !== 1 || typeof v.outputDir !== 'string' || !isAbsolute(v.outputDir) ||
    typeof v.filenameTemplate !== 'string' || !validateOutputTemplate(v.filenameTemplate, 'filename').ok ||
    typeof v.includeNote !== 'boolean' || typeof v.archiveByAuthor !== 'boolean' ||
    typeof v.playlistSubfolder !== 'boolean' || typeof v.folderNameTemplate !== 'string') throw new Error('Invalid saved download output settings')
  if (v.entryIndex !== undefined && (!Number.isInteger(v.entryIndex) || v.entryIndex < 1)) throw new Error('Invalid collection entry index')
  if (v.plan && (typeof v.plan.id !== 'string' || typeof v.plan.name !== 'string' || !Number.isInteger(v.plan.revision) || v.plan.revision < 1)) throw new Error('Invalid saved download plan identity')
  return { version: 1, ...(v.entryIndex !== undefined ? { entryIndex: v.entryIndex } : {}), selection: readDownloadSelection(v.selection),
    ...(v.plan ? { plan: { id: v.plan.id, name: v.plan.name, revision: v.plan.revision } } : {}),
    outputDir: v.outputDir, filenameTemplate: v.filenameTemplate, includeNote: v.includeNote,
    archiveByAuthor: v.archiveByAuthor, folderNameTemplate: v.folderNameTemplate, playlistSubfolder: v.playlistSubfolder }
}
export function selectionKey(snapshot?: DownloadRequestSnapshot, sourceContext?: unknown): string | null {
  if (!snapshot && sourceContext === undefined) return null
  const { plan: _plan, ...intent } = snapshot ? readDownloadRequestSnapshot(snapshot) : { plan: undefined }
  if (sourceContext !== undefined) {
    const source = readMediaSourceContext(sourceContext)
    // Capture IDs/timestamps change between observations; document URLs and Referer
    // determine whether the same transport can safely reuse an existing task.
    return createHash('sha256').update(JSON.stringify({ version: 1, selection: snapshot ? intent : null,
      source: { pageUrl: source.pageUrl, documentUrl: source.documentUrl, referer: mediaSourceReferer(source) } })).digest('hex')
  }
  return createHash('sha256').update(JSON.stringify(intent)).digest('hex')
}
export function admissionIdentity(urlKey: string, key: string | null | undefined): string {
  return key ? `${urlKey}|selection:${key}` : urlKey
}
