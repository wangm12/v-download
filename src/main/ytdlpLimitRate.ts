/** Modest Gentle cap: 2 MiB/s. Documented in scripts/test-gentle-limit-rate.ts. */
export const GENTLE_LIMIT_RATE = '2M'

export function ytdlpLimitRateArgs(mode: string | undefined): string[] {
  return mode === 'gentle' ? ['--limit-rate', GENTLE_LIMIT_RATE] : []
}
