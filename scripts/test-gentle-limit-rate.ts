import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { GENTLE_LIMIT_RATE, ytdlpLimitRateArgs } from '../src/main/ytdlpLimitRate'

async function main(): Promise<void> {
  assert.equal(GENTLE_LIMIT_RATE, '2M', 'Gentle maps to yt-dlp --limit-rate 2M (2 MiB/s)')
  assert.deepEqual(ytdlpLimitRateArgs('gentle'), ['--limit-rate', '2M'])
  assert.deepEqual(ytdlpLimitRateArgs('balanced'), [])
  assert.deepEqual(ytdlpLimitRateArgs('turbo'), [])
  assert.deepEqual(ytdlpLimitRateArgs(undefined), [])

  const source = await readFile(new URL('../src/main/ytdlp.ts', import.meta.url), 'utf8')
  assert.match(source, /limitRate/, 'download() must accept a Gentle --limit-rate option')
  assert.match(source, /--limit-rate/, 'yt-dlp argv must include --limit-rate when Gentle is active')

  const manager = await readFile(new URL('../src/main/downloadManager.ts', import.meta.url), 'utf8')
  assert.match(manager, /ytdlpLimitRateArgs|GENTLE_LIMIT_RATE|limitRate/, 'queue must pass Gentle --limit-rate into yt-dlp')

  console.log('gentle --limit-rate tests passed (cap: 2M)')
}

void main()
