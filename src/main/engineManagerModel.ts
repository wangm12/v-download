export type EngineUpdateState = 'current' | 'available' | 'unknown'

export interface EngineUpdateResult {
  state: EngineUpdateState
  version?: string
}

function numericParts(version: string): number[] {
  return version
    .replace(/^v/i, '')
    .split(/[.-]/)
    .map((part) => Number(part.replace(/[^\d].*$/, '')))
    .map((part) => Number.isFinite(part) ? part : 0)
}

export function compareEngineVersions(left: string, right: string): number {
  const a = numericParts(left)
  const b = numericParts(right)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

export function parseAssetDigest(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^sha256:([a-f0-9]{64})$/i.exec(value.trim())
  return match ? match[1]!.toLowerCase() : null
}

export function selectPreferredEnginePath(input: {
  requestedPath?: string
  requestedExists: boolean
  requestedVersion?: string | null
  bundledPath?: string
  bundledExists: boolean
  bundledVersion?: string | null
}): string {
  const requested = input.requestedExists ? (input.requestedPath || '') : ''
  const bundled = input.bundledExists ? (input.bundledPath || '') : ''
  if (requested && bundled && requested !== bundled) {
    const requestedVersion = input.requestedVersion?.trim() || ''
    const bundledVersion = input.bundledVersion?.trim() || ''
    if (bundledVersion && (!requestedVersion || compareEngineVersions(requestedVersion, bundledVersion) < 0)) {
      return bundled
    }
    return requested
  }
  return requested || bundled || ''
}

export function resolveEngineUpdateState(input: {
  currentVersion: string
  latestVersion?: string | null
}): EngineUpdateResult {
  const latest = input.latestVersion?.trim()
  if (!latest) return { state: 'unknown' }
  return compareEngineVersions(input.currentVersion, latest) < 0
    ? { state: 'available', version: latest }
    : { state: 'current', version: input.currentVersion }
}
