import { app } from 'electron'
import { realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Keep this aligned with package.json's stable application name. Electron's
// display name is changed later in index.ts, after userData may be cached.
const CANONICAL_PROFILE_DIRECTORY = 'v-download'

function normalizedExistingPath(path: string): string {
  const absolute = resolve(path)
  try {
    return realpathSync.native(absolute)
  } catch {
    return absolute
  }
}

/** True only for the package's normal profile; explicit scratch profiles stay isolated. */
export function isCanonicalUserDataProfile(): boolean {
  try {
    const expected = normalizedExistingPath(join(app.getPath('appData'), CANONICAL_PROFILE_DIRECTORY))
    const actual = normalizedExistingPath(app.getPath('userData'))
    return process.platform === 'win32'
      ? actual.toLowerCase() === expected.toLowerCase()
      : actual === expected
  } catch {
    return false
  }
}
