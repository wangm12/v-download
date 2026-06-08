import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

/** Resolve the unpacked Chrome extension directory (dev repo or packaged app). */
export function resolveExtensionDir(): string | null {
  const candidates = [
    join(process.resourcesPath, 'extension'),
    join(app.getAppPath(), '..', 'extension'),
    join(app.getAppPath(), 'extension'),
    join(process.cwd(), 'extension'),
  ]

  for (const dir of candidates) {
    if (existsSync(join(dir, 'manifest.json'))) return dir
  }
  return null
}
