import assert from 'node:assert/strict'
import { getPreflightPlan, getRestorePlan } from './dev-native-preflight.mjs'
import { getDevPlan } from './dev.mjs'

const plan = getPreflightPlan()
assert.match(plan.electronVersion, /^\d+\.\d+\.\d+$/)
assert.ok(plan.command.endsWith('/node_modules/.bin/electron-rebuild'))
assert.deepEqual(plan.args.slice(0, 2), ['--version', plan.electronVersion])
assert.deepEqual(plan.args.slice(2), ['--module-dir', process.cwd(), '--force', '--only', 'better-sqlite3'])

const restorePlan = getRestorePlan()
assert.equal(restorePlan.command, 'npm')
assert.deepEqual(restorePlan.args, ['rebuild', 'better-sqlite3', `--arch=${process.arch}`, `--platform=${process.platform}`])
assert.equal(restorePlan.env.npm_config_arch, process.arch)
assert.equal(restorePlan.env.npm_config_platform, process.platform)
assert.equal(restorePlan.env.npm_config_target, undefined)
assert.equal(restorePlan.env.npm_config_runtime, undefined)

const devPlan = getDevPlan()
assert.ok(devPlan.command.endsWith('/node_modules/.bin/electron-vite'))
assert.deepEqual(devPlan.args, ['dev'])
console.log('dev native preflight and restore contract passed')
