import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { readFile as readText } from 'node:fs/promises'
const root = new URL('..', import.meta.url).pathname
const verifier = await readText(join(root, 'scripts/engines.mjs'), 'utf8')
const m = JSON.parse(await readFile(join(root, 'resources/engines/manifest.json'), 'utf8'))
assert.deepEqual(m.architectures, ['arm64', 'x64'])
assert.equal(m.engines['bgutil-provider'].archives.arm64.url.includes('/v0.8.1/'), true)
assert.equal(m.engines.ffmpeg.archives.arm64.archive.includes('/arm64/1783011502_8.1.2/'), true)
assert.equal(m.engines.ffmpeg.archives.x64.archive.includes('/amd64/1783018342_8.1.2/'), true)
assert.equal(m.engines.ffprobe.archives.arm64.sha256, 'c39787f4af7a3932502d2d48db6f6feaaa836b48a73ef78c32cc3285df61dfaf')
assert.equal(m.engines['bgutil-provider'].healthPath, '/ping')
assert.equal(m.engines['bgutil-provider'].version, m.engines['bgutil-provider'].plugin.version)
assert.match(m.engines['bgutil-provider'].plugin.archive, /jim60105\/bgutil-ytdlp-pot-provider-rs\/releases\/download\/v0\.8\.1\/bgutil-ytdlp-pot-provider-rs\.zip$/)
for (const [name, e] of Object.entries(m.engines)) { for (const source of (e.archives ? Object.values(e.archives) : [e])) { const url = source.url || source.archive; assert.match(url, /^https:\/\/(github\.com|evermeet\.cx|ffmpeg\.martin-riedl\.de)\/[^?]+/); assert.match(url, new RegExp(e.version.replace(/^v/, '').replaceAll('.', '\\.')+'(?:\\.|/|$)')); assert.match(source.sha256, /^[a-f0-9]{64}$/) } assert.ok(e.version) }
assert.equal(m.engines['bgutil-provider'].launchArgs.join(' '), 'server --host 127.0.0.1 --port PORT')
assert.equal(createHash('sha256').update('fixture').digest('hex'), 'f16d05ec6b29248d2c61adb1e9263f78e4f7bace1b955014a2d17872cfe4064d')
assert.equal(join('resources/engines', 'darwin-arm64', 'yt-dlp'), 'resources/engines/darwin-arm64/yt-dlp')
assert.match(verifier, /assertVersion\(await run\(/)
assert.match(verifier, /missing metadata entry for darwin-/)
assert.match(verifier, /missing SHA256SUMS entry for/)
assert.match(verifier, /missing metadata checksum for provider plugin/)
assert.match(verifier, /missing yt-dlp sidecar metadata/)
assert.match(verifier, /join\(sidecar, 'Python'\)/)
assert.match(verifier, /resources\/engines\/darwin-\$\{arch\}\/\_internal/)
assert.match(verifier, /spawn\('file', \['-b', p\]/)
console.log('engine manifest tests passed')
