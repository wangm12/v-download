/**
 * Smoke-test Douyin short links (fetch + parse only; no yt-dlp).
 * Run from vdl-server: `npm run test:douyin`
 * Set `DOUYIN_PLAYWRIGHT=0` to disable Playwright (default is on). `npx playwright install chromium` required on the host.
 * Expect failures without fresh cookies / from blocked networks — script should exit 0 if no crashes.
 */
import { getDouyinInfo, getLastDouyinInfoError } from '../src/douyin.js'

const URLS: { label: string; url: string }[] = [
  { label: 'agent', url: 'https://v.douyin.com/9AFQLv6d_BE/' },
  { label: 'hard', url: 'https://v.douyin.com/1TdzlYAbtHQ/' },
  { label: 'art', url: 'https://v.douyin.com/jGfj2ndrEOs/' },
  { label: 'cos', url: 'https://v.douyin.com/yJ2HAITp1UQ/' },
]

async function main(): Promise<void> {
  let ok = 0
  for (const { label, url } of URLS) {
    const info = await getDouyinInfo(url)
    if (info) {
      ok++
      console.log(`[ok] ${label} title="${info.title.slice(0, 60)}" id=${info.id}`)
    } else {
      console.log(`[fail] ${label} ${getLastDouyinInfoError() || '(no detail)'}`)
    }
  }
  console.log(`\nSummary: ${ok}/${URLS.length} parsed (cookies + region affect results).`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
