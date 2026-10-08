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
  consumers: Set<ThumbnailConsumer>
  started: boolean
  settled: boolean
}

type ThumbnailConsumer = {
  resolve: (value: string | null) => void
  signal?: AbortSignal
  onAbort?: () => void
}

const cache = new Map<string, CacheEntry>()
const pending = new Map<string, QueueJob>()
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

function settle(job: QueueJob, value: string | null): void {
  if (job.settled) return
  job.settled = true
  if (pending.get(job.key) === job) pending.delete(job.key)
  if (job.consumers.size > 0) remember(job.key, value)
  const consumers = [...job.consumers]
  job.consumers.clear()
  for (const consumer of consumers) {
    if (consumer.signal && consumer.onAbort) consumer.signal.removeEventListener('abort', consumer.onAbort)
    consumer.resolve(value)
  }
}

function pump(): void {
  while (activeRequests < MAX_CONCURRENT_REQUESTS && queue.length > 0) {
    const job = queue.shift()!
    if (pending.get(job.key) !== job || job.consumers.size === 0) continue
    job.started = true
    activeRequests += 1
    Promise.resolve()
      .then(job.fetcher)
      .then((value) => {
        const normalized = typeof value === 'string' && value ? value : null
        settle(job, normalized)
      })
      .catch(() => settle(job, null))
      .finally(() => {
        activeRequests -= 1
        if (pending.get(job.key) === job) pending.delete(job.key)
        pump()
      })
  }
}

export function requestCachedThumbnail(
  key: string,
  fetcher: ThumbnailFetcher,
  signal?: AbortSignal
): Promise<string | null> {
  const normalizedKey = key.trim()
  if (!normalizedKey || signal?.aborted) return Promise.resolve(null)

  const cached = cache.get(normalizedKey)
  if (cached && cached.expiresAt > Date.now()) {
    cache.delete(normalizedKey)
    cache.set(normalizedKey, cached)
    return Promise.resolve(cached.value)
  }
  if (cached) cache.delete(normalizedKey)

  let job = pending.get(normalizedKey)
  if (!job) {
    job = { key: normalizedKey, fetcher, consumers: new Set(), started: false, settled: false }
    pending.set(normalizedKey, job)
    queue.push(job)
  }
  const promise = new Promise<string | null>((resolve) => {
    const consumer: ThumbnailConsumer = { resolve, signal }
    if (signal) {
      consumer.onAbort = () => {
        if (!job?.consumers.delete(consumer)) return
        resolve(null)
        if (!job.started && job.consumers.size === 0) {
          pending.delete(job.key)
          const index = queue.indexOf(job)
          if (index >= 0) queue.splice(index, 1)
        }
      }
      signal.addEventListener('abort', consumer.onAbort, { once: true })
    }
    job!.consumers.add(consumer)
  })
  pump()
  return promise
}
