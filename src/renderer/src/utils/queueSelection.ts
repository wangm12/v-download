import type { Download, Playlist } from '../types'
import { COLLECTION_VISIBLE_LIMIT } from '../components/playlistGroupPresentation'

export interface PlaylistViewState {
  expanded: boolean
  showAll: boolean
}

export type PlaylistViewStateMap = Readonly<Record<string, PlaylistViewState>>

const PLAYLIST_SELECTION_PREFIX = 'playlist:'

export function getPlaylistSelectionId(playlistId: string): string {
  return `${PLAYLIST_SELECTION_PREFIX}${playlistId}`
}

export function getPlaylistIdFromSelectionId(selectionId: string): string | null {
  return selectionId.startsWith(PLAYLIST_SELECTION_PREFIX)
    ? selectionId.slice(PLAYLIST_SELECTION_PREFIX.length)
    : null
}

export function defaultPlaylistViewState(downloadCount: number): PlaylistViewState {
  return {
    expanded: downloadCount <= COLLECTION_VISIBLE_LIMIT,
    showAll: false
  }
}

export function resolvePlaylistViewState(
  playlist: Playlist,
  states: PlaylistViewStateMap
): PlaylistViewState {
  return states[playlist.id] ?? defaultPlaylistViewState(playlist.downloads?.length ?? 0)
}

/** Returns queue download IDs in logical order, excluding collapsed/hidden playlist children. */
export function getVisibleQueueDownloadIds(
  items: readonly (Download | Playlist)[],
  states: PlaylistViewStateMap
): string[] {
  const ids: string[] = []
  for (const item of items) {
    if ('downloads' in item && Array.isArray(item.downloads)) {
      const viewState = resolvePlaylistViewState(item, states)
      if (!viewState.expanded) continue
      const downloads = viewState.showAll
        ? item.downloads
        : item.downloads.slice(0, COLLECTION_VISIBLE_LIMIT)
      ids.push(...downloads.map((download) => download.id))
      continue
    }
    ids.push(item.id)
  }
  return ids
}

/**
 * Returns the selectable queue items in logical order. A playlist is a
 * selectable item in its own right; expanded children follow it in order.
 */
export function getVisibleQueueSelectionIds(
  items: readonly (Download | Playlist)[],
  states: PlaylistViewStateMap
): string[] {
  const ids: string[] = []
  for (const item of items) {
    if ('downloads' in item && Array.isArray(item.downloads)) {
      ids.push(getPlaylistSelectionId(item.id))
      const viewState = resolvePlaylistViewState(item, states)
      if (!viewState.expanded) continue
      const downloads = viewState.showAll
        ? item.downloads
        : item.downloads.slice(0, COLLECTION_VISIBLE_LIMIT)
      ids.push(...downloads.map((download) => download.id))
      continue
    }
    ids.push(item.id)
  }
  return ids
}

/** Expands queue-level selections into the task IDs accepted by download IPC. */
export function expandQueueSelectionToDownloadIds(
  selectedIds: ReadonlySet<string>,
  items: readonly (Download | Playlist)[]
): string[] {
  const playlistDownloads = new Map<string, string[]>()
  const downloadIds = new Set<string>()
  for (const item of items) {
    if ('downloads' in item && Array.isArray(item.downloads)) {
      playlistDownloads.set(item.id, item.downloads.map((download) => download.id))
    } else {
      downloadIds.add(item.id)
    }
  }

  const expanded = new Set<string>()
  for (const selectionId of selectedIds) {
    const playlistId = getPlaylistIdFromSelectionId(selectionId)
    if (playlistId) {
      for (const id of playlistDownloads.get(playlistId) ?? []) expanded.add(id)
    } else if (downloadIds.has(selectionId)) {
      expanded.add(selectionId)
    } else {
      // A playlist child may be hidden by the current preview state but is
      // still a valid task selection until the queue prunes it.
      for (const ids of playlistDownloads.values()) {
        if (ids.includes(selectionId)) expanded.add(selectionId)
      }
    }
  }
  return Array.from(expanded)
}
