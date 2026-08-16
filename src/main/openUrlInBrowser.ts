import { shell } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  mapBrowserToMacExecutable,
  mapBrowserToOpenApp,
  mapBrowserToWinExecutable,
  resolvedCookiesBrowser,
} from './cookiesBrowser'

const execFileAsync = promisify(execFile)

export interface OpenConfiguredBrowserOptions {
  /**
   * Chromium-family browsers understand this flag and keep the transient
   * resolver page out of the user's active tab. Other browsers may ignore it.
   */
  background?: boolean
}

/** Open a URL in the configured real browser, preserving its existing profile/session. */
export async function openUrlInConfiguredBrowser(
  url: string,
  options: OpenConfiguredBrowserOptions = {}
): Promise<{
  ok: boolean
  openedIn: string
  error?: string
}> {
  const browser = resolvedCookiesBrowser()
  const appName = mapBrowserToOpenApp(browser)

  try {
    if (process.platform === 'darwin') {
      const executable = mapBrowserToMacExecutable(browser)
      if (executable) {
        // Calling the browser executable directly forwards the URL and flags
        // to the existing profile session. In contrast, `open -a … --args`
        // returns success but discards --new-background-tab when Chrome is
        // already running.
        const args = options.background ? ['--new-background-tab', url] : [url]
        await execFileAsync(executable, args)
        return { ok: true, openedIn: appName ?? browser }
      }
      if (appName) {
        await execFileAsync('open', ['-a', appName, url])
        return { ok: true, openedIn: appName }
      }
    }

    if (process.platform === 'win32') {
      const exe = mapBrowserToWinExecutable(browser)
      if (exe) {
        const args = options.background ? ['--new-background-tab', url] : [url]
        await execFileAsync(exe, args)
        return { ok: true, openedIn: browser }
      }
    }

    await shell.openExternal(url)
    return { ok: true, openedIn: 'default' }
  } catch (err) {
    return {
      ok: false,
      openedIn: browser,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
