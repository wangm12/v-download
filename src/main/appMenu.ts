import type { MenuItemConstructorOptions } from 'electron'

export const APP_HELP_URL = 'https://github.com/wangm12/v-download#readme'
export const APP_REPO_URL = 'https://github.com/wangm12/v-download'

export interface AppMenuHandlers {
  openSettings: () => void
  openUrls: () => void
  clearDownloads: () => void
  findDownloads: () => void
  refreshDownloads: () => void
  openHelp: () => void
  openRepository: () => void
}

export function buildApplicationMenuTemplate(
  appName: string,
  handlers: AppMenuHandlers
): MenuItemConstructorOptions[] {
  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => handlers.openSettings()
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open URLs…',
          accelerator: 'CmdOrCtrl+O',
          click: () => handlers.openUrls()
        },
        { type: 'separator' },
        {
          label: 'Clear Finished Downloads',
          click: () => handlers.clearDownloads()
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find Downloads',
          accelerator: 'CmdOrCtrl+F',
          click: () => handlers.findDownloads()
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Refresh Downloads',
          accelerator: 'CmdOrCtrl+R',
          click: () => handlers.refreshDownloads()
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'V-Download Help',
          click: () => handlers.openHelp()
        },
        { type: 'separator' },
        {
          label: 'GitHub Repository',
          click: () => handlers.openRepository()
        }
      ]
    }
  ]
}
