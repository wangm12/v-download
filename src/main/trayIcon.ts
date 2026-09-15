import { nativeImage, Tray, type NativeImage } from 'electron'

type TrayGlobal = typeof globalThis & { __vdlTray?: Tray }

/** Dev HMR reloads main modules but leaves the previous NSStatusItem in the menu bar. */
export function destroyOrphanTray(): void {
  const g = globalThis as TrayGlobal
  const prev = g.__vdlTray
  if (prev && !prev.isDestroyed()) {
    prev.destroy()
  }
  delete g.__vdlTray
}

export function rememberTray(instance: Tray): void {
  ;(globalThis as TrayGlobal).__vdlTray = instance
}

export function forgetTray(instance: Tray): void {
  const g = globalThis as TrayGlobal
  if (g.__vdlTray === instance) {
    delete g.__vdlTray
  }
}

export function prepareTrayNativeImage(iconPath: string): NativeImage | null {
  let icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) return null

  if (process.platform === 'darwin') {
    // 22×22 (@2x: 44) matches macOS status-item optical size better than 16×16.
    const { width, height } = icon.getSize()
    if (width !== 22 || height !== 22) {
      icon = icon.resize({ width: 22, height: 22 })
    }
    icon.setTemplateImage(true)
  } else {
    // On Linux and Windows, scale high-res app icon down to tray-friendly 22x22
    const { width, height } = icon.getSize()
    if (width > 32 || height > 32) {
      icon = icon.resize({ width: 22, height: 22 })
    }
  }
  return icon
}
