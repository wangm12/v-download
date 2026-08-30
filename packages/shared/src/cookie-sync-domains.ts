/**
 * Domains the Chrome extension reads cookies from when syncing to the desktop app.
 * Regenerate extension/cookie-sync-domains.js via `npm run sync:extension-constants` at repo root.
 */
export const COOKIE_SYNC_DOMAINS = [
  '.youtube.com',
  '.douyin.com',
  '.iesdouyin.com',
  '.tiktok.com',
  '.xiaohongshu.com',
  '.bilibili.com',
  '.x.com',
  '.twitter.com',
  '.instagram.com',
] as const

export type CookieSyncDomain = (typeof COOKIE_SYNC_DOMAINS)[number]
