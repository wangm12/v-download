import { existsSync, readFileSync, statSync, mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { join, resolve, extname, basename } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'

const root = resolve(new URL('..', import.meta.url).pathname)
const dryRun = process.env.RELEASE_DRY_RUN === '1'
const errors = []
const warn = []
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const extension = JSON.parse(readFileSync(join(root, 'extension/manifest.json'), 'utf8'))
const engineRoot = process.env.RELEASE_ENGINE_ROOT || join(root, 'resources/engines')
const engineManifest = JSON.parse(readFileSync(join(engineRoot, 'manifest.json'), 'utf8'))
const configPath = process.env.RELEASE_CONFIG || join(root, 'release-config.json')
let config = {}
if (existsSync(configPath)) config = JSON.parse(readFileSync(configPath, 'utf8'))
const requested = process.env.RELEASE_ARCH || process.env.npm_config_arch
const arches = requested === 'both' ? ['arm64', 'x64'] : [requested || 'arm64']
if (arches.some((a) => !['arm64', 'x64'].includes(a))) errors.push('RELEASE_ARCH must be arm64, x64, or both')
if (process.platform !== 'darwin' && !dryRun) errors.push(`macOS-first release verification cannot run on ${process.platform}`)

function hashFile(path) { return createHash('sha256').update(readFileSync(path)).digest('hex') }
function treeHash(path) {
  const h = createHash('sha256')
  const walk = (dir, rel = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const next = join(dir, entry.name); const nextRel = join(rel, entry.name)
      if (entry.isDirectory()) walk(next, nextRel); else { h.update(nextRel); h.update(readFileSync(next)) }
    }
  }
  walk(path); return h.digest('hex')
}
function runEngineVerifier(arch) {
  if (dryRun && process.env.RELEASE_ENGINE_VERIFY_MOCK === '1') return true
  const result = spawnSync(process.execPath, [join(root, 'scripts/engines.mjs'), 'verify'], { cwd: root, env: { ...process.env, RELEASE_ARCH: arch }, stdio: 'pipe', encoding: 'utf8' })
  if (result.status !== 0) { errors.push(`existing engine verifier failed for darwin-${arch}`); return false }
  return true
}

let metadata = {}
const sumsPath = join(engineRoot, 'SHA256SUMS')
const metadataPath = join(engineRoot, 'metadata.json')
const sums = existsSync(sumsPath) ? new Map(readFileSync(sumsPath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => { const m = line.match(/^([a-f0-9]{64})\s{2}(.+)$/); return m ? [m[2], m[1]] : ['', ''] })) : new Map()
try { metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) } catch { errors.push('missing or invalid engine metadata.json') }
for (const a of arches) {
  runEngineVerifier(a)
  const key = `darwin-${a}`; const base = join(engineRoot, key); const provider = join(engineRoot, 'po-token', key)
  for (const name of ['yt-dlp', 'ffmpeg', 'ffprobe']) {
    const file = join(base, name); const rel = `resources/engines/${key}/${name}`; const entry = metadata.architectures?.[key]?.[name]
    if (!existsSync(file)) errors.push(`missing ${name} for ${key}`)
    else { if ((statSync(file).mode & 0o111) === 0) errors.push(`${name} is not executable for ${key}`); if (!entry?.installedSha256 || hashFile(file) !== entry.installedSha256 || sums.get(rel) !== entry.installedSha256) errors.push(`invalid or missing checksum for ${name} ${key}`); if (entry?.version !== engineManifest.engines?.[name]?.version) errors.push(`engine metadata version mismatch for ${name} ${key}`) }
  }
  const sidecar = join(base, '_internal'); const plugin = join(provider, 'yt_dlp_plugins'); const providerBin = join(provider, 'bgutil-provider')
  const sidecarEntry = metadata.architectures?.[key]?.['yt-dlp-sidecar']; const pluginEntry = metadata.architectures?.[key]?.['bgutil-plugin']; const providerEntry = metadata.architectures?.[key]?.['bgutil-provider']
  if (providerEntry?.version !== engineManifest.engines?.['bgutil-provider']?.version) errors.push(`bgutil-provider metadata version mismatch for ${key}: ${providerEntry?.version || '(missing)'} != ${engineManifest.engines?.['bgutil-provider']?.version || '(manifest missing)'}`)
  if (pluginEntry?.version !== engineManifest.engines?.['bgutil-provider']?.plugin?.version) errors.push(`bgutil-plugin metadata version mismatch for ${key}: ${pluginEntry?.version || '(missing)'} != ${engineManifest.engines?.['bgutil-provider']?.plugin?.version || '(manifest missing)'}`)
  if (!existsSync(join(sidecar, 'Python')) || !sidecarEntry?.installedSha256 || treeHash(sidecar) !== sidecarEntry.installedSha256 || sums.get(`resources/engines/${key}/_internal`) !== sidecarEntry.installedSha256) errors.push(`invalid or missing yt-dlp sidecar checksum for ${key}`)
  if (!existsSync(providerBin) || !providerEntry?.installedSha256 || hashFile(providerBin) !== providerEntry.installedSha256 || sums.get(`resources/engines/po-token/${key}/bgutil-provider`) !== providerEntry.installedSha256) errors.push(`invalid or missing provider checksum for ${key}`)
  if (!existsSync(plugin) || !pluginEntry?.installedSha256 || treeHash(plugin) !== pluginEntry.installedSha256 || sums.get(`resources/engines/po-token/${key}/yt_dlp_plugins`) !== pluginEntry.installedSha256) errors.push(`invalid or missing provider plugin checksum for ${key}`)
}
if (pkg.version !== extension.version) errors.push(`extension version ${extension.version} != app version ${pkg.version}`)

const envOrConfig = (env, path) => process.env[env] || path.split('.').reduce((v, k) => v?.[k], config)
if (!/^[a-p]{32}$/.test(envOrConfig('CHROME_EXTENSION_ID', 'chrome.extensionId') || '')) errors.push('missing/invalid stable Chrome Web Store extension ID')
const provider = envOrConfig('PUBLISH_PROVIDER', 'updater.provider'); const updateMetadata = envOrConfig('RELEASE_UPDATE_METADATA', 'updater.metadata')
const updaterImplemented = existsSync(join(root, 'src/main/updater.ts')) && Boolean(pkg.dependencies?.['electron-updater'])
const updaterMock = dryRun && process.env.RELEASE_UPDATER_MOCK === '1'
if (!updaterImplemented && !updaterMock) errors.push('automatic updater implementation is absent; provider metadata alone is not sufficient')
if (!provider || !updateMetadata) errors.push('automatic updater provider/publish metadata is missing')
else { try { const u = JSON.parse(readFileSync(resolve(root, updateMetadata), 'utf8')); if (u.version !== pkg.version || u.provider !== provider) errors.push('invalid updater publish metadata or version mismatch') } catch { errors.push('updater publish metadata is not readable JSON') } }

function artifactTarget(artifact) {
  const type = extname(artifact).toLowerCase()
  if (!['.app', '.dmg', '.zip'].includes(type)) { errors.push(`unsupported artifact type ${type || '(none)'}; expected .app, .dmg, or .zip`); return null }
  if (dryRun && process.env.RELEASE_ARTIFACT_ARCH) return { architectureText: process.env.RELEASE_ARTIFACT_ARCH, app: null, verificationTarget: null, cleanup: () => {} }
  let dir = null; let mounted = false
  try {
    if (type === '.app') dir = artifact
    else { dir = mkdtempSync(join(tmpdir(), `v-download-release-${type.slice(1)}-`)); if (type === '.zip') execFileSync('ditto', ['-x', '-k', artifact, dir], { stdio: 'pipe' }); else { execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', dir, artifact], { stdio: 'pipe' }); mounted = true } }
    const app = type === '.app' ? artifact : execFileSync('find', [dir, '-name', '*.app', '-type', 'd', '-print', '-quit'], { encoding: 'utf8' }).trim()
    if (!app || !existsSync(join(app, 'Contents', 'Info.plist'))) throw new Error(`${type} contains no identifiable app bundle`)
    const executableName = basename(app, '.app'); const executable = join(app, 'Contents', 'MacOS', executableName)
    if (!existsSync(executable)) throw new Error(`app main executable missing: ${executable}`)
    return { architectureText: execFileSync('file', ['-b', executable], { encoding: 'utf8' }), app, executable, verificationTarget: app, staplerTarget: type === '.dmg' ? artifact : app, cleanup: () => { if (mounted) { try { execFileSync('hdiutil', ['detach', dir], { stdio: 'pipe' }) } catch {} } if (type !== '.app') rmSync(dir, { recursive: true, force: true }) } }
  } catch { if (mounted) { try { execFileSync('hdiutil', ['detach', dir], { stdio: 'pipe' }) } catch {} } if (dir && type !== '.app') rmSync(dir, { recursive: true, force: true }); errors.push(`could not identify app bundle/main executable inside ${type} artifact`); return null }
}
function architectureMatches(text, arch) { return arch === 'arm64' ? /arm64|Apple silicon/i.test(text) : /x86_64|Intel 64/i.test(text) }
function validatePackagedNativeModule(target, arch) {
  const native = join(target.app, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
  if (!existsSync(native)) { errors.push(`packaged better_sqlite3.node is missing for darwin-${arch}`); return }
  try { const description = execFileSync('file', ['-b', native], { encoding: 'utf8' }); if (!architectureMatches(description, arch)) errors.push(`packaged better_sqlite3.node architecture does not match darwin-${arch}: ${description.trim()}`) } catch { errors.push(`could not inspect packaged better_sqlite3.node for darwin-${arch}`) }
}
const artifact = process.env.RELEASE_ARTIFACT
if (!artifact && !dryRun) errors.push('RELEASE_ARTIFACT must identify the packaged .app/.dmg/.zip')
const target = artifact ? artifactTarget(artifact) : null
if (target) for (const a of arches) if (!architectureMatches(target.architectureText, a)) errors.push(`artifact architecture does not match requested darwin-${a}`)
if (target?.app) for (const a of arches) validatePackagedNativeModule(target, a)
if (dryRun) {
  warn.push('DRY RUN: Apple signing/notarization and publication commands were not claimed or executed')
  if (process.env.RELEASE_NOTARY_INFO_JSON) { try { if (JSON.parse(process.env.RELEASE_NOTARY_INFO_JSON).status !== 'Accepted') errors.push('mock notarytool status was not Accepted') } catch { errors.push('mock notarytool JSON was invalid') } }
}
else {
  if (!process.env.CSC_NAME && !process.env.CSC_LINK) errors.push('Developer ID signing is not configured')
  if (artifact && target?.verificationTarget) {
    try { execFileSync('codesign', ['--verify', '--deep', '--strict', target.verificationTarget], { stdio: 'pipe' }) } catch { errors.push('app bundle failed codesign --verify --deep --strict') }
    try { execFileSync('spctl', ['-a', '-t', 'open', '--context', 'context:primary-signature', target.verificationTarget], { stdio: 'pipe' }) } catch { errors.push('app bundle failed Gatekeeper spctl assessment') }
    const profile = process.env.APPLE_KEYCHAIN_PROFILE; const hasEnv = process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID
    if (!profile && !hasEnv) errors.push('notarization credentials must come from CI variables or an Apple keychain profile')
    if (!process.env.RELEASE_NOTARY_SUBMISSION_ID) errors.push('RELEASE_NOTARY_SUBMISSION_ID is required')
    else { try { const args = ['notarytool', 'info', process.env.RELEASE_NOTARY_SUBMISSION_ID, '--output-format', 'json']; if (profile) args.push('--keychain-profile', profile); const result = JSON.parse(execFileSync('xcrun', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); if (result.status !== 'Accepted') throw new Error('not accepted'); execFileSync('xcrun', ['stapler', 'validate', target.staplerTarget], { stdio: 'pipe' }) } catch { errors.push('notarytool status was not Accepted or stapler validation failed') } }
  }
}
if (target?.cleanup) target.cleanup()
if (errors.length) { console.error('RELEASE VERIFICATION FAILED'); errors.forEach((e) => console.error(`- ${e}`)); process.exit(1) }
warn.forEach((w) => console.warn(w)); console.log(`Release gate passed in ${dryRun ? 'mock/dry-run mode (not a release claim)' : 'verified mode'} for darwin-${arches.join(', darwin-')}`)
