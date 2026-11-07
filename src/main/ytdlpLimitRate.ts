/** Modest Gentle cap: 2 MiB/s. */
export const GENTLE_LIMIT_RATE = '2M'

export function ytdlpLimitRateArgs(mode: string | undefined): string[] {
  return mode === 'gentle' ? ['--limit-rate', GENTLE_LIMIT_RATE] : []
}
