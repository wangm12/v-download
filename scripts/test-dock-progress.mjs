import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('src/main/dockProgress.ts', 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
function load(platform) {
  const events = []
  const windows = [0, 1].map((id) => ({ isDestroyed: () => false, setProgressBar: (ratio) => events.push(['progress', id, ratio]) }))
  windows.push({ isDestroyed: () => true, setProgressBar: () => assert.fail('destroyed window was updated') })
  const exports = {}
  vm.runInNewContext(compiled, {
    exports, process: { platform }, __dirname: resolve('out/main'),
    require: (name) => name === 'path' ? { join: (...parts) => parts.join('/') } : {
      app: { dock: { setIcon: () => events.push(['icon']), setBadge: (badge) => events.push(['badge', badge]) } },
      BrowserWindow: { getAllWindows: () => windows },
      nativeImage: { createFromPath: () => ({ isEmpty: () => false }) }
    }
  })
  return { dock: exports, events }
}
const { dock, events } = load('darwin')
dock.init()
assert.deepEqual(events.splice(0), [['icon'], ['badge', '']])
for (const [percent, count, ratio, badge] of [[35, 2, 0.35, '2'], [100, 99, 1, '99'], [135, 100, 1, '99+'], [-5, 0, 0, ''], [50, undefined, 0.5, '']]) {
  dock.updateProgress(percent, 99999999, count)
  assert.deepEqual(events.splice(0), [['progress', 0, ratio], ['progress', 1, ratio], ['badge', badge]])
}
dock.reset()
assert.deepEqual(events.splice(0), [['progress', 0, -1], ['progress', 1, -1], ['icon'], ['badge', '']])
for (const platform of ['win32', 'linux']) {
  const test = load(platform)
  test.dock.init()
  test.dock.updateProgress(25, 123, 100)
  test.dock.reset()
  assert.deepEqual(test.events, [['progress', 0, 0.25], ['progress', 1, 0.25], ['progress', 0, -1], ['progress', 1, -1]])
}
assert.doesNotMatch(source, /execFile|rsvg-convert|generateSvg|mkdtemp/, 'Dock must not run an image converter')
assert.ok(readFileSync('resources/icon.png').equals(readFileSync('src/renderer/public/app-icon.png')), 'Dock and app must use the same static icon')
console.log('Dock progress: native windows, static icon, badges, 99+, idle and platform behavior passed')
