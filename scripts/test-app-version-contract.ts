import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const mainWindowIpc = read('src/main/ipc/window.ts')
const preload = read('src/preload/index.ts')
const preloadTypes = read('src/preload/index.d.ts')
const renderer = read('src/renderer/src/components/PreferencesPanel.tsx')

if (!mainWindowIpc.includes("ipcMain.handle('get-app-version', () => app.getVersion())")) {
  throw new Error('app version IPC must return Electron app.getVersion()')
}
if (!preload.includes("getAppVersion: () => ipcRenderer.invoke('get-app-version')")) {
  throw new Error('preload must expose the app version IPC contract')
}
if (!preloadTypes.includes('getAppVersion: () => Promise<string>')) {
  throw new Error('preload type contract must include getAppVersion')
}
if (
  !renderer.includes('window.api.getAppVersion()') ||
  !renderer.includes('.catch(() => setAppVersion(null))') ||
  !renderer.includes("appVersion ?? '—'") ||
  renderer.includes('>1.0.0</p>')
) {
  throw new Error('Advanced preferences version must use the runtime API, not a hardcoded version')
}

console.log('app version contract passed')
