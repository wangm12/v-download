import type { DownloadErrorCode } from '@v-download/shared'

/** Classify the failure before formatting it for display or persistence. */
export function classifyDownloadError(error: unknown, isYoutube: boolean): DownloadErrorCode {
  const message = error instanceof Error ? error.message : String(error)
  const processError = error as { code?: unknown; syscall?: unknown } | null
  if (processError?.code === 'ENOENT' && typeof processError.syscall === 'string' && /^spawn\b/.test(processError.syscall)) return 'ENGINE_MISSING'
  // Resolver adapters may retain only the original Node spawn error message.
  if (/^spawn .+ ENOENT(?:\s|$)/i.test(message)) return 'ENGINE_MISSING'
  // POSIX supervision starts bash successfully even when the engine cannot exec.
  if (/\bbad interpreter: No such file or directory\b/i.test(message) || /\bv-download-managed-child: line \d+: .+: (?:No such file or directory|command not found)\b/i.test(message)) return 'ENGINE_MISSING'
  const httpStatus = /\b(?:HTTP(?:\s+Error|\s+status(?:\s+code)?)?|Server returned)\s*[:=]?\s*([45]\d{2})\b/i.exec(message)?.[1]
  if (httpStatus === '404' || httpStatus === '410') return 'UNSUPPORTED'
  if (httpStatus && (Number(httpStatus) >= 500 || ['408', '429'].includes(httpStatus))) return 'NETWORK_RETRYABLE'
  if (/po.?token|provider|missing[_ -]?pot|youtubepot|youtube.*bot|bot.*youtube|confirm you.?re not a bot/i.test(message) && isYoutube) return 'PO_TOKEN_REQUIRED'
  if (/captcha|browser challenge|challenge required|javascript required/i.test(message)) return 'BROWSER_REQUIRED'
  if (/drm|widevine|fairplay|protected content/i.test(message)) return 'DRM_PROTECTED'
  if (httpStatus === '401' || /auth_required|login required|log in|private video|sign in|authentication (?:required|failed)|unauthori[sz]ed|cookies? (?:are )?(?:required|needed)|fresh cookies/i.test(message)) return 'AUTH_REQUIRED'
  if (httpStatus === '403' || /\bforbidden\b|access denied/i.test(message)) return 'ACCESS_DENIED'
  if (/browser|javascript runtime|client.*required|chrome extension|chrome:\/\/extensions|extension.*reload/i.test(message)) return 'BROWSER_REQUIRED'
  if (/unsupported|no video formats|not available/i.test(message)) return 'UNSUPPORTED'
  if (/network|timed out|timeout|connection|503|429|temporarily unavailable/i.test(message)) return 'NETWORK_RETRYABLE'
  if (/\b(?:yt-dlp|ffmpeg|ffprobe)(?:\.exe)?(?: (?:and|or) (?:ffmpeg|ffprobe)(?:\.exe)?)? (?:was |is |are )?(?:not found|not installed|not configured)\b/i.test(message)) return 'ENGINE_MISSING'
  return isYoutube ? 'NETWORK_RETRYABLE' : 'UNSUPPORTED'
}

/** Preserve supervised launch diagnostics when the engine emitted no ERROR line. */
export function downloadProcessFailure(stderr: string, code: number | null): string {
  const lines = stderr.trim().split('\n').filter(Boolean)
  return lines.filter((line) => line.includes('ERROR:')).pop()?.slice(-4096)
    || lines.slice(-6).join('\n').slice(-4096)
    || `yt-dlp exited with code ${code}`
}
