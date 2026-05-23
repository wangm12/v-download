/**
 * Single-line basename safe for disk paths and Telegram multipart filenames
 * (no CR/LF — grammY rejects paths containing them for sendVideo).
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
