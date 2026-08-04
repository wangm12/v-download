import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = new URL('..', import.meta.url).pathname
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const configPath = process.env.RELEASE_CONFIG || join(root, 'release-config.json')
const requested = process.env.RELEASE_ARCH || process.env.npm_config_arch
const arches = requested === 'both' ? ['arm64', 'x64'] : [requested || 'arm64']
const valid = new Set(['arm64', 'x64'])
const errors = []
if (arches.some((a) => !valid.has(a))) errors.push(`RELEASE_ARCH must be arm64, x64, or both (received ${requested || 'unset'})`)

if (!errors.length) {
  // Preparation is intentionally coupled to Agent 10's verifier; presence checks alone are not sufficient.
  for (const arch of arches) {
    const result = spawnSync(process.execPath, [join(root, 'scripts/engines.mjs'), 'verify'], {
      cwd: root, env: { ...process.env, RELEASE_ARCH: arch }, stdio: 'inherit'
    })
    if (result.status !== 0) errors.push(`verified engines are unavailable for darwin-${arch}`)
  }
}
const required = arches.flatMap((a) => [
  `resources/engines/darwin-${a}/yt-dlp`, `resources/engines/darwin-${a}/_internal/Python`,
  `resources/engines/darwin-${a}/ffmpeg`, `resources/engines/darwin-${a}/ffprobe`,
  `resources/engines/po-token/darwin-${a}/bgutil-provider`,
  `resources/engines/po-token/darwin-${a}/yt_dlp_plugins`
]).concat('resources/engines/SHA256SUMS', 'resources/engines/metadata.json', 'extension/manifest.json')
for (const path of required) if (!existsSync(join(root, path))) errors.push(`missing release input: ${path}`)
const manifest = JSON.parse(readFileSync(join(root, 'extension/manifest.json'), 'utf8'))
if (pkg.version !== manifest.version) errors.push(`extension version ${manifest.version} != app version ${pkg.version}`)
try {
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const extensionId = process.env.CHROME_EXTENSION_ID || config.chrome?.extensionId
  if (!/^[a-p]{32}$/.test(extensionId || '')) errors.push('release config is missing a valid stable Chrome Web Store extension ID')
} catch {
  errors.push(`missing or invalid release config: ${configPath}`)
}

if (errors.length) { console.error('RELEASE PREPARATION BLOCKED'); errors.forEach((e) => console.error(`- ${e}`)); process.exit(1) }
console.log(`Release inputs prepared for darwin-${arches.join(' and darwin-')}; signing, notarization, updater, and Chrome publication remain gated by verify:release.`)
