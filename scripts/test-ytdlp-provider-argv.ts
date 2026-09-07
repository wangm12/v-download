import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  YOUTUBE_COOKIE_PLAYER_CLIENT_ARGS,
  appendYoutubeYtdlpArgs,
  isYoutubePageReloadError,
  resolveYtdlpOutputFilename
} from '../src/main/ytdlp'

async function main(): Promise<void> {
const source = await readFile(new URL('../src/main/ytdlp.ts', import.meta.url), 'utf8')
assert.match(source, /if \(extractorArgs && isValidYouTubeUrl\(url\)\) args\.push\('--extractor-args', extractorArgs\)/)
assert.match(source, /if \(pluginDir && isValidYouTubeUrl\(url\)\) args\.push\('--plugin-dirs', pluginDir\)/)
assert.match(source, /pluginDir\?: string/)
assert.match(source, /appendYoutubeYtdlpArgs\(/)
assert.match(source, /ensurePoTokenProvider/)
assert.match(source, /selectPreferredEnginePath/)
assert.match(source, /isYoutubePageReloadError/)

const youtube = 'https://www.youtube.com/watch?v=5fyy9t7v304'
const withCookies = ['--cookies', '/tmp/cookies.txt']
appendYoutubeYtdlpArgs(youtube, withCookies, {
  extractorArgs: 'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
  pluginDir: '/tmp/plugins'
})
assert.deepEqual(withCookies, [
  '--cookies',
  '/tmp/cookies.txt',
  '--extractor-args',
  'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
  '--extractor-args',
  YOUTUBE_COOKIE_PLAYER_CLIENT_ARGS,
  '--plugin-dirs',
  '/tmp/plugins'
])

const noCookies: string[] = []
appendYoutubeYtdlpArgs(youtube, noCookies, { extractorArgs: 'youtubepot-bgutilhttp:base_url=http://127.0.0.1:9' })
assert.deepEqual(noCookies, ['--extractor-args', 'youtubepot-bgutilhttp:base_url=http://127.0.0.1:9'])

const other: string[] = ['--cookies', '/tmp/cookies.txt']
appendYoutubeYtdlpArgs('https://www.douyin.com/video/1', other, { extractorArgs: 'ignored' })
assert.deepEqual(other, ['--cookies', '/tmp/cookies.txt'])

assert.equal(
  isYoutubePageReloadError('yt-dlp exited with code 1: ERROR: [youtube] 5fyy9t7v304: The page needs to be reloaded.'),
  true
)
assert.equal(isYoutubePageReloadError('HTTP Error 404: Not Found'), false)

assert.equal((source.match(/'-o'/g) ?? []).length, 1, 'download argv must contain exactly one -o')
assert.match(source, /resolveYtdlpOutputFilename\(/)
assert.equal(
  resolveYtdlpOutputFilename({ filenameTemplate: '{title} [{id}]' }),
  '%(title).200B [%(id)s].%(ext)s'
)
assert.equal(
  resolveYtdlpOutputFilename({
    filenameTemplate: '{title} [{id}]',
    isPlaylist: true,
    playlistTitle: 'Uploads'
  }),
  '%(playlist_index)03d - %(title).200B [%(id)s].%(ext)s'
)
assert.equal(
  resolveYtdlpOutputFilename({ outputTitle: 'Clip/Name' }),
  'Clip-Name.%(ext)s'
)
assert.equal(
  resolveYtdlpOutputFilename({ filenameTemplate: '{author}/{title} [{id}]' }),
  '%(uploader)s/%(title).200B [%(id)s].%(ext)s'
)

console.log('yt-dlp provider argv wiring assertions passed')
}
void main()
