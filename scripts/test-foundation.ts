import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { test } from 'node:test'
import { CURRENT_SCHEMA_VERSION, migrateDatabase } from '../src/main/databaseMigrations'

test('database migrations upgrade legacy downloads and remain idempotent', () => {
  const database = new Database(':memory:')
  database.exec(`
    CREATE TABLE downloads (
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
    INSERT INTO downloads (id, url, title, format, quality, status, created_at, updated_at)
    VALUES ('legacy-1', 'https://example.com/video', 'Legacy', 'mp4', 'best', 'queued', '2026-01-01', '2026-01-01');
  `)

  migrateDatabase(database)
  migrateDatabase(database)

  const columns = database.prepare('PRAGMA table_info(downloads)').all() as { name: string }[]
  assert.ok(columns.some(({ name }) => name === 'extras'))
  assert.ok(columns.some(({ name }) => name === 'error_code'))
  assert.deepEqual(database.prepare('SELECT version FROM schema_migrations ORDER BY version').all(), [
    { version: 1 },
    { version: 2 },
    { version: 3 },
  ])
  assert.equal(
    (database.prepare('SELECT title FROM downloads WHERE id = ?').get('legacy-1') as { title: string }).title,
    'Legacy'
  )
  assert.equal(
    (database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version,
    CURRENT_SCHEMA_VERSION
  )
  database.close()
})
