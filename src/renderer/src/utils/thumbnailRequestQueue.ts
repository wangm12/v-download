type ThumbnailFetcher = () => Promise<string | null>

const MAX_CONCURRENT_REQUESTS = 3
const MAX_CACHE_ENTRIES = 256
const FAILURE_TTL_MS = 30_000

type CacheEntry = {
  value: string | null
  expiresAt: number
}

type QueueJob = {
  key: string
  fetcher: ThumbnailFetcher
  resolve: (value: string | null) => void
}

const cache = new Map<string, CacheEntry>()
const pending = new Map<string, Promise<string | null>>()
const queue: QueueJob[] = []
let activeRequests = 0

function remember(key: string, value: string | null): void {
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.delete(key)
  cache.set(key, { value, expiresAt: Date.now() + (value ? 10 * 60_000 : FAILURE_TTL_MS) })
}

function pump(): void {
  while (activeRequests < MAX_CONCURRENT_REQUESTS && queue.length > 0) {
    const job = queue.shift()!
    activeRequests += 1
    Promise.resolve()
      .then(job.fetcher)
      .then((value) => {
        const normalized = typeof value === 'string' && value ? value : null
        remember(job.key, normalized)
        job.resolve(normalized)
      })
      .catch(() => {
        remember(job.key, null)
        job.resolve(null)
      })
      .finally(() => {
        activeRequests -= 1
        pending.delete(job.key)
        pump()
      })
  }
}

export function requestCachedThumbnail(key: string, fetcher: ThumbnailFetcher): Promise<string | null> {
  const normalizedKey = key.trim()
  if (!normalizedKey) return Promise.resolve(null)

  const cached = cache.get(normalizedKey)
  if (cached && cached.expiresAt > Date.now()) {
    cache.delete(normalizedKey)
    cache.set(normalizedKey, cached)
    return Promise.resolve(cached.value)
  }
  if (cached) cache.delete(normalizedKey)

  const existing = pending.get(normalizedKey)
  if (existing) return existing

  const promise = new Promise<string | null>((resolve) => {
    queue.push({ key: normalizedKey, fetcher, resolve })
  })
  pending.set(normalizedKey, promise)
  pump()
  return promise
}

