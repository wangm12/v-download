import assert from 'node:assert/strict'
import type { MenuItemConstructorOptions } from 'electron'
import { buildApplicationMenuTemplate } from '../src/main/appMenu.ts'

const noop = (): void => undefined

function labels(items: MenuItemConstructorOptions[] | undefined): string[] {
  return (items ?? [])
    .map((item) => (typeof item.label === 'string' ? item.label : typeof item.role === 'string' ? item.role : ''))
    .filter(Boolean)
}

function submenu(template: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] {
  const menu = template.find((item) => item.label === label)
  assert.ok(menu, `missing menu ${label}`)
  assert.ok(Array.isArray(menu.submenu), `${label} submenu`)
  return menu.submenu
}

function item(
  items: MenuItemConstructorOptions[],
  label: string
): MenuItemConstructorOptions {
  const found = items.find((entry) => entry.label === label)
  assert.ok(found, `missing item ${label}`)
  return found
}

const template = buildApplicationMenuTemplate('V-Download', {
  openSettings: noop,
  openUrls: noop,
  clearDownloads: noop,
  findDownloads: noop,
  refreshDownloads: noop,
  pauseAll: noop,
  resumeAll: noop,
  openCompactWindow: noop,
  openHelp: noop,
  openRepository: noop
})

assert.deepEqual(
  labels(template),
  ['V-Download', 'File', 'Edit', 'View', 'Window', 'Help']
)

const appItems = submenu(template, 'V-Download')
const appMenu = labels(appItems)
assert.ok(appMenu.includes('Settings…'), 'Settings stays under the app menu')
assert.ok(appMenu.includes('quit') || appMenu.includes('Quit'), 'Quit stays an Electron role')
assert.equal(item(appItems, 'Settings…').accelerator, 'CmdOrCtrl+,')

const fileItems = submenu(template, 'File')
const fileMenu = labels(fileItems)
assert.ok(fileMenu.includes('Open URLs…'))
assert.ok(fileMenu.includes('Clear Finished Downloads'))
assert.ok(fileMenu.includes('Pause All'), 'Pause All belongs in File')
assert.ok(fileMenu.includes('Resume All'), 'Resume All belongs in File')
assert.equal(item(fileItems, 'Open URLs…').accelerator, 'CmdOrCtrl+O')

const editItems = submenu(template, 'Edit')
const editMenu = labels(editItems)
assert.ok(editMenu.includes('Find Downloads'))
assert.ok(editMenu.includes('paste') || editMenu.includes('Paste'))
assert.equal(item(editItems, 'Find Downloads').accelerator, 'CmdOrCtrl+F')

const viewItems = submenu(template, 'View')
const viewMenu = labels(viewItems)
assert.ok(viewMenu.includes('Refresh Downloads'))
assert.ok(!viewMenu.includes('Find Downloads'), 'Find belongs in Edit')
assert.equal(item(viewItems, 'Refresh Downloads').accelerator, 'CmdOrCtrl+R')

const windowItems = submenu(template, 'Window')
const windowMenu = labels(windowItems)
assert.ok(windowMenu.includes('Compact Window'), 'Compact Window belongs in the Window menu')
assert.ok(!windowMenu.includes('Library'), 'Compact is not a sidebar nav')

const helpMenu = labels(submenu(template, 'Help'))
assert.ok(helpMenu.includes('V-Download Help'))
assert.ok(helpMenu.includes('GitHub Repository'))

const serialized = JSON.stringify(template).toLowerCase()
assert.ok(!serialized.includes('torrent'), 'menu must not mention torrent')
assert.ok(!serialized.includes('magnet'), 'menu must not mention magnet')

console.log('app-menu contract ok')
