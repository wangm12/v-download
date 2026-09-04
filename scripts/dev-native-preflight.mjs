import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(new URL('..', import.meta.url).pathname)
const electronPackage = resolve(root, 'node_modules/electron/package.json')
const rebuildCommand = resolve(root, 'node_modules/.bin/electron-rebuild')

export function getPreflightPlan() {
  if (!existsSync(electronPackage)) throw new Error(`Electron is not installed: ${electronPackage}`)
  if (!existsSync(rebuildCommand)) throw new Error(`electron-rebuild is not installed: ${rebuildCommand}`)
  const electronVersion = JSON.parse(readFileSync(electronPackage, 'utf8')).version
  return {
    command: rebuildCommand,
    args: ['--version', electronVersion, '--module-dir', root, '--force', '--only', 'better-sqlite3'],
    electronVersion,
  }
}

export function runPreflight() {
  const plan = getPreflightPlan()
  console.log(`Preparing better-sqlite3 for Electron ${plan.electronVersion} before starting dev`)
  const result = spawnSync(plan.command, plan.args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw new Error(`Electron native dependency preflight failed: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`Electron native dependency preflight failed with status ${result.status ?? 'unknown'}`)
  console.log(`Verified better-sqlite3 against Electron ${plan.electronVersion}`)
}

export function getRestorePlan() {
  const args = ['rebuild', 'better-sqlite3', `--arch=${process.arch}`, `--platform=${process.platform}`]
  const env = { ...process.env, npm_config_arch: process.arch, npm_config_platform: process.platform }
  delete env.npm_config_target
  delete env.npm_config_runtime
  return { command: 'npm', args, env }
}

export function runRestore() {
  const plan = getRestorePlan()
  console.log(`Restoring better-sqlite3 for host Node ${process.platform}-${process.arch}`)
  const result = spawnSync(plan.command, plan.args, { cwd: root, env: plan.env, stdio: 'inherit' })
  if (result.error) throw new Error(`Host native dependency restore failed: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`Host native dependency restore failed with status ${result.status ?? 'unknown'}`)
  console.log('Verified better-sqlite3 for host Node')
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)
if (isMain && process.argv.includes('--check')) {
  const plan = getPreflightPlan()
  console.log(JSON.stringify(plan))
} else if (isMain && process.argv.includes('--restore')) {
  try {
    runRestore()
  } catch (error) {
    console.error(`HOST NATIVE RESTORE BLOCKED: ${error.message}`)
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
