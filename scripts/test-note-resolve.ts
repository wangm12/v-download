import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  hasNoteBody,
  noteFilePath,
  renderNoteMarkdown,
  writeNoteMarkdownFile,
} from '../src/main/noteMarkdown'
import { parseXiaohongshuNote } from '../src/main/xiaohongshu'
import { taskOptionsFromResolveData } from '../src/main/remoteResolveTask'
import { textInfoFromYtdlpDump } from '../src/main/ytdlp'

const withAuthor = renderNoteMarkdown({
  title: 'Hello',
  author: 'Ada',
  url: 'https://xhslink.cn/o/abc',
  description: 'Body line',
})
assert.match(withAuthor, /^# Hello$/m)
assert.match(withAuthor, /^- Author: Ada$/m)
assert.match(withAuthor, /^- URL: https:\/\/xhslink\.cn\/o\/abc$/m)
assert.match(withAuthor, /Body line/)

const noAuthor = renderNoteMarkdown({
  title: '',
  author: '',
  url: 'https://example.com/p',
  description: '',
})
assert.match(noAuthor, /^# Untitled$/m)
assert.doesNotMatch(noAuthor, /Author:/)
assert.match(noAuthor, /URL: https:\/\/example.com\/p/)

assert.equal(hasNoteBody({ title: '', author: 'x', url: 'https://a', description: '' }), false)
assert.equal(hasNoteBody({ title: 'T', author: '', url: '', description: '' }), true)
assert.equal(hasNoteBody({ title: '', author: '', url: '', description: 'd' }), true)

assert.equal(noteFilePath('gallery', '/tmp/Album', 'Album'), join('/tmp/Album', 'note.md'))
assert.equal(noteFilePath('sidecar', '/tmp/Album.mp4', 'Album'), join('/tmp', 'Album.md'))
assert.equal(noteFilePath('text', '/tmp', ''), join('/tmp', 'untitled.md'))

const dir = mkdtempSync(join(tmpdir(), 'vdl-note-'))
const mdPath = join(dir, 'note.md')
writeNoteMarkdownFile(mdPath, { title: 'Retry', author: '', url: 'https://a', description: 'one' })
writeNoteMarkdownFile(mdPath, { title: 'Retry', author: '', url: 'https://a', description: 'two' })
assert.match(readFileSync(mdPath, 'utf8'), /two/)

const textNote = parseXiaohongshuNote(
  { type: 'normal', title: 'Only words', desc: 'Full caption', user: { nickname: 'Sam' } },
  'abc123'
)
assert.equal(textNote?.kind, 'text')
if (textNote?.kind === 'text') {
  assert.equal(textNote.title, 'Only words')
  assert.equal(textNote.description, 'Full caption')
  assert.equal(textNote.author, 'Sam')
}

const galleryNote = parseXiaohongshuNote(
  {
    type: 'normal',
    title: 'Pics',
    desc: 'Gallery caption',
    imageList: [{ urlDefault: 'https://sns.example/a.jpg' }],
    user: { nickname: 'Pat' },
  },
  'def456'
)
assert.equal(galleryNote?.kind, 'gallery')
if (galleryNote?.kind === 'gallery') {
  assert.deepEqual(galleryNote.imageUrls, ['https://sns.example/a.jpg'])
  assert.equal(galleryNote.description, 'Gallery caption')
}

assert.equal(
  parseXiaohongshuNote({ type: 'video', title: 'Clip', video: { media: {} } }, 'vid1'),
  null
)

const galleryTask = taskOptionsFromResolveData(
  {
    _type: 'xhs_gallery',
    title: 'Oracle 面经',
    channel: 'Chill',
    webpage_url: 'https://xhslink.cn/o/7OA0OYWB0EB',
    description: '面试记录',
    image_urls: ['https://sns.example/1.jpg', 'https://sns.example/2.jpg'],
    thumbnail: 'https://sns.example/1.jpg',
    duration: 0,
    id: '68b1',
  },
  'https://xhslink.cn/o/7OA0OYWB0EB'
)
assert.equal(galleryTask.title, 'Oracle 面经')
assert.notEqual(galleryTask.title, 'download')
assert.deepEqual(galleryTask.metadata.xhsImageUrls, ['https://sns.example/1.jpg', 'https://sns.example/2.jpg'])
assert.equal(galleryTask.metadata.noteDescription, '面试记录')
assert.equal(galleryTask.metadata.noteOnly, undefined)

const textTask = taskOptionsFromResolveData(
  {
    _type: 'text',
    title: 'No media',
    channel: 'A',
    webpage_url: 'https://x.com/i/status/1',
    description: 'just words',
    id: '1',
  },
  'https://x.com/i/status/1'
)
assert.equal(textTask.metadata.noteOnly, true)
assert.equal(textTask.metadata.noteDescription, 'just words')

const dump = JSON.stringify({
  id: 'tw1',
  title: 'A tweet',
  description: 'hello from x',
  webpage_url: 'https://x.com/i/status/1',
  uploader: 'alice',
  formats: [],
})
const fromDump = textInfoFromYtdlpDump(dump)
assert.equal(fromDump?._type, 'text')
assert.equal(fromDump?.description, 'hello from x')
assert.equal(fromDump?.title, 'A tweet')
assert.equal(textInfoFromYtdlpDump(''), null)

const resolver = readFileSync('src/main/remoteJobService.ts', 'utf8')
assert.match(resolver, /taskOptionsFromResolveData/)
assert.match(resolver, /resolveVideoInfo/)

console.log('note resolve helpers passed')
