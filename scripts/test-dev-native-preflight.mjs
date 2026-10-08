import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getPreflightPlan, getRestorePlan } from './dev-native-preflight.mjs'
import { getDevPlan, isIgnorableKillError } from './dev.mjs'
import { getSqlitePrebuildPath, verifyCurrentNodeSqlite, verifyElectronInstall } from './sqlite-runtime.mjs'

const plan = getPreflightPlan()
assert.match(plan.electronVersion, /^\d+\.\d+\.\d+$/)
assert.equal(plan.command, process.execPath)
assert.deepEqual(plan.args, [resolve('node_modules/electron/install.js')])
assert.equal(plan.sqliteVersion, '13.0.3')
assert.equal(plan.sqlitePrebuild, getSqlitePrebuildPath(resolve('node_modules/better-sqlite3'), process.platform, process.arch))

const restorePlan = getRestorePlan()
assert.equal(restorePlan.arch, process.arch)
assert.equal(restorePlan.platform, process.platform)
assert.equal(restorePlan.sqlitePrebuild, plan.sqlitePrebuild)
assert.equal(verifyCurrentNodeSqlite(process.cwd()), plan.sqlitePrebuild)
assert.ok(verifyElectronInstall(process.cwd()))

const devPlan = getDevPlan()
assert.ok(devPlan.command.endsWith('/node_modules/.bin/electron-vite'))
assert.deepEqual(devPlan.args, ['dev'])
assert.equal(isIgnorableKillError({ code: 'ESRCH' }), true)
assert.equal(isIgnorableKillError({ code: 'EPERM' }), true)
assert.equal(isIgnorableKillError({ code: 'EACCES' }), true)
assert.equal(isIgnorableKillError({ code: 'EIO' }), false)

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
assert.equal(
  pkg.scripts.pretest,
  'node scripts/dev-native-preflight.mjs --restore',
  'npm test must verify the host Node and Electron N-API prebuilds'
)
const preflightSource = readFileSync(new URL('./dev-native-preflight.mjs', import.meta.url), 'utf8')
assert.match(preflightSource, /process\.argv\.includes\('--restore'\)/)
assert.match(preflightSource, /runRestore\(\)/)

console.log('dev native preflight and restore contract passed')
