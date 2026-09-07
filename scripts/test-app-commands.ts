import assert from 'node:assert/strict'
import {
  APP_COMMANDS,
  getAppCommand,
  runAppCommand
} from '../src/main/appCommands.ts'
import {
  COMPACT_HASH,
  COMPACT_WINDOW_TITLE,
  compactLoadHash,
  isCompactUtilityWindow
} from '../src/main/compactWindow.ts'

const REQUIRED_IDS = [
  'open-urls',
  'preferences',
  'find-downloads',
  'refresh-downloads',
  'pause-all',
  'resume-all',
  'clear-finished',
  'compact-window',
  'quit'
] as const

const catalogIds = APP_COMMANDS.map((command) => command.id)
for (const id of REQUIRED_IDS) {
  assert.ok(catalogIds.includes(id), `missing command ${id}`)
}

const openUrls = getAppCommand('open-urls')
assert.equal(openUrls.label, 'Open URLs…')
assert.equal(openUrls.accelerator, 'CmdOrCtrl+O')
assert.equal(openUrls.channel, 'open-urls')
assert.equal(openUrls.kind, 'renderer-event')

const preferences = getAppCommand('preferences')
assert.equal(preferences.label, 'Settings…')
assert.equal(preferences.accelerator, 'CmdOrCtrl+,')
assert.equal(preferences.channel, 'open-preferences')
assert.equal(preferences.kind, 'renderer-event')

const findDownloads = getAppCommand('find-downloads')
assert.equal(findDownloads.label, 'Find Downloads')
assert.equal(findDownloads.accelerator, 'CmdOrCtrl+F')
assert.equal(findDownloads.channel, 'focus-download-search')
assert.equal(findDownloads.kind, 'renderer-event')

const refreshDownloads = getAppCommand('refresh-downloads')
assert.equal(refreshDownloads.label, 'Refresh Downloads')
assert.equal(refreshDownloads.accelerator, 'CmdOrCtrl+R')
assert.equal(refreshDownloads.channel, 'refresh-downloads')
assert.equal(refreshDownloads.kind, 'renderer-event')

const pauseAll = getAppCommand('pause-all')
assert.equal(pauseAll.label, 'Pause All')
assert.equal(pauseAll.kind, 'main-action')
assert.equal(pauseAll.channel, undefined)

const resumeAll = getAppCommand('resume-all')
assert.equal(resumeAll.label, 'Resume All')
assert.equal(resumeAll.kind, 'main-action')
assert.equal(resumeAll.channel, undefined)

const clearFinished = getAppCommand('clear-finished')
assert.equal(clearFinished.label, 'Clear Finished Downloads')
assert.equal(clearFinished.channel, 'open-clear-downloads')
assert.equal(clearFinished.kind, 'renderer-event')

const compactWindow = getAppCommand('compact-window')
assert.equal(compactWindow.label, 'Compact Window')
assert.equal(compactWindow.kind, 'main-action')
assert.equal(compactWindow.channel, undefined)

const quit = getAppCommand('quit')
assert.equal(quit.kind, 'role')
assert.equal(quit.role, 'quit')

const catalogText = JSON.stringify(APP_COMMANDS).toLowerCase()
assert.ok(!catalogText.includes('torrent'), 'catalog must not mention torrent')
assert.ok(!catalogText.includes('magnet'), 'catalog must not mention magnet')

const sent: string[] = []
let paused = 0
let resumed = 0
let compactOpened = 0
const actions = {
  sendToRenderer: (channel: string): void => {
    sent.push(channel)
  },
  pauseAll: (): void => {
    paused += 1
  },
  resumeAll: (): void => {
    resumed += 1
  },
  openCompactWindow: (): void => {
    compactOpened += 1
  },
  quit: (): void => undefined
}

runAppCommand('preferences', actions)
runAppCommand('open-urls', actions)
runAppCommand('find-downloads', actions)
runAppCommand('refresh-downloads', actions)
runAppCommand('clear-finished', actions)
assert.deepEqual(sent, [
  'open-preferences',
  'open-urls',
  'focus-download-search',
  'refresh-downloads',
  'open-clear-downloads'
])

runAppCommand('pause-all', actions)
runAppCommand('resume-all', actions)
runAppCommand('compact-window', actions)
assert.equal(paused, 1, 'pause-all must call the main-process action')
assert.equal(resumed, 1, 'resume-all must call the main-process action')
assert.equal(compactOpened, 1, 'compact-window must open the mini window')
assert.deepEqual(
  sent,
  [
    'open-preferences',
    'open-urls',
    'focus-download-search',
    'refresh-downloads',
    'open-clear-downloads'
  ],
  'pause/resume must not send renderer events'
)

assert.equal(compactLoadHash(), '#/compact')
assert.equal(COMPACT_HASH, '#/compact')
assert.equal(COMPACT_WINDOW_TITLE, 'V-Download Mini')
assert.equal(isCompactUtilityWindow(), true)

console.log('app-commands catalog ok')
