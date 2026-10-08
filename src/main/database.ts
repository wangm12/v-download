import Database from 'better-sqlite3'
import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'path'
import { migrateDatabase } from './databaseMigrations'

let db: Database.Database | null = null

const DB_PATH = join(app.getPath('userData'), 'downloads.db')

export interface DownloadRecord {
  id: string
  url: string
  title: string
  format: string
  quality: string
  status: string
  progress: number
  file_path: string | null
  file_size: number | null
  thumbnail: string | null
  duration: number | null
  channel: string | null
  playlist_id: string | null
  playlist_index: number | null
  /** JSON blob: nativeYoutubePlaylist, douyinImageUrls, etc. */
  extras: string | null
  error: string | null
  error_code?: string | null
  created_at: string
  updated_at: string
}

export interface DownloadAdmissionRecord {
  id: string
  url: string
  status: string
  file_path: string | null
  created_at: string
}

export function initDB(): void {
  if (db) return

  try {
    mkdirSync(dirname(DB_PATH), { recursive: true })
  } catch {
    /* ignore if already exists */
  }

  db = new Database(DB_PATH)

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS downloads (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      format TEXT NOT NULL,
      quality TEXT NOT NULL,
      status TEXT NOT NULL,
      progress REAL DEFAULT 0,
      file_path TEXT,
      file_size INTEGER,
      thumbnail TEXT,
      duration INTEGER,
      channel TEXT,
      playlist_id TEXT,
      playlist_index INTEGER,
      error TEXT,
      error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      total_count INTEGER DEFAULT 0,
      completed_count INTEGER DEFAULT 0,
      output_dir TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
    CREATE INDEX IF NOT EXISTS idx_downloads_playlist_id ON downloads(playlist_id);
    CREATE INDEX IF NOT EXISTS idx_downloads_completed_file_path
      ON downloads(file_path) WHERE status = 'complete';
  `)

  migrateDatabase(db)
}

export function insertDownload(record: Omit<DownloadRecord, 'created_at' | 'updated_at'>): void {
  if (!db) throw new Error('Database not initialized')
  const now = new Date().toISOString()
  insertDownloadWithTimestamp(record, now)
}

function insertDownloadWithTimestamp(
  record: Omit<DownloadRecord, 'created_at' | 'updated_at'>,
  createdAt: string
): void {
  if (!db) throw new Error('Database not initialized')
  const stmt = db.prepare(`
    INSERT INTO downloads (id, url, title, format, quality, status, progress, file_path, file_size, thumbnail, duration, channel, playlist_id, playlist_index, extras, error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(
    record.id,
    record.url,
    record.title,
    record.format,
    record.quality,
    record.status,
    record.progress ?? 0,
    record.file_path ?? null,
    record.file_size ?? null,
    record.thumbnail ?? null,
    record.duration ?? null,
    record.channel ?? null,
    record.playlist_id ?? null,
    record.playlist_index ?? null,
    record.extras ?? null,
    record.error ?? null,
    createdAt,
    createdAt
  )
}

/** Batch insert preserving enqueue order (created_at ticks forward per row). */
export function insertDownloadsBulk(records: Array<Omit<DownloadRecord, 'created_at' | 'updated_at'>>): void {
  if (!db) throw new Error('Database not initialized')
  if (records.length === 0) return
  const baseMs = Date.now()
  const tx = db.transaction((rows: typeof records) => {
    for (let i = 0; i < rows.length; i++) {
      const createdAt = new Date(baseMs + i).toISOString()
      insertDownloadWithTimestamp(rows[i]!, createdAt)
    }
  })
  tx(records)
}

export function updateDownload(
  id: string,
  updates: Partial<
    Pick<DownloadRecord, 'url' | 'title' | 'format' | 'quality' | 'status' | 'progress' | 'file_path' | 'file_size' | 'error' | 'error_code' | 'thumbnail' | 'duration' | 'channel' | 'extras'>
  >
): void {
  if (!db) throw new Error('Database not initialized')
  const now = new Date().toISOString()
  const fields: string[] = ['updated_at = ?']
  const values: (string | number | null)[] = [now]

  if (updates.status !== undefined) {
    fields.push('status = ?')
    values.push(updates.status)
  }
  if (updates.url !== undefined) {
    fields.push('url = ?')
    values.push(updates.url)
  }
  if (updates.format !== undefined) {
    fields.push('format = ?')
    values.push(updates.format)
  }
  if (updates.quality !== undefined) {
    fields.push('quality = ?')
    values.push(updates.quality)
  }
  if (updates.progress !== undefined) {
    fields.push('progress = ?')
    values.push(updates.progress)
  }
  if (updates.file_path !== undefined) {
    fields.push('file_path = ?')
    values.push(updates.file_path)
  }
  if (updates.file_size !== undefined) {
    fields.push('file_size = ?')
    values.push(updates.file_size)
  }
  if (updates.error !== undefined) {
    fields.push('error = ?')
    values.push(updates.error)
  }
  if (updates.error_code !== undefined) {
    fields.push('error_code = ?')
    values.push(updates.error_code)
  }
  if (updates.title !== undefined) {
    fields.push('title = ?')
    values.push(updates.title)
  }
  if (updates.thumbnail !== undefined) {
    fields.push('thumbnail = ?')
    values.push(updates.thumbnail)
  }
  if (updates.duration !== undefined) {
    fields.push('duration = ?')
    values.push(updates.duration)
  }
  if (updates.channel !== undefined) {
    fields.push('channel = ?')
    values.push(updates.channel)
  }
  if (updates.extras !== undefined) {
    fields.push('extras = ?')
    values.push(updates.extras)
  }

  values.push(id)
  const stmt = db.prepare(`UPDATE downloads SET ${fields.join(', ')} WHERE id = ?`)
  stmt.run(...values)
}

export function getDownloads(): DownloadRecord[] {
  if (!db) throw new Error('Database not initialized')
  const stmt = db.prepare('SELECT * FROM downloads ORDER BY created_at DESC')
  return stmt.all() as DownloadRecord[]
}

/** Read one queue row without materializing the full history. */
export function getDownload(id: string): DownloadRecord | undefined {
  if (!db) throw new Error('Database not initialized')
  return db.prepare('SELECT * FROM downloads WHERE id = ?').get(id) as DownloadRecord | undefined
}

/** Exact indexed lookup for a completed output path without loading download history. */
export function getCompletedDownloadByFilePath(filePath: string): DownloadRecord | undefined {
  if (!db) throw new Error('Database not initialized')
  return db.prepare(`
    SELECT * FROM downloads
    WHERE status = 'complete' AND file_path = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(filePath) as DownloadRecord | undefined
}

/** Read a bounded set of queue rows without loading historical downloads. */
export function getDownloadsByIds(ids: readonly string[]): DownloadRecord[] {
  if (!db) throw new Error('Database not initialized')
  const uniqueIds = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))]
  if (uniqueIds.length === 0) return []

  const byId = new Map<string, DownloadRecord>()
  const chunkSize = 500
  for (let offset = 0; offset < uniqueIds.length; offset += chunkSize) {
    const chunk = uniqueIds.slice(offset, offset + chunkSize)
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db.prepare(`SELECT * FROM downloads WHERE id IN (${placeholders})`).all(...chunk) as DownloadRecord[]
    for (const row of rows) byId.set(row.id, row)
  }
  return uniqueIds.flatMap((id) => {
    const row = byId.get(id)
    return row ? [row] : []
  })
}

/** Queue scheduling only needs active rows; completed history is intentionally excluded. */
export function getDownloadsByStatus(...statuses: string[]): DownloadRecord[] {
  if (!db) throw new Error('Database not initialized')
  const values = [...new Set(statuses.filter(Boolean))]
  if (values.length === 0) return []
  const placeholders = values.map(() => '?').join(', ')
  return db.prepare(`SELECT * FROM downloads WHERE status IN (${placeholders}) ORDER BY created_at ASC`).all(...values) as DownloadRecord[]
}

/** Small projection used to preserve URL de-duplication without loading large extras blobs. */
export function getDownloadAdmissionCandidates(): DownloadAdmissionRecord[] {
  if (!db) throw new Error('Database not initialized')
  return db.prepare(`
    SELECT id, url, status, file_path, created_at
    FROM downloads
    ORDER BY created_at DESC
  `).all() as DownloadAdmissionRecord[]
}

export interface DownloadProgressSummary {
  total: number
  progress: number
  active: number
}

/** Aggregate dock progress in SQLite instead of copying every historical row on each refresh. */
export function getDownloadProgressSummary(): DownloadProgressSummary {
  if (!db) throw new Error('Database not initialized')
  return db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'complete' THEN 100 ELSE progress END), 0) AS progress,
      COALESCE(SUM(CASE WHEN status IN ('downloading', 'queued') THEN 1 ELSE 0 END), 0) AS active
    FROM downloads
    WHERE status NOT IN ('resolving', 'ready')
  `).get() as DownloadProgressSummary
}

export function deleteDownload(id: string): void {
  if (!db) throw new Error('Database not initialized')
  const stmt = db.prepare('DELETE FROM downloads WHERE id = ?')
  stmt.run(id)
}

export function clearCompleted(): void {
  if (!db) throw new Error('Database not initialized')
  const stmt = db.prepare("DELETE FROM downloads WHERE status IN ('complete', 'error', 'cancelled', 'interrupted')")
  stmt.run()
}

export function clearAll(): void {
  if (!db) throw new Error('Database not initialized')
  const stmt = db.prepare('DELETE FROM downloads')
  stmt.run()
}

export function closeDB(): void {
  if (db) {
    db.close()
    db = null
  }
}
