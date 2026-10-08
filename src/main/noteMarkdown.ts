import { closeSync, fstatSync, lstatSync, openSync, unlinkSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import { sanitizeDownloadBasename } from './sanitizeDownloadBasename'

export interface NoteFileWriteResult {
  path: string
  identity: { dev: string; ino: string; size: string; birthtimeNs?: string }
}

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

export function shouldWriteNote(metadata?: Record<string, unknown>): boolean {
  return metadata?.includeNote === true
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

export function writeNoteMarkdownFile(path: string, fields: NoteFields): NoteFileWriteResult {
  const content = renderNoteMarkdown(fields)
  const ext = extname(path) || '.md'
  const stem = extname(path) ? basename(path, ext) : basename(path)
  const directory = dirname(path)

  for (let suffix = 0; suffix < 1000; suffix++) {
    const candidate = suffix === 0 ? path : join(directory, `${stem} (${suffix})${ext}`)
    let fd: number
    try {
      fd = openSync(candidate, 'wx', 0o666)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }

    let identity: NoteFileWriteResult['identity'] | null = null
    try {
      writeFileSync(fd, content, 'utf8')
      const st = fstatSync(fd, { bigint: true })
      identity = {
        dev: st.dev.toString(),
        ino: st.ino.toString(),
        size: st.size.toString(),
        ...(st.birthtimeNs > 0n ? { birthtimeNs: st.birthtimeNs.toString() } : {}),
      }
    } catch (error) {
      try {
        const st = fstatSync(fd, { bigint: true })
        identity = { dev: st.dev.toString(), ino: st.ino.toString(), size: st.size.toString() }
      } catch {
        /* The file descriptor may already be invalid. */
      }
      closeSync(fd)
      if (identity) {
        try {
          const current = lstatSync(candidate, { bigint: true })
          if (!current.isSymbolicLink() && current.dev.toString() === identity.dev && current.ino.toString() === identity.ino) {
            unlinkSync(candidate)
          }
        } catch {
          /* Preserve any replacement path. */
        }
      }
      throw error
    }
    closeSync(fd)
    if (!identity) throw new Error('Could not read the identity of the newly created note file')
    return { path: candidate, identity }
  }

  throw new Error('Could not create a unique note file without replacing an existing file')
}
