import assert from 'node:assert/strict'
import { parseTaskDeepLink, shouldNotifyOs } from '../src/main/taskNotify.ts'

const uuid = '550e8400-e29b-41d4-a716-446655440000'
const unfocused = {
  notifyOnComplete: true,
  notifyOnError: true,
  windowFocused: false
}

assert.equal(
  shouldNotifyOs({ ...unfocused, status: 'complete' }),
  true,
  'complete + notifyOnComplete + unfocused → true'
)
assert.equal(
  shouldNotifyOs({ ...unfocused, status: 'complete', windowFocused: true }),
  false,
  'complete + focused → false'
)
assert.equal(
  shouldNotifyOs({ ...unfocused, status: 'complete', notifyOnComplete: false }),
  false,
  'complete + notifyOnComplete false → false'
)
assert.equal(
  shouldNotifyOs({ ...unfocused, status: 'error' }),
  true,
  'error + notifyOnError + unfocused → true'
)
assert.equal(
  shouldNotifyOs({ ...unfocused, status: 'error', notifyOnError: false }),
  false,
  'error + notifyOnError false → false'
)

for (const status of ['paused', 'cancelled', 'interrupted', 'queued', 'resolving', 'ready']) {
  assert.equal(
    shouldNotifyOs({ ...unfocused, status }),
    false,
    `${status} must not notify`
  )
}

assert.equal(parseTaskDeepLink(`vdownload://task/${uuid}`), uuid)
assert.equal(parseTaskDeepLink('vdownload://wake'), null)
assert.equal(parseTaskDeepLink('ytdl://download?url=https://example.com/watch?v=1'), null)
assert.equal(parseTaskDeepLink('vdownload://task/../etc'), null)
assert.equal(parseTaskDeepLink('vdownload://task/'), null)
assert.equal(parseTaskDeepLink('vdownload://task'), null)
assert.equal(parseTaskDeepLink('vdownload://task/not-a-uuid'), null)
assert.equal(parseTaskDeepLink(`vdownload://evil.host/task/${uuid}`), null)
assert.equal(parseTaskDeepLink('javascript:alert(1)'), null)

console.log('task-notify tests passed')
