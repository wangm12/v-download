import { normalizeProxyUrl } from './settingsModel'
import { remoteJobOutputDir } from './remoteJobModel'

export function isRemoteJobTask(metadata?: Record<string, unknown> | null): boolean {
  if (!metadata || typeof metadata !== 'object') return false
  const remoteJobId = typeof metadata.remoteJobId === 'string' ? metadata.remoteJobId.trim() : ''
  const remoteOutputDir = typeof metadata.remoteOutputDir === 'string' ? metadata.remoteOutputDir.trim() : ''
  return Boolean(remoteJobId || remoteOutputDir)
}

export function resolveTaskDownloadOverrides(input: {
  remoteJobId?: string
  remoteOutputDir?: string
  taskOutputDir?: string
  taskProxyUrl?: string
  taskHeaders?: Record<string, string>
  settingsDownloadDir: string
  settingsProxyUrl: string
}): {
  outputDir: string
  proxyUrl: string | undefined
  customHeaders: Record<string, string> | undefined
} {
  const settingsDir = (input.settingsDownloadDir ?? '').trim()
  const settingsProxy = normalizeProxyUrl(input.settingsProxyUrl) || undefined
  const remoteJobId = (input.remoteJobId ?? '').trim()
  const remoteOutputDir = (input.remoteOutputDir ?? '').trim()
  const isRemote = Boolean(remoteJobId || remoteOutputDir)

  if (isRemote) {
    const outputDir =
      remoteOutputDir || (remoteJobId ? remoteJobOutputDir(settingsDir, remoteJobId) : settingsDir)
    return {
      outputDir,
      proxyUrl: settingsProxy,
      customHeaders: undefined
    }
  }

  const taskDir = (input.taskOutputDir ?? '').trim()
  const taskProxy = normalizeProxyUrl(input.taskProxyUrl ?? '') || undefined
  const headers = input.taskHeaders && Object.keys(input.taskHeaders).length > 0 ? input.taskHeaders : undefined
  return {
    outputDir: taskDir || settingsDir,
    proxyUrl: taskProxy || settingsProxy,
    customHeaders: headers
  }
}

export function extrasFromTaskOverrides(overrides: {
  outputDir?: string
  proxyUrl?: string
  customHeaders?: Record<string, string>
}): Record<string, unknown> {
  const outputDir = typeof overrides.outputDir === 'string' ? overrides.outputDir.trim() : ''
  const proxyUrl = normalizeProxyUrl(overrides.proxyUrl ?? '')
  const extras: Record<string, unknown> = {}
  if (outputDir) extras.outputDir = outputDir
  if (proxyUrl) extras.proxyUrl = proxyUrl
  if (overrides.customHeaders && Object.keys(overrides.customHeaders).length > 0) {
    extras.customHeaders = overrides.customHeaders
  }
  return extras
}
