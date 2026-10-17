import assert from 'node:assert/strict'
import {
  defaultDownloadSelection, readDownloadSelection, selectionFormatSelector, reusableSelection,
  mutateDownloadPlanLibrary, EMPTY_DOWNLOAD_PLAN_LIBRARY, readDownloadPlan, sourceVideoMatches,
  audioLanguageMatches, type DownloadPlan
} from '../packages/shared/src/download-selection'
import { readDownloadRequestSnapshot, selectionKey } from '../src/main/downloadRequestSnapshot'
import { getPresentationCandidates } from '../src/renderer/src/components/formatDialogPresentation'

const policy = { ...defaultDownloadSelection(360), videoCodec: 'h264' as const, maxFps: 30 }
const selector = selectionFormatSelector(policy)
for (const branch of selector.split('/')) {
  assert.ok(branch.includes('[height<=?360]'), branch)
  assert.ok(branch.includes('[fps<=?30]'), branch)
  assert.ok(branch.includes('h264'), branch)
}
const exact = { ...policy, exact: { sourceUrl: 'https://fixture.test/watch', formatId: 'video-360-30', kind: 'video' as const, audioFormatId: 'audio-en' } }
assert.equal(selectionFormatSelector(exact), 'all[format_id="video-360-30"]+all[format_id="audio-en"]')
assert.equal('exact' in reusableSelection(exact), false)
for (const formatId of ['best/720', 'x+best', 'x[height>360]', 'x\n-f best']) assert.throws(() => readDownloadSelection({ ...exact, exact: { ...exact.exact, formatId } }))
assert.throws(() => readDownloadSelection({ ...policy, version: 2 }))
assert.throws(() => readDownloadSelection({ ...policy, output: 'mp3' }))
assert.throws(() => readDownloadSelection({ ...policy, output: 'mp4', postprocess: 'h264-mp4', dynamicRange: 'hdr' }))
assert.equal(sourceVideoMatches(policy, { height: 360, fps: 60, codec: 'avc1' }), false)
assert.equal(sourceVideoMatches(policy, { height: 720, fps: 30, codec: 'h264' }), false)
assert.equal(sourceVideoMatches(policy, { height: 360, fps: 30, codec: 'h264' }), true)
assert.equal(sourceVideoMatches(policy, { height: 360, fps: 30 }), false, 'a missing source codec cannot pass final output verification')
assert.equal(sourceVideoMatches(policy, { height: 360, fps: 30, codec: 'hevc' }), false, 'compatibility conversion must not hide the wrong source codec')
assert.equal(sourceVideoMatches(policy, { height: 360, codec: 'h264' }), false, 'unknown FPS cannot satisfy an explicit limit')

const plan: DownloadPlan = { id: 'test-plan', name: '360p archive', revision: 1, selection: policy, includeNote: true }
assert.throws(() => readDownloadPlan({ ...plan, selection: exact }))
const library = mutateDownloadPlanLibrary(EMPTY_DOWNLOAD_PLAN_LIBRARY, { action: 'save', plan, expectedRevision: 0 })
const selected = mutateDownloadPlanLibrary(library, { action: 'default', id: plan.id })
assert.throws(() => mutateDownloadPlanLibrary(selected, { action: 'save', plan, expectedRevision: 0 }))
const updated = mutateDownloadPlanLibrary(selected, { action: 'save', plan: { ...plan, name: 'Updated', selection: defaultDownloadSelection(720) }, expectedRevision: 1 })
assert.equal(updated.custom[0].revision, 2)
assert.equal(library.custom[0].selection.maxHeight, 360, 'updates cannot mutate previously admitted choices')
assert.equal(mutateDownloadPlanLibrary(updated, { action: 'delete', id: plan.id, expectedRevision: 2 }).defaultId, null)
assert.throws(() => mutateDownloadPlanLibrary(library, { action: 'default', id: 'removed' }))
const snapshot = readDownloadRequestSnapshot({ version: 1, selection: policy, plan: { id: plan.id, name: plan.name, revision: 1 }, outputDir: '/tmp/downloads', filenameTemplate: '{title} [{id}]', includeNote: true, archiveByAuthor: false, folderNameTemplate: '{author}', playlistSubfolder: true })
assert.equal(selectionKey(snapshot), selectionKey({ ...snapshot, plan: { ...snapshot.plan!, name: 'Renamed', revision: 2 } }))
for (const difference of [{ selection: defaultDownloadSelection(720) }, { outputDir: '/tmp/another' }, { filenameTemplate: '{id}' }, { includeNote: false }]) assert.notEqual(selectionKey(snapshot), selectionKey({ ...snapshot, ...difference }))
const source = { version: 1, pageUrl: 'https://fixture.test/watch?item=one', documentUrl: 'https://player.test/embed?item=one', frameId: 2, observedAt: 1 }
assert.notEqual(selectionKey(snapshot, source), selectionKey(snapshot, { ...source, documentUrl: 'https://player.test/embed?item=two' }), 'another requesting document cannot reuse stale Referer')
assert.equal(selectionKey(snapshot, source), selectionKey(snapshot, { ...source, frameId: 5, observedAt: 2, documentId: 'new-capture' }), 'new browser capture identities do not duplicate the same source task')
assert.notEqual(selectionKey(undefined, source), null, 'legacy output requests still isolate distinct browser sources')
const candidates = getPresentationCandidates([
  { format_id: '30fps', height: 360, fps: 30, vcodec: 'h264', acodec: 'aac', ext: 'mp4' },
  { format_id: '60fps', height: 360, fps: 60, vcodec: 'h264', acodec: 'aac', ext: 'mp4' }
], 'video', 'best')
assert.equal(candidates.length, 2, 'same-height sources with different FPS remain selectable')
console.log('download selection: exact IDs, constrained fallback, plan revisions, snapshots and output identity passed')

assert.ok(audioLanguageMatches('en', 'eng'))
assert.ok(audioLanguageMatches('zh', 'zho-Hans'))
assert.ok(!audioLanguageMatches('en-US', 'eng-GB'))
assert.ok(!audioLanguageMatches('en', undefined))
assert.throws(() => readDownloadSelection({ ...policy, target: 'audio', output: 'mp3', audioBitrate: 512 }))

import { videoFacts } from '../src/main/probeStreamFacts'
assert.equal(videoFacts({ color_transfer: 'unknown' }).dynamicRange, undefined)
assert.equal(videoFacts({ color_transfer: 'smpte2084' }).dynamicRange, 'hdr')
assert.equal(videoFacts({ color_transfer: 'bt709' }).dynamicRange, 'sdr')

assert.equal(selectionFormatSelector({ ...exact, exact: { ...exact.exact, formatId: 'best', kind: 'muxed', audioFormatId: undefined } }), 'all[format_id="best"]', 'reserved yt-dlp names remain literal provider IDs')
assert.equal(selectionFormatSelector({ ...exact, exact: { ...exact.exact, formatId: '1', audioFormatId: '2' } }), 'all[format_id="1"]+all[format_id="2"]', 'numeric provider IDs remain strings')
