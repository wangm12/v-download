const KiB = 1024
const MiB = KiB * 1024
const GiB = MiB * 1024

export function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatViews(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M views`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K views`
  return `${count} views`
}

export function parseSpeedToBytes(speed: string): number {
  const match = speed.match(/([\d.]+)\s*(B|KiB|MiB|GiB)/i)
  if (!match) return 0
  const value = parseFloat(match[1])
  const unit = match[2].toLowerCase()
  if (unit === 'gib') return value * GiB
  if (unit === 'mib') return value * MiB
  if (unit === 'kib') return value * KiB
  return value
}

export function formatSpeed(bytes: number): string {
  if (bytes >= GiB) return `${(bytes / GiB).toFixed(2)}GiB/s`
  if (bytes >= MiB) return `${(bytes / MiB).toFixed(2)}MiB/s`
  if (bytes >= KiB) return `${(bytes / KiB).toFixed(1)}KiB/s`
  return `${Math.round(bytes)}B/s`
}

export function formatFileSize(bytes: number): string {
  if (bytes >= GiB) return `${(bytes / GiB).toFixed(1)} GB`
  if (bytes >= MiB) return `${(bytes / MiB).toFixed(1)} MB`
  if (bytes >= KiB) return `${(bytes / KiB).toFixed(1)} KB`
  return `${bytes} B`
}
