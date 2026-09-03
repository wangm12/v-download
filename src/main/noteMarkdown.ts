import { writeFileSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import { sanitizeDownloadBasename } from './sanitizeDownloadBasename'

export interface NoteFields {
  title: string
  author: string
  url: string
  description: string
}

export function noteFieldsFromMetadata(
  metadata: Record<string, unknown> | undefined,
  fallback: { title?: string; url?: string; author?: string }
): NoteFields {
  const title =
    (typeof metadata?.noteTitle === 'string' && metadata.noteTitle) || fallback.title || ''
  const author =
    (typeof metadata?.noteAuthor === 'string' && metadata.noteAuthor) || fallback.author || ''
  const url = (typeof metadata?.noteUrl === 'string' && metadata.noteUrl) || fallback.url || ''
  const description = typeof metadata?.noteDescription === 'string' ? metadata.noteDescription : ''
  return { title, author, url, description }
}

export function hasNoteBody(fields: NoteFields): boolean {
  return Boolean(fields.title.trim() || fields.description.trim())
}

export function renderNoteMarkdown(fields: NoteFields): string {
  const heading = fields.title.trim() || 'Untitled'
  const lines = [`# ${heading}`, '']
  if (fields.author.trim()) lines.push(`- Author: ${fields.author.trim()}`)
  if (fields.url.trim()) lines.push(`- URL: ${fields.url.trim()}`)
  if (fields.author.trim() || fields.url.trim()) lines.push('')
  if (fields.description.trim()) {
    lines.push(fields.description.trim())
    lines.push('')
  }
  return lines.join('\n')
}

export function noteBasename(title: string): string {
  return title.trim() ? sanitizeDownloadBasename(title) : 'untitled'
}

export function noteFilePath(kind: 'gallery' | 'sidecar' | 'text', dest: string, title: string): string {
  if (kind === 'gallery') return join(dest, 'note.md')
  if (kind === 'text') return join(dest, `${noteBasename(title)}.md`)
  const ext = extname(dest)
  const stem = ext ? basename(dest, ext) : noteBasename(title)
  return join(dirname(dest), `${stem || noteBasename(title)}.md`)
}

export function writeNoteMarkdownFile(path: string, fields: NoteFields): void {
  writeFileSync(path, renderNoteMarkdown(fields), 'utf8')
}
