export type LoginItemSettingsPatch = { openAtLogin: boolean }

export type SetLoginItemSettings = (settings: LoginItemSettingsPatch) => void

/** Sync the macOS login item. Missing or throwing Electron APIs are a no-op. */
export function syncLoginItem(
  openAtLogin: boolean,
  setLoginItemSettings?: SetLoginItemSettings
): void {
  if (typeof setLoginItemSettings !== 'function') return
  try {
    setLoginItemSettings({ openAtLogin: Boolean(openAtLogin) })
  } catch {
    // tests / unpackaged edge — SMAppService can throw outside a signed .app
  }
}
