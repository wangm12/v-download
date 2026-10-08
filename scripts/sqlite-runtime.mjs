import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

export const SUPPORTED_ELECTRON_VERSION = '43.7.5'
export const SUPPORTED_SQLITE_VERSION = '13.0.3'

export function getSqlitePrebuildPath(packageDirectory, platform, arch) {
  if (!['darwin', 'linux', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch)) {
    throw new Error(`unsupported better-sqlite3 target ${platform}-${arch}`)
  }
  return join(packageDirectory, 'prebuilds', `${platform}-${arch}.node`)
}

function architectureMatches(description, platform, arch) {
  if (platform === 'darwin') return arch === 'arm64' ? /arm64|Apple silicon/i.test(description) : /x86_64|Intel 64/i.test(description)
  if (platform === 'linux') return arch === 'arm64' ? /aarch64|ARM64/i.test(description) : /x86-64|x86_64/i.test(description)
  if (platform === 'win32') return arch === 'arm64' ? /ARM64|AArch64/i.test(description) : /x86-64|x86_64|AMD64/i.test(description)
  return false
}

export function verifySqlitePrebuild(packageDirectory, platform, arch, { label = 'better-sqlite3' } = {}) {
  const packageJsonPath = join(packageDirectory, 'package.json')
  if (existsSync(packageJsonPath)) {
    const packageVersion = JSON.parse(readFileSync(packageJsonPath, 'utf8')).version
    if (packageVersion !== SUPPORTED_SQLITE_VERSION) {
      throw new Error(`${label} ${SUPPORTED_SQLITE_VERSION} is required; found ${packageVersion || '(unknown)'}`)
    }
  }
  const prebuild = getSqlitePrebuildPath(packageDirectory, platform, arch)
  if (!existsSync(prebuild)) throw new Error(`${label} N-API prebuild is missing: ${prebuild}`)

  if (platform === 'win32') return prebuild
  const result = spawnSync('file', ['-b', prebuild], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error || result.status !== 0) {
    throw new Error(`could not inspect ${label} N-API prebuild for ${platform}-${arch}`)
  }
  const description = `${result.stdout || ''}${result.stderr || ''}`.trim()
  if (!architectureMatches(description, platform, arch)) {
    throw new Error(`${label} N-API prebuild architecture does not match ${platform}-${arch}: ${description}`)
  }
  return prebuild
}

export function verifyCurrentNodeSqlite(root) {
  const napiVersion = Number(process.versions.napi || 0)
  if (napiVersion < 10) {
    throw new Error(`Node N-API 10 or newer is required by better-sqlite3 ${SUPPORTED_SQLITE_VERSION}; found ${process.versions.napi || 'unavailable'}`)
  }
  const requireFromRoot = createRequire(join(root, 'package.json'))
  const sqliteEntry = requireFromRoot.resolve('better-sqlite3')
  const packageDirectory = dirname(dirname(sqliteEntry))
  const expected = verifySqlitePrebuild(packageDirectory, process.platform, process.arch)
  const binding = requireFromRoot(join(dirname(sqliteEntry), 'binding.js'))
  const selected = binding.getPrebuildPath()
  if (selected !== expected) {
    throw new Error(`better-sqlite3 loader selected ${selected || '(no prebuild)'} instead of ${expected}`)
  }
  const Database = requireFromRoot('better-sqlite3')
  const db = new Database(':memory:')
  try {
    const row = db.prepare('SELECT 1 AS value').get()
    if (row?.value !== 1) throw new Error('SQLite N-API prebuild returned an unexpected result')
  } finally {
    db.close()
  }
  return expected
}

export function verifyElectronInstall(root, platform = process.platform, arch = process.arch) {
  const requireFromRoot = createRequire(join(root, 'package.json'))
  const electronPackage = requireFromRoot('electron/package.json')
  if (electronPackage.version !== SUPPORTED_ELECTRON_VERSION) {
    throw new Error(`Electron ${SUPPORTED_ELECTRON_VERSION} is required; found ${electronPackage.version}`)
  }
  const binary = requireFromRoot('electron')
  if (typeof binary !== 'string' || !existsSync(binary)) {
    throw new Error(`Electron ${electronPackage.version} executable is not installed; run node node_modules/electron/install.js`)
  }
  if (platform === 'win32') return binary
  const result = spawnSync('file', ['-b', binary], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error || result.status !== 0) throw new Error(`could not inspect Electron ${electronPackage.version} executable`)
  const description = `${result.stdout || ''}${result.stderr || ''}`.trim()
  if (!architectureMatches(description, platform, arch)) {
    throw new Error(`Electron ${electronPackage.version} executable architecture does not match ${platform}-${arch}: ${description}`)
  }
  return binary
}

export function runElectronInstall(root, platform = process.platform, arch = process.arch) {
  const installer = join(root, 'node_modules', 'electron', 'install.js')
  if (!existsSync(installer)) throw new Error(`Electron installer is missing: ${installer}`)
  const env = {
    ...process.env,
    ELECTRON_INSTALL_PLATFORM: platform,
    ELECTRON_INSTALL_ARCH: arch,
  }
  // Electron's macOS installer checks Rosetta and may rewrite x64 to arm64
  // unless npm_config_arch is explicit. Keep the selected host architecture.
  if (platform === 'darwin') env.npm_config_arch = arch
  const result = spawnSync(process.execPath, [installer], { cwd: root, env, stdio: 'inherit' })
  if (result.error) throw new Error(`Electron ${platform}-${arch} installation failed: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`Electron ${platform}-${arch} installation failed with status ${result.status ?? 'unknown'}`)
  return verifyElectronInstall(root, platform, arch)
}
