/** Best-effort URL from a browser or file drag/drop event. */
export function extractUrlFromDataTransfer(dt: DataTransfer | null): string | null {
  if (!dt) return null
  const uri = dt.getData('text/uri-list')?.split('\n').find((line) => line && !line.startsWith('#'))
  if (uri) {
    try {
      return new URL(uri.trim()).href
    } catch {
      return uri.trim() || null
    }
  }
  const plain = dt.getData('text/plain')?.trim()
  if (!plain) return null
  try {
    return new URL(plain).href
  } catch {
    return null
  }
}
