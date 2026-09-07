import assert from 'node:assert/strict'
import {
  INTEGRATION_BOOLEAN_DEFAULTS,
  validateSettingUpdate
} from '../src/main/settingsIntegration.ts'
import { syncLoginItem } from '../src/main/loginItem.ts'

assert.equal(INTEGRATION_BOOLEAN_DEFAULTS.launchAtStartup, false)
assert.equal(INTEGRATION_BOOLEAN_DEFAULTS.notifyOnComplete, true)
assert.equal(INTEGRATION_BOOLEAN_DEFAULTS.notifyOnError, true)
assert.equal(INTEGRATION_BOOLEAN_DEFAULTS.warnBeforeQuit, true)
assert.equal(INTEGRATION_BOOLEAN_DEFAULTS.showTray, true)

for (const key of Object.keys(INTEGRATION_BOOLEAN_DEFAULTS)) {
  assert.equal(validateSettingUpdate(key, true), true, `${key} must accept true`)
  assert.equal(validateSettingUpdate(key, false), true, `${key} must accept false`)
  assert.equal(validateSettingUpdate(key, 'true'), false, `${key} must reject string`)
  assert.equal(validateSettingUpdate(key, 1), false, `${key} must reject number`)
  assert.equal(validateSettingUpdate(key, null), false, `${key} must reject null`)
  assert.equal(validateSettingUpdate(key, undefined), false, `${key} must reject undefined`)
}

assert.equal(validateSettingUpdate('proxyUrl', ''), true)
assert.equal(validateSettingUpdate('proxyUrl', '   '), true)
assert.equal(validateSettingUpdate('proxyUrl', 'http://127.0.0.1:8080'), true)
assert.equal(validateSettingUpdate('proxyUrl', 'http://user:pass@127.0.0.1:8080'), false)
assert.equal(validateSettingUpdate('proxyUrl', 'ftp://127.0.0.1:21'), false)

const calls: Array<{ openAtLogin: boolean }> = []
syncLoginItem(true, (value) => {
  calls.push(value)
})
assert.deepEqual(calls, [{ openAtLogin: true }])

syncLoginItem(false, (value) => {
  calls.push(value)
})
assert.deepEqual(calls[1], { openAtLogin: false })

assert.doesNotThrow(() => {
  syncLoginItem(true)
  syncLoginItem(false, undefined)
  syncLoginItem(true, () => {
    throw new Error('unavailable')
  })
})

console.log('settings-integration tests passed')
