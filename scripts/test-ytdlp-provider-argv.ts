import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function main(): Promise<void> {
const source = await readFile(new URL('../src/main/ytdlp.ts', import.meta.url), 'utf8')
assert.match(source, /if \(extractorArgs && isValidYouTubeUrl\(url\)\) args\.push\('--extractor-args', extractorArgs\)/)
assert.match(source, /if \(pluginDir && isValidYouTubeUrl\(url\)\) args\.push\('--plugin-dirs', pluginDir\)/)
assert.match(source, /pluginDir\?: string/)
console.log('yt-dlp provider argv wiring assertions passed')
}
void main()
