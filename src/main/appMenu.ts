import type { MenuItemConstructorOptions } from 'electron'
import { translate, type AppLanguage } from '../i18n/catalog'
import { getAppCommand, type AppCommandId } from './appCommands'

const COMMAND_I18N: Record<AppCommandId, string> = {
  'open-urls': 'menu.openUrls',
  preferences: 'menu.preferences',
  'find-downloads': 'menu.findDownloads',
  'refresh-downloads': 'menu.refreshDownloads',
  'pause-all': 'menu.pauseAll',
  'resume-all': 'menu.resumeAll',
  'clear-finished': 'menu.clearFinished',
  'compact-window': 'menu.compactWindow',
  quit: 'menu.quit'
}

export const APP_HELP_URL = 'https://github.com/wangm12/v-download#readme'
export const APP_REPO_URL = 'https://github.com/wangm12/v-download'

export interface AppMenuHandlers {
  openSettings: () => void
  openUrls: () => void
  clearDownloads: () => void
  findDownloads: () => void
  refreshDownloads: () => void
  pauseAll: () => void
  resumeAll: () => void
  openCompactWindow: () => void
  openHelp: () => void
  openRepository: () => void
}

function catalogMenuItem(
  id: AppCommandId,
  language: AppLanguage,
  click?: () => void
): MenuItemConstructorOptions {
  const command = getAppCommand(id)
  if (command.kind === 'role' && command.role) {
    return { role: command.role }
  }
  return {
    label: translate(language, COMMAND_I18N[id]),
    accelerator: command.accelerator,
    click
  }
}

export function buildApplicationMenuTemplate(
  appName: string,
  handlers: AppMenuHandlers,
  language: AppLanguage = 'en'
): MenuItemConstructorOptions[] {
  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        catalogMenuItem('preferences', language, () => handlers.openSettings()),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        catalogMenuItem('quit', language)
      ]
    },
    {
      label: translate(language, 'menu.file'),
      submenu: [
        catalogMenuItem('open-urls', language, () => handlers.openUrls()),
        { type: 'separator' },
        catalogMenuItem('pause-all', language, () => handlers.pauseAll()),
        catalogMenuItem('resume-all', language, () => handlers.resumeAll()),
        { type: 'separator' },
        catalogMenuItem('clear-finished', language, () => handlers.clearDownloads())
      ]
    },
    {
      label: translate(language, 'menu.edit'),
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        catalogMenuItem('find-downloads', language, () => handlers.findDownloads())
      ]
    },
    {
      label: translate(language, 'menu.view'),
      submenu: [
        catalogMenuItem('refresh-downloads', language, () => handlers.refreshDownloads())
      ]
    },
    {
      label: translate(language, 'menu.window'),
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        catalogMenuItem('compact-window', language, () => handlers.openCompactWindow()),
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: translate(language, 'menu.help'),
      submenu: [
        {
          label: translate(language, 'menu.helpPage'),
          click: () => handlers.openHelp()
        },
        { type: 'separator' },
        {
          label: translate(language, 'menu.githubRepo'),
          click: () => handlers.openRepository()
        }
      ]
    }
  ]
}
