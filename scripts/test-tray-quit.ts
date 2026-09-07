import assert from 'node:assert/strict'
import type { Menu, MenuItemConstructorOptions } from 'electron'
import { runAppCommand } from '../src/main/appCommands.ts'
import { shouldWarnBeforeQuit } from '../src/main/quitGuard.ts'
import { buildTrayMenuTemplate, configureTray, syncTray } from '../src/main/tray.ts'

function labelsOf(items: MenuItemConstructorOptions[]): string[] {
  return items
    .filter((item) => item.type !== 'separator')
    .map((item) => (typeof item.label === 'string' ? item.label : ''))
}

const clicks = {
  show: 0,
  openUrls: 0,
  pauseAll: 0,
  resumeAll: 0,
  preferences: 0,
  quit: 0
}

const template = buildTrayMenuTemplate({
  show: () => {
    clicks.show += 1
  },
  openUrls: () => {
    clicks.openUrls += 1
  },
  pauseAll: () => {
    clicks.pauseAll += 1
  },
  resumeAll: () => {
    clicks.resumeAll += 1
  },
  preferences: () => {
    clicks.preferences += 1
  },
  quit: () => {
    clicks.quit += 1
  }
})

assert.deepEqual(labelsOf(template), [
  'Show',
  'Open URLs…',
  'Pause All',
  'Resume All',
  'Settings…',
  'Quit'
])
assert.equal(template[5]?.type, 'separator')

const serialized = JSON.stringify(template).toLowerCase()
assert.ok(!serialized.includes('torrent'), 'tray must not mention torrent')
assert.ok(!serialized.includes('magnet'), 'tray must not mention magnet')
assert.ok(!serialized.includes('speedometer'), 'tray must not mention speedometer')

const quitItem = template.find((item) => item.label === 'Quit')
assert.ok(quitItem, 'missing Quit')
assert.equal(typeof quitItem.click, 'function', 'Quit must invoke an action, not only a role')
quitItem.click?.(undefined as never, undefined as never, undefined as never)
assert.equal(clicks.quit, 1, 'Quit click must call the injected handler')

assert.equal(
  shouldWarnBeforeQuit({ warnBeforeQuit: true, statuses: ['downloading'] }),
  true
)
assert.equal(
  shouldWarnBeforeQuit({ warnBeforeQuit: true, statuses: ['resolving'] }),
  true
)
assert.equal(
  shouldWarnBeforeQuit({ warnBeforeQuit: true, statuses: ['queued', 'downloading', 'paused'] }),
  true
)
assert.equal(
  shouldWarnBeforeQuit({ warnBeforeQuit: false, statuses: ['downloading'] }),
  false
)
assert.equal(
  shouldWarnBeforeQuit({ warnBeforeQuit: false, statuses: ['resolving'] }),
  false
)
assert.equal(
  shouldWarnBeforeQuit({ warnBeforeQuit: true, statuses: [] }),
  false
)

for (const status of ['paused', 'queued', 'interrupted', 'cancelled', 'complete', 'error']) {
  assert.equal(
    shouldWarnBeforeQuit({ warnBeforeQuit: true, statuses: [status] }),
    false,
    `${status} must not warn`
  )
}

let quitCalls = 0
runAppCommand('quit', {
  sendToRenderer: () => undefined,
  pauseAll: () => undefined,
  resumeAll: () => undefined,
  quit: () => {
    quitCalls += 1
  }
})
assert.equal(quitCalls, 1, "runAppCommand('quit') must invoke the injected quit action")

type FakeTray = {
  iconPath: string
  tooltip: string
  destroyed: boolean
  setToolTip: (text: string) => void
  setContextMenu: (menu: unknown) => void
  on: (event: string, listener: () => void) => void
  destroy: () => void
}

const created: FakeTray[] = []
configureTray({
  createTray: (iconPath) => {
    const handle: FakeTray = {
      iconPath,
      tooltip: '',
      destroyed: false,
      setToolTip(text) {
        handle.tooltip = text
      },
      setContextMenu(_menu: Menu | null) {
        return undefined
      },
      on() {
        return undefined
      },
      destroy() {
        handle.destroyed = true
      }
    }
    created.push(handle)
    return handle
  },
  buildMenu: (items) => items as unknown as Menu,
  showWindow: () => undefined,
  runCommand: () => undefined
})

syncTray(true)
assert.equal(created.length, 1)
assert.match(created[0].iconPath, /resources\/icon\.png$/)
assert.equal(created[0].tooltip, 'V-Download')
syncTray(true)
assert.equal(created.length, 1, 'already-visible tray must not be constructed twice')
syncTray(false)
assert.equal(created[0].destroyed, true)
syncTray(false)
assert.equal(created.length, 1, 'hiding when already gone is a no-op')
syncTray(true)
assert.equal(created.length, 2)

console.log('tray-quit tests passed')
