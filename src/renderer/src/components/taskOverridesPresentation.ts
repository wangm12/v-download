export type TaskDownloadOverrides = {
  outputDir?: string
  proxyUrl?: string
  customHeaders?: Record<string, string>
}

export function shouldPersistDownloadDirOnFolderChange(): false {
  return false
}

export function applyFolderChange(
  _currentDir: string,
  picked: string | undefined
): { downloadDir: string; persistGlobal: false } {
  return { downloadDir: (picked ?? '').trim(), persistGlobal: false }
}

export function isAllowedTaskProxyUrl(value: string): boolean {
  if (typeof value !== 'string') return false
  const input = value.trim()
  if (!input) return true
  try {
    const url = new URL(input)
    if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol)) return false
    if (url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash) {
      return false
    }
    return true
  } catch {
    return false
  }
}

function normalizeTaskProxyUrl(value: string): string {
  if (!isAllowedTaskProxyUrl(value)) return ''
  const input = value.trim()
  if (!input) return ''
  try {
    return new URL(input).toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

export function parseExtraHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof text !== 'string' || !text.trim()) return out
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.includes(':')) continue
    const idx = trimmed.indexOf(':')
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    if (!key || !value) continue
    out[key] = value
  }
  return out
}

export function buildTaskOverridePayload(input: {
  downloadDir: string
  settingsDownloadDir: string
  proxyUrl: string
  extraHeadersText: string
  existingHeaders?: Record<string, string>
}): {
  outputDir?: string
  proxyUrl?: string
  customHeaders?: Record<string, string>
} {
  const settingsDir = (input.settingsDownloadDir ?? '').trim()
  const downloadDir = (input.downloadDir ?? '').trim()
  const parsed = parseExtraHeaders(input.extraHeadersText)
  const customHeaders = { ...(input.existingHeaders ?? {}), ...parsed }
  const proxyUrl = normalizeTaskProxyUrl(input.proxyUrl)
  return {
    ...(downloadDir && downloadDir !== settingsDir ? { outputDir: downloadDir } : {}),
    ...(proxyUrl ? { proxyUrl } : {}),
    ...(Object.keys(customHeaders).length > 0 ? { customHeaders } : {})
  }
}
