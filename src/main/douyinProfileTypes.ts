/** Structured errors for profile post listing (IPC contract). */
export type DouyinProfileListErrorCode =
  | 'INVALID_URL'
  | 'COOKIE_REQUIRED'
  | 'ANTI_BOT'
  | 'PRIVATE_OR_EMPTY'
  | 'UNSUPPORTED_LAYOUT'
  | 'TIMEOUT'
  | 'LOAD_MORE_FAILED'
  | 'PAGINATION_RESTRICTED'

export type DouyinProfileMediaType = 'video' | 'note' | 'gallery'

export interface DouyinProfilePostRow {
  awemeId: string
  mediaType: DouyinProfileMediaType
  title: string
  author: string
  cover: string
  durationSec?: number
  imageCount?: number
  /** Canonical page URL for enqueue */
  pageUrl: string
}

export interface DouyinProfileListSuccess {
  ok: true
  items: DouyinProfilePostRow[]
  cursor: string | null
  hasMore: boolean
  source: 'html' | 'chromium' | 'api' | 'merged' | 'browser_recovery'
  warnings?: string[]
}

export interface DouyinProfileListFailure {
  ok: false
  code: DouyinProfileListErrorCode
  message: string
}

export type DouyinProfileListResult = DouyinProfileListSuccess | DouyinProfileListFailure
