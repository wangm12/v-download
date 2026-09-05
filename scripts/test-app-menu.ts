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

const template = buildApplicationMenuTemplate('V-Download', {
  openSettings: noop,
  openUrls: noop,
  clearDownloads: noop,
  findDownloads: noop,
  refreshDownloads: noop,
  openHelp: noop,
  openRepository: noop
})

assert.deepEqual(
  labels(template),
  ['V-Download', 'File', 'Edit', 'View', 'Window', 'Help']
)

const appMenu = labels(submenu(template, 'V-Download'))
assert.ok(appMenu.includes('Settings…'), 'Settings stays under the app menu')

const fileMenu = labels(submenu(template, 'File'))
assert.ok(fileMenu.includes('Open URLs…'))
assert.ok(fileMenu.includes('Clear Finished Downloads'))

const editMenu = labels(submenu(template, 'Edit'))
assert.ok(editMenu.includes('Find Downloads'))
assert.ok(editMenu.includes('paste') || editMenu.includes('Paste'))

const viewMenu = labels(submenu(template, 'View'))
assert.ok(viewMenu.includes('Refresh Downloads'))
assert.ok(!viewMenu.includes('Find Downloads'), 'Find belongs in Edit')

const helpMenu = labels(submenu(template, 'Help'))
assert.ok(helpMenu.includes('V-Download Help'))
assert.ok(helpMenu.includes('GitHub Repository'))

console.log('app-menu contract ok')
