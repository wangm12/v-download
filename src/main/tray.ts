import { join } from 'path'
import type { Menu, MenuItemConstructorOptions } from 'electron'
import { translate, type AppLanguage } from '../i18n/catalog'

export interface TrayMenuHandlers {
  show: () => void
  openUrls: () => void
  pauseAll: () => void
  resumeAll: () => void
  preferences: () => void
  quit: () => void
}

export interface TrayHandle {
  setToolTip: (text: string) => void
  setContextMenu: (menu: Menu | null) => void
  on: (event: string, listener: () => void) => void
  destroy: () => void
  popUpContextMenu?: () => void
}

export interface TrayPlatform {
  createTray: (iconPath: string) => TrayHandle
  buildMenu: (template: MenuItemConstructorOptions[]) => Menu
  showWindow: () => void
  runCommand: (id: 'open-urls' | 'pause-all' | 'resume-all' | 'preferences' | 'quit') => void
  platform?: NodeJS.Platform
}

const TRAY_ICON_PATH = join(__dirname, '../../resources/icon.png')

let platformApi: TrayPlatform | null = null
let tray: TrayHandle | null = null
let liveHandlers: TrayMenuHandlers | null = null
let trayLanguage: AppLanguage = 'en'

export function buildTrayMenuTemplate(
  handlers: TrayMenuHandlers,
  language: AppLanguage = 'en'
): MenuItemConstructorOptions[] {
  return [
    { label: translate(language, 'tray.show'), click: () => handlers.show() },
    { label: translate(language, 'menu.openUrls'), click: () => handlers.openUrls() },
    { label: translate(language, 'tray.pauseAll'), click: () => handlers.pauseAll() },
    { label: translate(language, 'menu.resumeAll'), click: () => handlers.resumeAll() },
    { label: translate(language, 'menu.preferences'), click: () => handlers.preferences() },
    { type: 'separator' },
    { label: translate(language, 'menu.quit'), click: () => handlers.quit() }
  ]
}

export function configureTray(api: TrayPlatform): void {
  platformApi = api
}

export function syncTray(show: boolean, options?: { language?: AppLanguage }): void {
  if (options?.language) trayLanguage = options.language
  if (!show) {
    if (tray) {
      tray.destroy()
      tray = null
    }
    return
  }
  if (!platformApi) return

  liveHandlers = {
    show: () => platformApi?.showWindow(),
    openUrls: () => platformApi?.runCommand('open-urls'),
    pauseAll: () => platformApi?.runCommand('pause-all'),
    resumeAll: () => platformApi?.runCommand('resume-all'),
    preferences: () => platformApi?.runCommand('preferences'),
    quit: () => platformApi?.runCommand('quit')
  }
  const template = buildTrayMenuTemplate(liveHandlers, trayLanguage)

  if (tray) {
    tray.setContextMenu(platformApi.buildMenu(template))
    return
  }

  tray = platformApi.createTray(TRAY_ICON_PATH)
  tray.setToolTip('V-Download')
  tray.setContextMenu(platformApi.buildMenu(template))
  const platform = platformApi.platform ?? process.platform
  if (platform === 'darwin') {
    tray.on('click', () => {
      tray?.popUpContextMenu?.()
    })
  } else {
    tray.on('click', () => {
      platformApi?.showWindow()
    })
  }
}
