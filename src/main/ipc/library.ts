import { unlinkSync } from 'node:fs'
import { ipcMain } from 'electron'
import * as db from '../database'
import * as settings from '../settings'
import {
  mergeLibraryCatalog,
  planLibraryDelete,
  queryLibraryFiles,
  queryLibraryWorks,
  type LibraryListQuery
} from '../libraryModel'
import { resetLibraryScanCache, scanLibraryDisk } from '../libraryScan'

function parseListQuery(raw: unknown): LibraryListQuery & { forceRefresh?: boolean } {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const mediaType = input.mediaType
  const sortBy = input.sortBy
  const sortDir = input.sortDir
  return {
    offset: typeof input.offset === 'number' ? input.offset : undefined,
    limit: typeof input.limit === 'number' ? input.limit : undefined,
    query: typeof input.query === 'string' ? input.query : undefined,
    mediaType: mediaType === 'video' || mediaType === 'image' || mediaType === 'audio' || mediaType === 'all'
      ? mediaType
      : undefined,
    sortBy: sortBy === 'size' || sortBy === 'date' ? sortBy : undefined,
    sortDir: sortDir === 'asc' || sortDir === 'desc' ? sortDir : undefined,
    forceRefresh: input.forceRefresh === true
  }
}

function catalog(forceRefresh?: boolean) {
  const downloadDir = settings.get('downloadDir')
  const diskFiles = scanLibraryDisk(downloadDir, { forceRefresh })
  const items = mergeLibraryCatalog({
    downloadDir,
    rows: db.getDownloads(),
    diskFiles
  })
  return { downloadDir, items }
}

export function registerLibraryHandlers(): void {
  ipcMain.handle('library-list-files', async (_event, raw: unknown) => {
    try {
      const query = parseListQuery(raw)
      const { items } = catalog(query.forceRefresh)
      return { data: queryLibraryFiles(items, query) }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('library-list-works', async (_event, raw: unknown) => {
    try {
      const query = parseListQuery(raw)
      const { items } = catalog(query.forceRefresh)
      return { data: queryLibraryWorks(items, query) }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('library-delete-paths', async (_event, raw: unknown) => {
    try {
      const input = Array.isArray(raw)
        ? { paths: raw, recordIds: [] as string[] }
        : raw && typeof raw === 'object'
          ? raw as { paths?: unknown; recordIds?: unknown }
          : {}
      const paths = Array.isArray(input.paths) ? input.paths.filter((path): path is string => typeof path === 'string') : []
      const recordIds = Array.isArray(input.recordIds) ? input.recordIds.filter((id): id is string => typeof id === 'string') : []
      const planned = planLibraryDelete({
        downloadDir: settings.get('downloadDir'),
        paths,
        recordIds,
        rows: db.getDownloads()
      })
      if (!planned.ok) return { error: planned.error }
      for (const path of planned.unlinkPaths) {
        try {
          unlinkSync(path)
        } catch {
          /* missing file is fine; row drop still happens */
        }
      }
      for (const id of planned.deleteIds) {
        db.deleteDownload(id)
      }
      resetLibraryScanCache()
      return { ok: true, deleted: planned.unlinkPaths.length, removed: planned.deleteIds.length }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
}
