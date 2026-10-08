import { app, BrowserWindow, nativeImage, type NativeImage } from 'electron'
import { join } from 'path'

let idleIcon: NativeImage | null = null

export function init(): void {
  if (process.platform !== 'darwin') return
  idleIcon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
  if (!idleIcon.isEmpty()) app.dock?.setIcon(idleIcon)
  app.dock?.setBadge('')
}

// Keep the public signature: speed is shown in the app; the Dock uses native progress.
export function updateProgress(percent: number, _speedBytes: number, activeCount?: number): void {
  const ratio = Math.max(0, Math.min(1, percent / 100))
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.setProgressBar(ratio)
  }
  if (process.platform === 'darwin') {
    app.dock?.setBadge(activeCount != null && activeCount > 0
      ? activeCount > 99 ? '99+' : String(activeCount)
      : '')
  }
}

export function reset(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.setProgressBar(-1)
  }
  if (process.platform !== 'darwin') return
  if (idleIcon && !idleIcon.isEmpty()) app.dock?.setIcon(idleIcon)
  app.dock?.setBadge('')
}
