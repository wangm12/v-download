/**
 * In-memory cache of raw aweme items from profile aweme/post listing.
 * Profile downloads reuse this instead of per-video aweme/detail calls.
 */
const cache = new Map<string, Record<string, unknown>>()

export function cacheProfileAwemeItems(items: Record<string, unknown>[]): void {
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const id = String(item.aweme_id ?? (item as { awemeId?: string }).awemeId ?? '').trim()
    if (!/^\d{10,}$/.test(id)) continue
    cache.set(id, item)
  }
}

export function getCachedProfileAwemeItem(awemeId: string): Record<string, unknown> | undefined {
  const id = awemeId.trim()
  if (!id) return undefined
  return cache.get(id)
}

export function clearProfileAwemeCache(): void {
  cache.clear()
}

export function profileAwemeCacheSize(): number {
  return cache.size
}
