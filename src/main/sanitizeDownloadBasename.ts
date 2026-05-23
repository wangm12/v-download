/**
 * Single-line basename safe for disk paths (no path chars / CR / LF).
 */
export function sanitizeDownloadBasename(title: string, maxLen = 100): string {
  const s = title
    .replace(/\r\n?|\n|\t/g, ' ')
    .replace(/[^\w\u4e00-\u9fff \-]/g, '')
    .replace(/ +/g, ' ')
    .trim()
    .substring(0, maxLen)
  return s || 'video'
}
