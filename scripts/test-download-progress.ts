import assert from 'node:assert/strict'
import { downloadProgressPayload } from '../src/main/downloadProgress'
import type { DownloadTask } from '../src/main/downloadManager'
import { progressPatchFromIpc } from '../src/renderer/src/hooks/downloadProgress'

const promoted: DownloadTask = {
  id: 'same-placeholder-id', url: 'https://example.test/video', title: 'Audio choice',
  format: 'mp3', quality: '128', status: 'queued', progress: 0,
  filePath: null, thumbnail: null, duration: 12, metadata: {},
  playlistId: null, playlistIndex: null, error: null, errorCode: null,
  createdAt: '', updatedAt: ''
}
const placeholder = { format: 'video', quality: '360', error: 'old failure', file_path: '/old/file.mp4' }
const semanticEvent = downloadProgressPayload(promoted, {}, true)
const rendered = { ...placeholder, ...progressPatchFromIpc(semanticEvent) }
assert.equal(rendered.format, 'mp3')
assert.equal(rendered.quality, '128')
assert.equal(rendered.file_path, null)
assert.equal(rendered.error, null)

// A tick between promotion and completion must not erase the updated selection.
const tick = downloadProgressPayload({ ...promoted, status: 'downloading', progress: 25 })
assert.equal('format' in tick, false)
assert.equal('thumbnail' in tick, false)
assert.equal('metadata' in tick, false)
const downloading = { ...rendered, ...progressPatchFromIpc(tick) }
assert.equal(downloading.format, 'mp3')
assert.equal(downloading.quality, '128')
const completed = progressPatchFromIpc(downloadProgressPayload({
  ...promoted, status: 'complete', progress: 100, filePath: '/new/file.mp3'
}))
assert.equal(completed.format, 'mp3')
assert.equal(completed.file_path, '/new/file.mp3')
assert.deepEqual(progressPatchFromIpc({ id: promoted.id, speed: '1 MiB/s' }), { speed: '1 MiB/s' })
assert.deepEqual(progressPatchFromIpc({ format: null, quality: 360, thumbnail: undefined }), {})
console.log('download progress producer/renderer contract passed')

import { defaultDownloadSelection } from '../packages/shared/src/download-selection'
const selection = { ...defaultDownloadSelection(360), maxFps: 30 }
const withPlan = { ...promoted, metadata: { downloadRequest: { version: 1, selection, plan: { id: 'saved:30', name: '360p at 30fps', revision: 1 } } } }
const planPatch = progressPatchFromIpc(downloadProgressPayload(withPlan, {}, true))
assert.deepEqual(planPatch.selection, selection)
assert.equal(planPatch.planName, '360p at 30fps')
assert.equal(planPatch.planId, 'saved:30')
assert.equal('selection' in downloadProgressPayload({ ...withPlan, status: 'downloading' }), false)
assert.equal(progressPatchFromIpc(downloadProgressPayload(promoted, {}, true)).selection, null)

const sourceContext = { version: 1, pageUrl: 'https://source.test/watch?q=raw%20value', frameId: 7 }
assert.deepEqual(progressPatchFromIpc(downloadProgressPayload({ ...promoted, metadata: { sourceContext } }, {}, true)).sourceContext, sourceContext)
assert.equal(progressPatchFromIpc({ sourceContext: null }).sourceContext, null)

// The destination is a main-process fact; renderer patches never reinterpret plan metadata.
for (const status of ['queued', 'downloading', 'error', 'complete'] as const) {
  const task = { ...promoted, status, outputDir: '/custom/plan/actual-author' }
  assert.equal(progressPatchFromIpc(downloadProgressPayload(task, {}, true)).outputDir, task.outputDir)
}
assert.equal(progressPatchFromIpc(downloadProgressPayload({ ...promoted, status: 'downloading', outputDir: '/custom/plan' })).outputDir, '/custom/plan')
assert.equal('outputDir' in downloadProgressPayload({ ...promoted, status: 'downloading', progress: 50, outputDir: '/custom/plan' }), false)
assert.deepEqual(progressPatchFromIpc({ outputDir: null }), { outputDir: null })
assert.equal('outputDir' in progressPatchFromIpc({ progress: 50 }), false)
