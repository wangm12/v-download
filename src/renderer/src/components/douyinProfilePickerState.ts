import type { DouyinProfilePostRow } from '@/types'
import { applySelectionClick, type SelectionModifiers, type SelectionState } from '../utils/selection'

export type ProfilePickerActivity = 'idle' | 'loading' | 'loading-page' | 'loading-all' | 'browser-import' | 'queueing' | 'error'

export function profilePickerStatus(activity: ProfilePickerActivity, hasMore: boolean, loadedCount: number): string {
  if (activity === 'loading') return 'Loading post list…'
  if (activity === 'loading-page') return 'Loading page…'
  if (activity === 'loading-all') return 'Loading all pages…'
  if (activity === 'browser-import') return 'Importing from browser…'
  if (activity === 'queueing') return 'Adding selected posts…'
  if (activity === 'error') return 'Could not load posts.'
  if (loadedCount === 0) return 'No posts loaded.'
  return hasMore ? `${loadedCount} posts loaded · More available` : `${loadedCount} posts loaded · No more posts available`
}

export function mergeProfilePosts(existing: DouyinProfilePostRow[], incoming: DouyinProfilePostRow[]) {
  const merged = new Map(existing.map((row) => [row.awemeId, row]))
  incoming.forEach((row) => merged.set(row.awemeId, row))
  return Array.from(merged.values())
}

export function selectedProfileCount(selected: Set<string>, posts: DouyinProfilePostRow[]) {
  return posts.reduce((count, post) => count + (selected.has(post.awemeId) ? 1 : 0), 0)
}

/** Profile pickers are bulk workflows: a plain click adds/removes instead of replacing the selection. */
export function applyProfilePickerClick(
  orderedIds: readonly string[],
  selected: ReadonlySet<string>,
  anchor: string | null,
  id: string,
  modifiers: SelectionModifiers = {}
): SelectionState<string> {
  if (modifiers.shiftKey) return applySelectionClick(orderedIds, selected, anchor, id, modifiers)
  return applySelectionClick(orderedIds, selected, anchor, id, { ...modifiers, ctrlKey: true })
}
