export interface InfoResolutionSchedulerOptions {
  maxConcurrent?: number
  onCancelActive?: (id: string) => void
}

/**
 * Small FIFO scheduler kept independent from Electron and the database so its
 * concurrency/cancellation behavior can be tested without booting the app.
 */
export class InfoResolutionScheduler {
  private readonly maxConcurrent: number
  private readonly worker: (id: string) => Promise<void>
  private readonly onCancelActive?: (id: string) => void
  private readonly queued: string[] = []
  private readonly active = new Set<string>()
  private readonly cancelled = new Set<string>()
  private readonly retryAfterActive = new Set<string>()

  constructor(
    worker: (id: string) => Promise<void>,
    options: InfoResolutionSchedulerOptions = {}
  ) {
    this.worker = worker
    this.maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent ?? 2))
    this.onCancelActive = options.onCancelActive
  }

  enqueue(id: string): boolean {
    if (!id || this.cancelled.has(id) || this.active.has(id) || this.queued.includes(id)) return false
    this.queued.push(id)
    this.pump()
    return true
  }

  cancel(id: string): boolean {
    if (!id) return false
    const queuedIndex = this.queued.indexOf(id)
    if (queuedIndex >= 0) {
      this.queued.splice(queuedIndex, 1)
      this.cancelled.add(id)
      return true
    }
    if (this.active.has(id)) {
      this.cancelled.add(id)
      this.onCancelActive?.(id)
      return true
    }
    return false
  }

  retry(id: string): boolean {
    if (!id) return false
    this.cancelled.delete(id)
    if (this.active.has(id)) {
      this.retryAfterActive.add(id)
      this.onCancelActive?.(id)
      return true
    }
    return this.enqueue(id)
  }

  isQueued(id: string): boolean {
    return this.queued.includes(id)
  }

  isActive(id: string): boolean {
    return this.active.has(id)
  }

  get activeCount(): number {
    return this.active.size
  }

  get queuedCount(): number {
    return this.queued.length
  }

  get queuedIds(): string[] {
    return [...this.queued]
  }

  private pump(): void {
    while (this.active.size < this.maxConcurrent && this.queued.length > 0) {
      const id = this.queued.shift()!
      if (this.cancelled.has(id)) continue
      this.active.add(id)
      void this.run(id)
    }
  }

  private async run(id: string): Promise<void> {
    try {
      if (!this.cancelled.has(id)) await this.worker(id)
    } finally {
      this.active.delete(id)
      const shouldRetry = this.retryAfterActive.delete(id)
      if (shouldRetry && !this.cancelled.has(id)) this.queued.push(id)
      this.pump()
    }
  }
}
