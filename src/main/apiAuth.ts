import { timingSafeEqual } from 'node:crypto'

export function extractBearerToken(
  headers: Record<string, string | string[] | undefined> | undefined,
): string {
  const authorization = headers?.authorization
  const value = Array.isArray(authorization) ? authorization[0] : authorization
  if (typeof value === 'string' && value.startsWith('Bearer ')) {
    return value.slice('Bearer '.length)
  }
  return ''
}

export function hasApiAuth(
  headers: Record<string, string | string[] | undefined>,
  expected: string,
): boolean {
  if (!expected) return false
  const provided = extractBearerToken(headers)
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
