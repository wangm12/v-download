import assert from 'node:assert/strict'
import { fetchRemoteThumbnailDataUrl } from '../src/main/thumbnailFetch'

async function main(): Promise<void> {
  assert.equal(await fetchRemoteThumbnailDataUrl('https://127.0.0.1/private.png'), null)
  assert.equal(await fetchRemoteThumbnailDataUrl('https://localhost/private.png'), null)
  assert.equal(await fetchRemoteThumbnailDataUrl('file:///tmp/private.png'), null)
  assert.equal(await fetchRemoteThumbnailDataUrl('not-a-url'), null)
  console.log('thumbnail fetch guard tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
