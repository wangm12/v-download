import type Database from 'better-sqlite3'

export const CURRENT_SCHEMA_VERSION = 3

/** Apply all database migrations exactly once, preserving existing rows. */
export function migrateDatabase(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)

  const migrations = database
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all() as { version: number }[]
  const applied = new Set(migrations.map(({ version }) => version))
  const migrate = database.transaction(() => {
    if (!applied.has(1)) {
      const columns = database.prepare('PRAGMA table_info(downloads)').all() as { name: string }[]
      if (!columns.some(({ name }) => name === 'extras')) {
        database.exec('ALTER TABLE downloads ADD COLUMN extras TEXT')
      }
      database
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(1, new Date().toISOString())
    }
    if (!applied.has(2)) {
      database
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(2, new Date().toISOString())
    }
    if (!applied.has(3)) {
      const columns = database.prepare('PRAGMA table_info(downloads)').all() as { name: string }[]
      if (!columns.some(({ name }) => name === 'error_code')) database.exec('ALTER TABLE downloads ADD COLUMN error_code TEXT')
      database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(3, new Date().toISOString())
    }
  })
  migrate()

  const current = database
    .prepare('SELECT MAX(version) AS version FROM schema_migrations')
    .get() as { version: number | null }
  if (current.version !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported database schema version: ${current.version ?? 0}`)
  }
}
