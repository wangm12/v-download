/**
 * Shape of each cookie object sent by the V-Download extension (see extension/background.js).
 */
export interface ChromeSyncedCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly?: boolean
  expirationDate?: number
}

export function toNetscapeLine(c: ChromeSyncedCookie): string {
  const raw = c.domain.trim()
  let domainField: string
  let includeSubdomains: string
  if (raw.startsWith('.')) {
    domainField = raw
    includeSubdomains = 'TRUE'
  } else {
    const labels = raw.split('.').filter(Boolean)
    // e.g. `douyin.com` → `.douyin.com` + TRUE; `www.douyin.com` / `api.douyin.com` stay host-only + FALSE
    if (labels.length === 2) {
      domainField = `.${raw}`
      includeSubdomains = 'TRUE'
    } else {
      domainField = raw
      includeSubdomains = 'FALSE'
    }
  }
  const secure = c.secure ? 'TRUE' : 'FALSE'
  const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 0
  return `${domainField}\t${includeSubdomains}\t${c.path}\t${secure}\t${expiry}\t${c.name}\t${c.value}`
}

export interface BuildNetscapeCookieFileOptions {
  /** Shown on the second line of the file after "# " (Netscape format comment). */
  headerNote: string
}

/** Full Netscape cookie file contents (header + body + trailing newline). */
export function buildNetscapeCookieFile(
  cookies: ChromeSyncedCookie[],
  options: BuildNetscapeCookieFileOptions
): string {
  const header = `# Netscape HTTP Cookie File\n# ${options.headerNote}\n\n`
  const lines = cookies.map(toNetscapeLine).join('\n')
  return header + lines + '\n'
}
