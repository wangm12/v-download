import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  assertLibraryDeletePaths,
  libraryWorkKey,
  mergeLibraryCatalog,
  normalizeLibraryTitle,
  pageLibraryItems,
  planLibraryDelete,
  queryLibraryFiles,
  queryLibraryWorks,
  resolveLibraryPath
} from '../src/main/libraryModel.ts'
import { resetLibraryScanCache, scanLibraryDisk } from '../src/main/libraryScan.ts'
import { libraryDeletePayload } from '../src/renderer/src/components/libraryViewPresentation.ts'

function row(partial: {
  id?: string
  url?: string
  title?: string
  status?: string
  file_path?: string | null
  file_size?: number | null
  thumbnail?: string | null
  channel?: string | null
  playlist_id?: string | null
  playlist_index?: number | null
  extras?: string | null
  created_at?: string
  updated_at?: string
} = {}) {
  return {
    id: partial.id ?? 'row-1',
    url: partial.url ?? 'https://www.douyin.com/video/111',
    title: partial.title ?? 'Dance_cover.mp4',
    status: partial.status ?? 'complete',
    file_path: partial.file_path === undefined ? '/tmp/dl/Dance_cover.mp4' : partial.file_path,
    file_size: partial.file_size ?? 12,
    thumbnail: partial.thumbnail ?? null,
    channel: partial.channel ?? 'Creator',
    playlist_id: partial.playlist_id ?? null,
    playlist_index: partial.playlist_index ?? null,
    extras: partial.extras ?? null,
    created_at: partial.created_at ?? '2026-08-31T00:00:00.000Z',
    updated_at: partial.updated_at ?? '2026-08-31T00:00:00.000Z'
  }
}

assert.equal(normalizeLibraryTitle('Dance_cover.mp4'), 'Dance')
assert.equal(normalizeLibraryTitle('Dance_live_photo.jpg'), 'Dance')
assert.equal(normalizeLibraryTitle('Dance (1).jpg'), 'Dance')
assert.equal(normalizeLibraryTitle('Dance第2张.png'), 'Dance')

const awemeKey = libraryWorkKey({
  extras: { awemeId: '7488123' },
  title: 'Other title',
  channel: 'Creator',
  url: 'https://www.douyin.com/video/999'
})
const titleKey = libraryWorkKey({
  title: 'Dance_cover.mp4',
  channel: 'Creator'
})
assert.equal(awemeKey, 'aweme:7488123')
assert.equal(titleKey, 'title:Creator:Dance')
assert.notEqual(awemeKey, titleKey, 'aweme extras beat title fallback')

const root = join(tmpdir(), `vdl-library-${Date.now()}`)
const downloadDir = join(root, 'Downloads')
const galleryDir = join(downloadDir, 'Creator')
const remoteDir = join(downloadDir, 'remote-jobs', 'job1')
mkdirSync(galleryDir, { recursive: true })
mkdirSync(remoteDir, { recursive: true })

const videoPath = join(galleryDir, 'Dance.mp4')
const coverPath = join(galleryDir, 'Dance_cover.jpg')
const livePath = join(galleryDir, 'Dance_live_photo.mp4')
const stillPath = join(galleryDir, 'Dance第1张.jpg')
const strayPath = join(downloadDir, 'stray-no-row.webm')
const remotePath = join(remoteDir, 'secret.mp4')
const partPath = join(galleryDir, 'Dance.mp4.part')
const ytdlPath = join(galleryDir, 'Dance.ytdl')
const passPath = join(galleryDir, 'ffmpeg2pass-0.log')
const compressedPath = join(galleryDir, 'compressed_tmp.bin')
const dotPath = join(galleryDir, '.hidden')

writeFileSync(videoPath, 'video')
writeFileSync(coverPath, 'cover')
writeFileSync(livePath, 'live')
writeFileSync(stillPath, 'still')
writeFileSync(strayPath, 'stray')
writeFileSync(remotePath, 'secret')
writeFileSync(partPath, 'part')
writeFileSync(ytdlPath, 'ytdl')
writeFileSync(passPath, 'pass')
writeFileSync(compressedPath, 'tmp')
writeFileSync(dotPath, 'dot')

const missingPath = join(galleryDir, 'Gone.mp4')
const outsidePath = join(root, 'outside.mp4')
writeFileSync(outsidePath, 'nope')

const scanned = scanLibraryDisk(downloadDir)
const scannedPaths = scanned.map((file) => file.path).sort()
assert.ok(scannedPaths.includes(resolveLibraryPath(videoPath)), 'gallery video is scanned')
assert.ok(scannedPaths.includes(resolveLibraryPath(coverPath)), 'gallery cover is scanned')
assert.ok(scannedPaths.includes(resolveLibraryPath(strayPath)), 'disk-only file is scanned')
assert.ok(!scannedPaths.includes(resolveLibraryPath(remotePath)), 'remote-jobs/ is excluded')
assert.ok(!scannedPaths.some((path) => path.endsWith('.part') || path.endsWith('.ytdl')), 'temp artifacts skipped')
assert.ok(!scannedPaths.some((path) => path.includes('ffmpeg2pass') || path.includes('compressed_')), 'pass/compressed skipped')
assert.ok(!scannedPaths.some((path) => path.includes(`${join(galleryDir, '.hidden')}`)), 'dotfiles skipped')

const cached = scanLibraryDisk(downloadDir)
writeFileSync(join(galleryDir, 'late-add.mp4'), 'late')
const stillCached = scanLibraryDisk(downloadDir)
assert.equal(stillCached.length, cached.length, 'short scan cache reused until forceRefresh')
const refreshed = scanLibraryDisk(downloadDir, { forceRefresh: true })
assert.ok(refreshed.some((file) => file.fileName === 'late-add.mp4'), 'forceRefresh busts scan cache')
resetLibraryScanCache()

const merged = mergeLibraryCatalog({
  downloadDir,
  rows: [
    row({
      id: 'aweme-row',
      title: 'Dance_cover.mp4',
      file_path: videoPath,
      extras: JSON.stringify({ awemeId: '7488123' }),
      thumbnail: 'https://example.com/thumb.jpg'
    }),
    row({
      id: 'missing-row',
      title: 'Gone.mp4',
      file_path: missingPath,
      extras: JSON.stringify({ awemeId: '9990001' })
    }),
    row({
      id: 'active-row',
      status: 'downloading',
      title: 'Still going.mp4',
      file_path: join(galleryDir, 'not-yet.mp4')
    })
  ],
  diskFiles: refreshed
})

const byName = new Map(merged.map((item) => [item.fileName, item]))
assert.equal(byName.get('stray-no-row.webm')?.missing, false, 'disk without row still lists')
assert.equal(byName.get('Gone.mp4')?.missing, true, 'row without file is missing')
assert.equal(byName.has('secret.mp4'), false, 'remote-jobs files never merge in')
assert.equal(byName.has('Still going.mp4'), false, 'active queue rows stay off Library')

const danceWork = queryLibraryWorks(merged, { query: 'Dance', limit: 24 })
assert.equal(danceWork.total, 1, 'gallery files share one work via aweme + title peel')
assert.ok((danceWork.items[0]?.items.length ?? 0) >= 4, 'work contains gallery files')
assert.equal(danceWork.items[0]?.key, 'aweme:7488123')
assert.equal(danceWork.items[0]?.cover, 'https://example.com/thumb.jpg')

const filesPage = queryLibraryFiles(merged, { limit: 2, offset: 0, sortBy: 'date', sortDir: 'desc' })
assert.equal(filesPage.items.length, 2, 'file page does not return the whole tree')
assert.ok(filesPage.total > 2, 'total remains the filtered catalog size')
assert.ok(
  pageLibraryItems(merged, { limit: 2 }).items.length === 2,
  'pagination helper slices in main, not the renderer'
)

const searchPage = queryLibraryFiles(merged, { query: 'stray', limit: 24 })
assert.equal(searchPage.total, 1)
assert.equal(searchPage.items[0]?.fileName, 'stray-no-row.webm')

const videoOnly = queryLibraryFiles(merged, { mediaType: 'video', limit: 96 })
assert.ok(videoOnly.items.every((item) => item.mediaKind === 'video'))

const numberedDir = join(galleryDir, 'GalleryTitle')
const numberedOne = join(numberedDir, '001.jpg')
const numberedTwo = join(numberedDir, '002.jpg')
const numberedVideo = join(numberedDir, '003.mp4')
mkdirSync(numberedDir, { recursive: true })
writeFileSync(numberedOne, 'one')
writeFileSync(numberedTwo, 'two')
writeFileSync(numberedVideo, 'three')
const numberedScan = scanLibraryDisk(downloadDir, { forceRefresh: true })
const numberedMerged = mergeLibraryCatalog({
  downloadDir,
  rows: [
    row({
      id: 'gallery-row',
      title: 'GalleryTitle',
      file_path: numberedDir,
      extras: JSON.stringify({ awemeId: 'gallery-aweme-1' }),
      thumbnail: 'https://example.com/g.jpg'
    })
  ],
  diskFiles: numberedScan
})
const numberedFiles = numberedMerged.filter((item) => item.workKey === 'aweme:gallery-aweme-1')
assert.equal(numberedFiles.length, 3, 'aweme gallery dir attaches 001.jpg children, not the directory')
assert.ok(numberedFiles.every((item) => !item.missing), 'existing gallery dir with children is not missing')
assert.ok(
  !numberedFiles.some((item) => item.path === resolveLibraryPath(numberedDir)),
  'directory file_path is not emitted as a file row'
)
assert.deepEqual(
  numberedFiles.map((item) => item.fileName).sort(),
  ['001.jpg', '002.jpg', '003.mp4']
)
assert.equal(
  numberedMerged.filter((item) => ['001.jpg', '002.jpg', '003.mp4'].includes(item.fileName) && item.workKey.startsWith('title:')).length,
  0,
  'numbered children inherit aweme work key, not title:folder:001'
)
const numberedWork = queryLibraryWorks(numberedMerged, { query: 'GalleryTitle', limit: 24 })
  .items
  .find((work) => work.key === 'aweme:gallery-aweme-1')
assert.ok(numberedWork, 'gallery dir + awemeId is one work')
assert.equal(numberedWork?.missing, false)
assert.equal(numberedWork?.items.length, 3, 'one work, N files')
assert.ok(numberedWork?.items.every((item) => item.path && item.path !== resolveLibraryPath(numberedDir)))

const numberedPlan = planLibraryDelete({
  downloadDir,
  paths: numberedFiles.map((item) => item.path!).filter(Boolean),
  recordIds: numberedFiles.map((item) => item.downloadId!).filter(Boolean),
  rows: [{ id: 'gallery-row', file_path: numberedDir }]
})
assert.equal(numberedPlan.ok, true)
if (numberedPlan.ok) {
  assert.ok(!numberedPlan.unlinkPaths.includes(resolveLibraryPath(numberedDir)), 'delete unlinks children, not the gallery dir')
  assert.ok(numberedPlan.unlinkPaths.includes(resolveLibraryPath(numberedOne)))
  assert.ok(numberedPlan.unlinkPaths.includes(resolveLibraryPath(numberedTwo)))
  assert.ok(numberedPlan.unlinkPaths.includes(resolveLibraryPath(numberedVideo)))
  assert.ok(numberedPlan.deleteIds.includes('gallery-row'), 'delete drops the gallery row')
}

const allChildrenNoIds = planLibraryDelete({
  downloadDir,
  paths: [numberedOne, numberedTwo, numberedVideo],
  recordIds: [],
  rows: [{ id: 'gallery-row', file_path: numberedDir }]
})
assert.equal(allChildrenNoIds.ok, true)
if (allChildrenNoIds.ok) {
  assert.ok(allChildrenNoIds.deleteIds.includes('gallery-row'), 'File-view delete of every remaining child still drops the row')
}

const dirOnlyPlan = planLibraryDelete({
  downloadDir,
  paths: [numberedDir],
  rows: [{ id: 'gallery-row', file_path: numberedDir }]
})
assert.equal(dirOnlyPlan.ok, true)
if (dirOnlyPlan.ok) {
  assert.ok(!dirOnlyPlan.unlinkPaths.includes(resolveLibraryPath(numberedDir)), 'never unlinkSync the gallery directory')
  assert.ok(dirOnlyPlan.deleteIds.includes('gallery-row'))
}

const galleryRow = row({
  id: 'gallery-row',
  title: 'GalleryTitle',
  file_path: numberedDir,
  extras: JSON.stringify({ awemeId: 'gallery-aweme-1' }),
  thumbnail: 'https://example.com/g.jpg'
})
const oneChildPlan = planLibraryDelete({
  downloadDir,
  paths: [numberedOne],
  recordIds: [],
  rows: [{ id: 'gallery-row', file_path: numberedDir }]
})
assert.equal(oneChildPlan.ok, true)
if (oneChildPlan.ok) {
  assert.deepEqual(oneChildPlan.unlinkPaths, [resolveLibraryPath(numberedOne)])
  assert.ok(!oneChildPlan.unlinkPaths.includes(resolveLibraryPath(numberedDir)), 'partial delete does not unlink the gallery dir')
  assert.ok(!oneChildPlan.deleteIds.includes('gallery-row'), 'File-view delete of 001.jpg alone keeps the gallery row')
}

const leakedIdPlan = planLibraryDelete({
  downloadDir,
  paths: [numberedOne],
  recordIds: numberedFiles.map((item) => item.downloadId!).filter(Boolean),
  rows: [{ id: 'gallery-row', file_path: numberedDir }]
})
assert.equal(leakedIdPlan.ok, true)
if (leakedIdPlan.ok) {
  assert.ok(!leakedIdPlan.deleteIds.includes('gallery-row'), 'shared downloadId is not a whole-row match for a partial File-view delete')
}

if (oneChildPlan.ok) {
  for (const path of oneChildPlan.unlinkPaths) rmSync(path)
}
const remainingRows = oneChildPlan.ok && oneChildPlan.deleteIds.includes('gallery-row') ? [] : [galleryRow]
const afterOneChild = mergeLibraryCatalog({
  downloadDir,
  rows: remainingRows,
  diskFiles: scanLibraryDisk(downloadDir, { forceRefresh: true })
})
const afterOneChildWork = queryLibraryWorks(afterOneChild, { query: 'GalleryTitle', limit: 24 })
  .items
  .find((work) => work.key === 'aweme:gallery-aweme-1')
assert.ok(afterOneChildWork, 'after deleting 001.jpg the row stays one aweme work')
assert.equal(afterOneChildWork?.items.length, 2, '002.jpg + 003.mp4 remain')
assert.deepEqual(
  afterOneChildWork?.items.map((item) => item.fileName).sort(),
  ['002.jpg', '003.mp4']
)
assert.equal(
  afterOneChild.filter((item) => ['002.jpg', '003.mp4'].includes(item.fileName) && item.workKey.startsWith('title:')).length,
  0,
  'remaining numbered files stay one aweme work, not title-key leftovers'
)

const fileViewOneChild = libraryDeletePayload('files', [{ path: numberedOne, downloadId: 'gallery-row' }])
assert.deepEqual(fileViewOneChild.paths, [numberedOne])
assert.deepEqual(fileViewOneChild.recordIds, [], 'File-view partial delete does not send shared downloadId')
const workViewAll = libraryDeletePayload(
  'works',
  numberedFiles.map((item) => ({ path: item.path, downloadId: item.downloadId }))
)
assert.ok(workViewAll.recordIds.includes('gallery-row'), 'Work-view delete still sends the gallery row id')
assert.equal(workViewAll.paths.length, 3, 'Work-view delete still sends every child path')
const fileViewMissing = libraryDeletePayload('files', [{ path: null, downloadId: 'missing-row' }])
assert.deepEqual(fileViewMissing.recordIds, ['missing-row'], 'File-view still sends recordIds for pathless rows')

const goneGalleryDir = join(downloadDir, 'VanishedGallery')
const goneGallery = mergeLibraryCatalog({
  downloadDir,
  rows: [
    row({
      id: 'gone-gallery',
      title: 'Vanished',
      file_path: goneGalleryDir,
      extras: JSON.stringify({ awemeId: 'gone-gallery-1' })
    })
  ],
  diskFiles: numberedScan
})
const goneGalleryItem = goneGallery.find((item) => item.downloadId === 'gone-gallery')
assert.equal(goneGalleryItem?.missing, true, 'missing only when gallery dir is gone and has no children')

const emptyGalleryDir = join(downloadDir, 'EmptyGallery')
mkdirSync(emptyGalleryDir, { recursive: true })
const emptyGallery = mergeLibraryCatalog({
  downloadDir,
  rows: [
    row({
      id: 'empty-gallery',
      title: 'Empty',
      file_path: emptyGalleryDir,
      extras: JSON.stringify({ awemeId: 'empty-gallery-1' })
    })
  ],
  diskFiles: numberedScan
})
const emptyGalleryItems = emptyGallery.filter((item) => item.workKey === 'aweme:empty-gallery-1')
assert.equal(emptyGalleryItems.length, 1, 'empty existing gallery dir still lists one row')
assert.equal(emptyGalleryItems[0]?.missing, false, 'existing empty gallery dir is not missing')
assert.notEqual(emptyGalleryItems[0]?.path, resolveLibraryPath(emptyGalleryDir), 'empty gallery dir is not a file row')

const outside = assertLibraryDeletePaths(downloadDir, [outsidePath])
assert.equal(outside.ok, false, 'delete refuses path outside downloadDir')
const remoteDelete = assertLibraryDeletePaths(downloadDir, [remotePath])
assert.equal(remoteDelete.ok, false, 'delete refuses remote-jobs paths')
const owned = assertLibraryDeletePaths(downloadDir, [strayPath])
assert.equal(owned.ok, true)

const contract = readFileSync(join(process.cwd(), 'src/renderer/src/components/LibraryView.tsx'), 'utf8')
assert.match(contract, /useDeferredValue/, 'search must defer so typing does not reload the whole tree')
assert.match(contract, /listLibrary(Files|Works)/, 'renderer asks main for a page, not a raw tree walk')
assert.doesNotMatch(
  contract,
  /const recordIds = selectedFiles\.map\(\(item\) => item\.downloadId\)/,
  'File-view must not send shared downloadId as recordIds for every selected file'
)
assert.match(contract, /libraryDeletePayload\(mode, selectedFiles\)/, 'LibraryView uses the File/Work delete payload helper')

rmSync(root, { recursive: true, force: true })
console.log('library model tests passed')
