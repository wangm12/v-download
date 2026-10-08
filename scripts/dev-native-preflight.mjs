import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getSqlitePrebuildPath,
  runElectronInstall,
  verifyCurrentNodeSqlite,
  verifyElectronInstall,
} from './sqlite-runtime.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const electronPackage = resolve(root, 'node_modules/electron/package.json')
const sqlitePackage = resolve(root, 'node_modules/better-sqlite3/package.json')

function installedPackageVersion(path, name) {
  if (!existsSync(path)) throw new Error(`${name} is not installed: ${path}`)
  return JSON.parse(readFileSync(path, 'utf8')).version
}

export function getPreflightPlan() {
  const electronVersion = installedPackageVersion(electronPackage, 'Electron')
  const sqliteVersion = installedPackageVersion(sqlitePackage, 'better-sqlite3')
  return {
    command: process.execPath,
    args: [resolve(root, 'node_modules/electron/install.js')],
    electronVersion,
    sqliteVersion,
    sqlitePrebuild: getSqlitePrebuildPath(sqlitePackage.replace(/[/\\]package\.json$/, ''), process.platform, process.arch),
  }
}

export function runPreflight() {
  const plan = getPreflightPlan()
  if (!/^13\./.test(plan.sqliteVersion)) {
    throw new Error(`better-sqlite3 13.x is required for the N-API runtime; found ${plan.sqliteVersion}`)
  }
  console.log(`Installing/verifying Electron ${plan.electronVersion} for ${process.platform}-${process.arch}`)
  runElectronInstall(root)
  const binding = verifyCurrentNodeSqlite(root)
  console.log(`Verified better-sqlite3 ${plan.sqliteVersion} N-API prebuild: ${binding}`)
}

export function getRestorePlan() {
  return {
    platform: process.platform,
    arch: process.arch,
    sqlitePrebuild: getSqlitePrebuildPath(sqlitePackage.replace(/[/\\]package\.json$/, ''), process.platform, process.arch),
  }
}

export function runRestore() {
  const plan = getRestorePlan()
  const binding = verifyCurrentNodeSqlite(root)
  verifyElectronInstall(root, plan.platform, plan.arch)
  console.log(`Verified host Node and Electron N-API bindings for ${plan.platform}-${plan.arch}: ${binding}`)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain && process.argv.includes('--check')) {
  const plan = getPreflightPlan()
  console.log(JSON.stringify(plan))
} else if (isMain && process.argv.includes('--restore')) {
  try {
    runRestore()
  } catch (error) {
    console.error(`HOST NATIVE VERIFICATION BLOCKED: ${error.message}`)
    process.exitCode = 1
  }
} else if (isMain) {
  try {
    runPreflight()
  } catch (error) {
    console.error(`DEV PREFLIGHT BLOCKED: ${error.message}`)
    process.exitCode = 1
  }
}
