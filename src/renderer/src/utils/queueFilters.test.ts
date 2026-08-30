import type { Download } from '../types'
import {
  countQueueAttention,
  filterDownloadsBySearch,
  filterDownloadsByStatus,
  filterQueueDownloads,
  getQueueEmptyKind
} from './queueFilters'

function download(id: string, status: Download['status'], title = id): Download {
  return {
    id,
    url: `https://example.com/${id}`,
    title,
    format: 'mp4',
    quality: '1080',
    status,
    progress: 0,
    speed: null,
    eta: null,
    totalSize: null,
    phase: null,
    file_path: null,
    file_size: null,
    thumbnail: null,
    duration: null,
    channel: null,
    playlist_id: null,
    playlist_index: null,
    error: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01'
  }
}

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

const items = [
  download('a', 'downloading', 'Live concert'),
  download('b', 'complete', 'Finished talk'),
  download('c', 'error', 'Broken clip'),
  download('d', 'queued', 'Waiting clip'),
  download('e', 'cancelled', 'Stopped clip'),
  download('f', 'interrupted', 'Lost clip'),
  download('g', 'ready', 'Ready clip'),
  download('h', 'resolving', 'Resolving clip'),
  download('i', 'paused', 'Paused clip')
]

equal(filterDownloadsByStatus(items, 'all').map((item) => item.id), items.map((item) => item.id))
equal(filterDownloadsByStatus(items, 'active').map((item) => item.id), ['a', 'd', 'g', 'h', 'i'])
equal(filterDownloadsByStatus(items, 'done').map((item) => item.id), ['b'])
equal(filterDownloadsByStatus(items, 'attention').map((item) => item.id), ['c', 'e', 'f'])
equal(countQueueAttention(items), 3)
equal(filterDownloadsBySearch(items, 'clip').map((item) => item.id), ['c', 'd', 'e', 'f', 'g', 'h', 'i'])
equal(filterQueueDownloads(items, 'clip', 'attention').map((item) => item.id), ['c', 'e', 'f'])
equal(getQueueEmptyKind({ totalCount: 0, visibleCount: 0, searchQuery: '', filter: 'all' }), 'ready')
equal(getQueueEmptyKind({ totalCount: 4, visibleCount: 0, searchQuery: 'xyz', filter: 'all' }), 'noSearchMatches')
equal(getQueueEmptyKind({ totalCount: 4, visibleCount: 0, searchQuery: '', filter: 'done' }), 'noFilterMatches')
equal(getQueueEmptyKind({ totalCount: 4, visibleCount: 2, searchQuery: 'clip', filter: 'all' }), null)

console.log('queue filter tests passed')
