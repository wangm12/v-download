import assert from 'node:assert/strict'
import type { Download, Playlist } from '../src/renderer/src/types'
import {
  applySelectionClick,
  clearSelection,
  isDeleteSelectionShortcut,
  isFindShortcut,
  isRefreshShortcut,
  retainSelection,
  selectAllInOrder
} from '../src/renderer/src/utils/selection'
import {
  expandQueueSelectionToDownloadIds,
  getPlaylistIdFromSelectionId,
  getPlaylistSelectionId,
  getVisibleQueueDownloadIds,
  getVisibleQueueSelectionIds
} from '../src/renderer/src/utils/queueSelection'

function ids<T>(value: ReadonlySet<T>): T[] {
  return Array.from(value)
}

const ordered = ['a', 'b', 'c', 'd', 'e']

{
  const result = applySelectionClick(ordered, new Set(['a', 'c']), 'a', 'd')
  assert.deepEqual(ids(result.selected), ['d'])
  assert.equal(result.anchor, 'd')
}

{
  const result = applySelectionClick(ordered, new Set(['b']), 'b', 'b')
  assert.deepEqual(ids(result.selected), [])
  assert.equal(result.anchor, null)
}

{
  const result = applySelectionClick(ordered, new Set(['a']), 'a', 'c', { metaKey: true })
  assert.deepEqual(ids(result.selected), ['a', 'c'])
  const toggled = applySelectionClick(ordered, result.selected, result.anchor, 'a', { ctrlKey: true })
  assert.deepEqual(ids(toggled.selected), ['c'])
}

{
  const result = applySelectionClick(ordered, new Set(['a']), 'b', 'd', { shiftKey: true })
  assert.deepEqual(ids(result.selected), ['b', 'c', 'd'])
  assert.equal(result.anchor, 'b')
}

{
  const result = applySelectionClick(ordered, new Set(['a', 'e']), 'b', 'd', {
    shiftKey: true,
    metaKey: true
  })
  assert.deepEqual(ids(result.selected), ['a', 'e', 'b', 'c', 'd'])
}

{
  const result = applySelectionClick(ordered, new Set(['a']), null, 'c', { shiftKey: true })
  assert.deepEqual(ids(result.selected), ['c'])
  assert.equal(result.anchor, 'c')
}

{
  const result = selectAllInOrder(['b', 'd', 'f'], 'd')
  assert.deepEqual(ids(result.selected), ['b', 'd', 'f'])
  assert.equal(result.anchor, 'd')
  const cleared = clearSelection<string>()
  assert.deepEqual(ids(cleared.selected), [])
  assert.equal(cleared.anchor, null)
}

{
  const retained = retainSelection(new Set(['a', 'b', 'missing']), new Set(['b', 'c']))
  assert.deepEqual(ids(retained), ['b'])
}

assert.equal(isDeleteSelectionShortcut({ key: 'Backspace', metaKey: true, ctrlKey: false }), true)
assert.equal(isDeleteSelectionShortcut({ key: 'Delete', metaKey: true, ctrlKey: false }), true)
assert.equal(isDeleteSelectionShortcut({ key: 'Backspace', metaKey: false, ctrlKey: true }), true)
assert.equal(isDeleteSelectionShortcut({ key: 'Backspace', metaKey: false, ctrlKey: false }), false)
assert.equal(isFindShortcut({ key: 'f', metaKey: true, ctrlKey: false }), true)
assert.equal(isFindShortcut({ key: 'F', metaKey: false, ctrlKey: true }), true)
assert.equal(isRefreshShortcut({ key: 'r', metaKey: true, ctrlKey: false }), true)
assert.equal(isRefreshShortcut({ key: 'R', metaKey: false, ctrlKey: true }), true)
assert.equal(isRefreshShortcut({ key: 'r', metaKey: false, ctrlKey: false }), false)

const download = (id: string) => ({ id } as Download)
const playlist = (id: string, downloads: Download[]) => ({ id, downloads } as Playlist)
const allPlaylistDownloads = ['b', 'c', 'd', 'e', 'f', 'g'].map(download)

{
  const grouped = [download('a'), playlist('playlist', allPlaylistDownloads), download('h')]
  assert.deepEqual(getVisibleQueueDownloadIds(grouped, {}), ['a', 'h'])
  assert.deepEqual(getVisibleQueueSelectionIds(grouped, {}), ['a', 'playlist:playlist', 'h'])
  assert.deepEqual(
    getVisibleQueueDownloadIds(grouped, { playlist: { expanded: true, showAll: false } }),
    ['a', 'b', 'c', 'd', 'e', 'f', 'h']
  )
  assert.deepEqual(
    getVisibleQueueSelectionIds(grouped, { playlist: { expanded: true, showAll: false } }),
    ['a', 'playlist:playlist', 'b', 'c', 'd', 'e', 'f', 'h']
  )
  assert.deepEqual(
    getVisibleQueueDownloadIds(grouped, { playlist: { expanded: true, showAll: true } }),
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  )
}

assert.equal(getPlaylistSelectionId('playlist'), 'playlist:playlist')
assert.equal(getPlaylistIdFromSelectionId('playlist:playlist'), 'playlist')
assert.equal(getPlaylistIdFromSelectionId('download-id'), null)
assert.deepEqual(
  expandQueueSelectionToDownloadIds(new Set(['playlist:playlist']), [playlist('playlist', allPlaylistDownloads)]),
  allPlaylistDownloads.map((item) => item.id)
)

{
  const virtualOrder = getVisibleQueueDownloadIds(
    [playlist('large', Array.from({ length: 60 }, (_, index) => download(`item-${index}`)))],
    { large: { expanded: true, showAll: true } }
  )
  const range = applySelectionClick(virtualOrder, new Set(['item-2']), 'item-2', 'item-57', { shiftKey: true })
  assert.equal(range.selected.size, 56)
  assert.equal(range.selected.has('item-30'), true)
}

console.log('selection tests passed')
