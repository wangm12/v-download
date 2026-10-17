export function planSessionRecover(rows: { id: string; status: string }[]): { recoveredIds: string[] } {
  return {
    recoveredIds: rows.filter((row) => row.status === 'downloading').map((row) => row.id)
  }
}

/** An omitted or malformed scope must never turn into a global resume. */
export function parseInterruptedDownloadIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id.trim())) {
    return null
  }
  return [...new Set(value as string[])]
}
