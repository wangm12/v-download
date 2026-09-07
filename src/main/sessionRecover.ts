export function planSessionRecover(rows: { id: string; status: string }[]): { recoveredIds: string[] } {
  return {
    recoveredIds: rows.filter((row) => row.status === 'downloading').map((row) => row.id)
  }
}
