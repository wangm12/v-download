import { ipcMain } from 'electron'
import {
  beginNativeAuth,
  clearNativeAuth,
  listNativeAuthAccounts,
  nativeAuthSites,
  type NativeAuthSite
} from '../nativeAuth'

const sites = new Set(nativeAuthSites())

export function registerNativeAuthHandlers(): void {
  ipcMain.handle('get-native-auth-accounts', () => ({ data: listNativeAuthAccounts() }))

  ipcMain.handle('start-native-auth', async (event, site: string) => {
    if (!sites.has(site as NativeAuthSite)) return { ok: false, error: 'Unsupported account site' }
    const result = beginNativeAuth(site as NativeAuthSite, (authEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send('native-auth-event', authEvent)
    })
    return result
  })

  ipcMain.handle('clear-native-auth', async (_event, site: string) => {
    if (!sites.has(site as NativeAuthSite)) return { ok: false, error: 'Unsupported account site' }
    return clearNativeAuth(site as NativeAuthSite)
  })
}
