import { join } from 'path'
import { sanitizeDownloadBasename } from './sanitizeDownloadBasename'

export const DEFAULT_FILENAME_TEMPLATE = '{title} [{id}]'
export const DEFAULT_FOLDER_NAME_TEMPLATE = '{author}'

export const FILENAME_TOKENS = ['title', 'id', 'author', 'date', 'time', 'site', 'ext'] as const
export const FOLDER_TOKENS = ['title', 'id', 'author', 'date', 'time', 'site'] as const

export type FilenameToken = (typeof FILENAME_TOKENS)[number]
export type FolderToken = (typeof FOLDER_TOKENS)[number]
export type TemplateKind = 'filename' | 'folder'

export type ValidateTemplateResult = { ok: true } | { ok: false; error: string }

export interface TemplateValues {
  title?: string
  id?: string
  author?: string
  date?: string
  time?: string
  site?: string
  ext?: string
  now?: Date
}

export interface ComposeDownloadOutputDirOptions {
  downloadDir: string
  archiveByAuthor: boolean
  folderNameTemplate: string
  playlistSubfolder: boolean
  playlistFolder?: string | null
  remoteOutputDir?: string | null
  skipPlaylistFolder?: boolean
  values: TemplateValues
}

export interface ResolveWriterOutputNameOptions {
  filenameTemplate: string
  title: string
  id?: string
  author?: string
  date?: string
  time?: string
  site?: string
  ext: string
  now?: Date
}

const FILENAME_TOKEN_SET = new Set<string>(FILENAME_TOKENS)
const FOLDER_TOKEN_SET = new Set<string>(FOLDER_TOKENS)
const TOKEN_RE = /\{([^{}]*)\}/g
const ILLEGAL_PATH_CHARS = /[/\\?*:|"<>]/g

const YTDLP_TOKEN: Record<string, string> = {
  title: '%(title).200B',
  id: '%(id)s',
  author: '%(uploader)s',
  date: '%(upload_date>%Y-%m-%d)s',
  ext: '%(ext)s'
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function localDateString(now = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

export function localTimeString(now = new Date()): string {
  return `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
}

export function siteLabelFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
    if (host.includes('youtu')) return 'youtube'
    if (host.includes('douyin') || host.includes('iesdouyin')) return 'douyin'
    if (host.includes('xiaohongshu') || host.includes('xhslink')) return 'xiaohongshu'
    if (host.includes('tiktok')) return 'tiktok'
    if (host.includes('bilibili')) return 'bilibili'
    const first = host.split('.')[0]
    return first || host
  } catch {
    return ''
  }
}

function sanitizePathSegment(value: string): string {
  return value
    .replace(/\r\n?|\n|\t/g, ' ')
    .replace(ILLEGAL_PATH_CHARS, '-')
    .replace(/^\.+$/, '-')
    .replace(/ +/g, ' ')
    .trim()
}

function hasParentPathSegment(template: string): boolean {
  return template.replace(/\\/g, '/').split('/').some((segment) => segment === '..')
}

function filenameTemplateSegments(template: string): string[] {
  return template.replace(/\\/g, '/').split('/')
}

export function validateOutputTemplate(template: string, kind: TemplateKind): ValidateTemplateResult {
  if (typeof template !== 'string') return { ok: false, error: 'Unknown token' }
  if (template.length > 4096) return { ok: false, error: 'Template is too long' }
  if (/%\(/.test(template)) return { ok: false, error: 'Raw %( interpolation is not allowed' }
  if (hasParentPathSegment(template)) return { ok: false, error: 'Parent path segments (..) are not allowed' }
  if (kind === 'filename' && template.trim() === '') return { ok: false, error: 'Filename template is required' }

  const allowed = kind === 'folder' ? FOLDER_TOKEN_SET : FILENAME_TOKEN_SET
  TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN_RE.exec(template))) {
    const token = match[1]
    if (!allowed.has(token)) {
      if (kind === 'folder' && token === 'ext') {
        return { ok: false, error: 'Unknown token {ext}' }
      }
      return { ok: false, error: `Unknown token {${token}}` }
    }
  }
  if (/\{[^{}]*$/.test(template) || /\{[^{}]*\{/.test(template)) {
    return { ok: false, error: 'Unknown token' }
  }
  return { ok: true }
}

function replaceTokens(
  template: string,
  lookup: (token: string) => string
): string {
  return template.replace(TOKEN_RE, (_all, token: string) => lookup(token))
}

export function renderYtdlpFilenameTemplate(template: string): string {
  const now = new Date()
  const rendered = filenameTemplateSegments(template)
    .map((segment) =>
      replaceTokens(segment, (token) => {
        if (token === 'time') return localTimeString(now)
        if (token === 'site') return '%(extractor)s'
        if (token in YTDLP_TOKEN) return YTDLP_TOKEN[token as keyof typeof YTDLP_TOKEN]
        return ''
      })
    )
    .filter((segment) => segment.length > 0)
    .join('/')
  if (/%\(ext\)s$/.test(rendered) || template.includes('{ext}')) {
    return rendered
  }
  return `${rendered}.%(ext)s`
}

function concreteTokenValue(token: string, values: TemplateValues, titleMaxLen: number): string {
  const now = values.now ?? new Date()
  if (token === 'title') return sanitizeDownloadBasename(values.title ?? '', titleMaxLen)
  if (token === 'id') return sanitizePathSegment(values.id ?? '')
  if (token === 'author') return sanitizePathSegment(values.author ?? '')
  if (token === 'date') return sanitizePathSegment(values.date || localDateString(now))
  if (token === 'time') return sanitizePathSegment(values.time || localTimeString(now))
  if (token === 'site') return sanitizePathSegment(values.site ?? '')
  if (token === 'ext') return sanitizePathSegment((values.ext ?? '').replace(/^\./, ''))
  return ''
}

export function renderConcreteBasename(template: string, values: TemplateValues): string {
  const segments = filenameTemplateSegments(template)
    .map((segment) => {
      const rendered = replaceTokens(segment, (token) => concreteTokenValue(token, values, 100))
      return sanitizePathSegment(rendered).replace(/[.]{2,}/g, '.')
    })
    .filter((segment) => segment.length > 0)
  return segments.join('/') || 'video'
}

export function renderConcreteFolderSegment(template: string, values: TemplateValues): string {
  const rendered = replaceTokens(template, (token) => concreteTokenValue(token, values, 80))
  return sanitizePathSegment(rendered)
}

export function composeDownloadOutputDir(options: ComposeDownloadOutputDirOptions): string {
  const remote = options.remoteOutputDir?.trim()
  if (remote) return remote

  const parts = [options.downloadDir]
  if (options.archiveByAuthor) {
    const folder = renderConcreteFolderSegment(options.folderNameTemplate || DEFAULT_FOLDER_NAME_TEMPLATE, options.values)
    if (folder) parts.push(folder)
  }
  const skipPlaylist = options.skipPlaylistFolder || Boolean(remote)
  if (options.playlistSubfolder && !skipPlaylist && options.playlistFolder) {
    const playlist = sanitizePathSegment(options.playlistFolder)
    if (playlist) parts.push(playlist)
  }
  return join(...parts)
}

export function resolveWriterOutputName(options: ResolveWriterOutputNameOptions): string {
  const ext = options.ext.replace(/^\./, '')
  const values: TemplateValues = {
    title: options.title,
    id: options.id,
    author: options.author,
    date: options.date,
    time: options.time,
    site: options.site,
    ext,
    now: options.now
  }
  const base = renderConcreteBasename(options.filenameTemplate || DEFAULT_FILENAME_TEMPLATE, values)
  if (options.filenameTemplate.includes('{ext}')) return base
  return `${base}.${ext}`
}

export function normalizeFilenameTemplate(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  return validateOutputTemplate(raw, 'filename').ok ? raw : DEFAULT_FILENAME_TEMPLATE
}

export function normalizeFolderNameTemplate(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  return validateOutputTemplate(raw, 'folder').ok ? raw : DEFAULT_FOLDER_NAME_TEMPLATE
}
