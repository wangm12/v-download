import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

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
  error: string | null
  created_at: string
  updated_at: string
}

export function initDB(): void {
  if (db) return

  db = new Database(DB_PATH)

  db.exec(`
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
  `)
}

export function insertDownload(record: Omit<DownloadRecord, 'created_at' | 'updated_at'>): void {
  if (!db) throw new Error('Database not initialized')
  const now = new Date().toISOString()
  const stmt = db.prepare(`
    INSERT INTO downloads (id, url, title, format, quality, status, progress, file_path, file_size, thumbnail, duration, channel, playlist_id, playlist_index, error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    record.error ?? null,
    now,
    now
  )
}

export function updateDownload(
  id: string,
  updates: Partial<Pick<DownloadRecord, 'status' | 'progress' | 'file_path' | 'file_size' | 'error' | 'title' | 'thumbnail' | 'duration'>>
): void {
  if (!db) throw new Error('Database not initialized')
  const now = new Date().toISOString()
  const fields: string[] = ['updated_at = ?']
  const values: (string | number | null)[] = [now]

  if (updates.status !== undefined) {
    fields.push('status = ?')
    values.push(updates.status)
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

  values.push(id)
  const stmt = db.prepare(`UPDATE downloads SET ${fields.join(', ')} WHERE id = ?`)
  stmt.run(...values)
}

export function getDownloads(): DownloadRecord[] {
  if (!db) throw new Error('Database not initialized')
  const stmt = db.prepare('SELECT * FROM downloads ORDER BY created_at DESC')
  return stmt.all() as DownloadRecord[]
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
