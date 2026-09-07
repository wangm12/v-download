export function parseSessionInterrupted(payload: unknown): { count: number; ids: string[] } | null {
  if (!payload || typeof payload !== 'object') return null
  const { count, ids } = payload as { count?: unknown; ids?: unknown }
  if (typeof count !== 'number' || !Number.isInteger(count) || !Number.isFinite(count) || count < 0) {
    return null
  }
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) return null
  return { count, ids }
}
