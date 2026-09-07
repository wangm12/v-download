import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { sanitizeDownloadBasename } from '../src/main/sanitizeDownloadBasename.ts'
import {
  DEFAULT_FILENAME_TEMPLATE,
  DEFAULT_FOLDER_NAME_TEMPLATE,
  composeDownloadOutputDir,
  renderConcreteBasename,
  renderConcreteFolderSegment,
  renderYtdlpFilenameTemplate,
  resolveWriterOutputName,
  validateOutputTemplate
} from '../src/main/outputTemplateModel.ts'

assert.equal(DEFAULT_FILENAME_TEMPLATE, '{title} [{id}]')
assert.equal(DEFAULT_FOLDER_NAME_TEMPLATE, '{author}')

assert.equal(validateOutputTemplate('{title} [{id}]', 'filename').ok, true, 'default filename is valid')
assert.equal(validateOutputTemplate('{author}', 'folder').ok, true, 'default folder is valid')
assert.equal(validateOutputTemplate('{title} [{id}].{ext}', 'filename').ok, true, '{ext} is allowed in filename')

const unknown = validateOutputTemplate('{title} {nope}', 'filename')
assert.equal(unknown.ok, false, 'unknown token is rejected')
assert.match(unknown.ok ? '' : unknown.error, /unknown/i)

const extInFolder = validateOutputTemplate('{author}{ext}', 'folder')
assert.equal(extInFolder.ok, false, '{ext} is filename-only')

const rawInterp = validateOutputTemplate('{title} %(id)s', 'filename')
assert.equal(rawInterp.ok, false, 'raw %( interpolation is rejected')
assert.match(rawInterp.ok ? '' : rawInterp.error, /%\(/)

const parentSeg = validateOutputTemplate('{title}/../{id}', 'filename')
assert.equal(parentSeg.ok, false, '.. path segments are rejected')

assert.equal(validateOutputTemplate('foo/../../bar', 'folder').ok, false, '.. segments in folder are rejected')
assert.equal(validateOutputTemplate('{title} %(', 'filename').ok, false, 'bare %( is rejected')

assert.equal(
  renderYtdlpFilenameTemplate('{title} [{id}]'),
  '%(title).200B [%(id)s].%(ext)s',
  'default filename renders collision-safe yt-dlp -o'
)
assert.equal(
  renderYtdlpFilenameTemplate('{title} [{id}].{ext}'),
  '%(title).200B [%(id)s].%(ext)s',
  'explicit {ext} does not double the extension token'
)
assert.equal(
  renderYtdlpFilenameTemplate('{author}/{date}_{title}_{id}'),
  '%(uploader)s/%(upload_date>%Y-%m-%d)s_%(title).200B_%(id)s.%(ext)s',
  'author/date/title/id map to yt-dlp fields'
)

const emptyAuthorFolder = renderConcreteFolderSegment('{author}', { author: '' })
assert.equal(emptyAuthorFolder, '', 'empty author omits folder segment')
assert.equal(renderConcreteFolderSegment('{author}', { author: '   ' }), '', 'whitespace author omits folder')
assert.equal(renderConcreteFolderSegment('{author}', { author: 'DemoAuthor' }), 'DemoAuthor')

const outNoAuthor = composeDownloadOutputDir({
  downloadDir: '/Users/me/Downloads',
  archiveByAuthor: true,
  folderNameTemplate: '{author}',
  playlistSubfolder: true,
  playlistFolder: 'MyPlaylist',
  values: { author: '' }
})
assert.equal(outNoAuthor, join('/Users/me/Downloads', 'MyPlaylist'), 'empty author does not create unknown/ folder')

const outWithAuthor = composeDownloadOutputDir({
  downloadDir: '/Users/me/Downloads',
  archiveByAuthor: true,
  folderNameTemplate: '{author}',
  playlistSubfolder: true,
  playlistFolder: 'MyPlaylist',
  values: { author: 'DemoAuthor' }
})
assert.equal(outWithAuthor, join('/Users/me/Downloads', 'DemoAuthor', 'MyPlaylist'))

const remoteDir = composeDownloadOutputDir({
  downloadDir: '/Users/me/Downloads',
  archiveByAuthor: true,
  folderNameTemplate: '{author}',
  playlistSubfolder: true,
  playlistFolder: 'MyPlaylist',
  remoteOutputDir: join('/Users/me/Downloads', 'remote-jobs', 'job-1'),
  values: { author: 'DemoAuthor' }
})
assert.equal(
  remoteDir,
  join('/Users/me/Downloads', 'remote-jobs', 'job-1'),
  'remote jobs ignore author/playlist templates'
)

const profileArchived = composeDownloadOutputDir({
  downloadDir: '/Users/me/Downloads',
  archiveByAuthor: true,
  folderNameTemplate: '{author}',
  playlistSubfolder: true,
  playlistFolder: null,
  skipPlaylistFolder: true,
  values: { author: 'Author' }
})
assert.equal(
  profileArchived,
  join('/Users/me/Downloads', 'Author'),
  'profile pick + archiveByAuthor uses folder template only'
)

const messyTitle = 'Hello / World?? *Title*'
const rendered = renderConcreteBasename('{title} [{id}]', {
  title: messyTitle,
  id: 'abc123',
  author: 'Chan/nel',
  site: 'youtube'
})
assert.equal(
  rendered,
  `${sanitizeDownloadBasename(messyTitle, 100)} [abc123]`,
  'custom-writer titles go through sanitizeDownloadBasename'
)
assert.doesNotMatch(rendered, /[/?*:|"<>]/)
assert.doesNotMatch(renderConcreteFolderSegment('{author}', { author: 'A/B:C' }), /[/?*:|"<>]/)

const writerName = resolveWriterOutputName({
  filenameTemplate: '{title} [{id}]',
  title: messyTitle,
  id: 'aweme1',
  ext: 'mp4'
})
assert.equal(writerName, `${sanitizeDownloadBasename(messyTitle, 100)} [aweme1].mp4`)
assert.equal(basename(writerName), writerName)

const slashTemplate = '{author}/{title} [{id}]'
const slashYtdlp = renderYtdlpFilenameTemplate(slashTemplate)
const slashConcrete = resolveWriterOutputName({
  filenameTemplate: slashTemplate,
  title: 'Title',
  id: 'id',
  author: 'DemoAuthor',
  ext: 'mp4'
})
assert.equal(
  slashYtdlp,
  '%(uploader)s/%(title).200B [%(id)s].%(ext)s',
  'yt-dlp -o keeps filename / as relative folders'
)
assert.equal(
  slashConcrete.replace(/\\/g, '/'),
  'DemoAuthor/Title [id].mp4',
  'concrete writer keeps the same relative folder+name'
)
assert.equal(
  slashYtdlp.split('/').length,
  slashConcrete.replace(/\\/g, '/').split('/').length,
  'yt-dlp and concrete writer use the same number of relative segments'
)
const slashEmptyAuthor = resolveWriterOutputName({
  filenameTemplate: slashTemplate,
  title: 'Title',
  id: 'id',
  author: '',
  ext: 'mp4'
})
assert.equal(slashEmptyAuthor, 'Title [id].mp4', 'empty author omits that filename folder segment')
assert.equal(basename(slashEmptyAuthor), slashEmptyAuthor)

const settingsSource = readFileSync(new URL('../src/main/settings.ts', import.meta.url), 'utf8')
assert.match(settingsSource, /filenameTemplate: DEFAULT_FILENAME_TEMPLATE/)
assert.match(settingsSource, /folderNameTemplate: DEFAULT_FOLDER_NAME_TEMPLATE/)
assert.match(settingsSource, /archiveByAuthor: false/)
assert.match(settingsSource, /validateOutputTemplate\(value, 'filename'\)/)
assert.match(settingsSource, /validateOutputTemplate\(value, 'folder'\)/)

const douyinSource = readFileSync(new URL('../src/main/douyin.ts', import.meta.url), 'utf8')
assert.match(douyinSource, /sanitizeDownloadBasename\(title/)
assert.match(douyinSource, /outputBasename/)

const xhsSource = readFileSync(new URL('../src/main/xiaohongshu.ts', import.meta.url), 'utf8')
assert.match(xhsSource, /sanitizeDownloadBasename\(title/)
assert.match(xhsSource, /outputBasename/)

console.log('output-template tests passed')
