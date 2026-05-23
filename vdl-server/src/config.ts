import 'dotenv/config'

function required(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback
}

function optionalInt(key: string, fallback: number): number {
  const val = process.env[key]
  return val ? parseInt(val, 10) : fallback
}

/** Default on: hard Douyin links need headless Chromium after plain `fetch`. Set `DOUYIN_PLAYWRIGHT=0` to disable (e.g. minimal Docker). */
function envDouyinPlaywrightEnabled(): boolean {
  const raw = process.env.DOUYIN_PLAYWRIGHT
  if (raw === undefined) return true
  const v = raw.trim().toLowerCase()
  if (['0', 'false', 'no', 'off'].includes(v)) return false
  return true
}

export const config = {
  port: optionalInt('PORT', 3000),
  host: optional('HOST', '0.0.0.0'),
  baseUrl: optional('BASE_URL', 'http://localhost:3000'),

  telegramBotToken: required('TELEGRAM_BOT_TOKEN'),
  adminTelegramIds: optional('ADMIN_TELEGRAM_IDS', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),

  cookieMode: optional('COOKIE_MODE', 'browser') as 'browser' | 'file',
  cookiesFilePath: optional('COOKIES_FILE_PATH', './cookies.txt'),

  /** After plain `fetch` fails on Douyin, hydrate with Playwright (default on; set `DOUYIN_PLAYWRIGHT=0` to skip). */
  douyinPlaywright: envDouyinPlaywrightEnabled(),

  maxFileSizeMb: optionalInt('MAX_FILE_SIZE_MB', 500),

  tempDir: optional('TEMP_DIR', './tmp'),
  tempLinkExpiryHours: optionalInt('TEMP_LINK_EXPIRY_HOURS', 3),
} as const
