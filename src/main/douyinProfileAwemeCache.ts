/**
 * In-memory cache of raw aweme items from profile aweme/post listing.
 * Profile downloads reuse this instead of per-video aweme/detail calls.
 */
const MAX_CACHE_ENTRIES = 10_000
const CACHE_TTL_MS = 60 * 60 * 1000
const cache = new Map<string, { item: Record<string, unknown>; expiresAt: number }>()

function pruneExpired(now = Date.now()): void {
  for (const [id, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(id)
  }
}

export function cacheProfileAwemeItems(items: Record<string, unknown>[]): void {
  const now = Date.now()
  pruneExpired(now)
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const id = String(item.aweme_id ?? (item as { awemeId?: string }).awemeId ?? '').trim()
    if (!/^\d{10,}$/.test(id)) continue
    cache.delete(id)
    cache.set(id, { item, expiresAt: now + CACHE_TTL_MS })
    while (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value as string | undefined
      if (!oldest) break
      cache.delete(oldest)
    }
  }
}

export function getCachedProfileAwemeItem(awemeId: string): Record<string, unknown> | undefined {
  const id = awemeId.trim()
  if (!id) return undefined
  const entry = cache.get(id)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    cache.delete(id)
    return undefined
  }
  cache.delete(id)
  cache.set(id, entry)
  return entry.item
}

export function clearProfileAwemeCache(): void {
  cache.clear()
}

export function profileAwemeCacheSize(): number {
  pruneExpired()
  return cache.size
}
