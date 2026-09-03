/**
 * Live Xiaohongshu gallery probe (not part of `npm test`).
 *
 * Image note via share short link:
 *   npx tsx scripts/test-xhs-url.ts --download 'https://xhslink.cn/o/7OA0OYWB0EB'
 *
 * Full explore link (default when no URL is passed):
 *   npx tsx scripts/test-xhs-url.ts --download
 */
import { mkdtempSync, readdirSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { noteFilePath, writeNoteMarkdownFile } from '../src/main/noteMarkdown'
import {
  downloadXiaohongshuImageGallery,
  getXiaohongshuInfo,
  isXiaohongshuGallery,
} from '../src/main/xiaohongshu'

const args = process.argv.slice(2).filter((a) => a !== '--download')
const url =
  args[0] ??
  'https://www.xiaohongshu.com/explore/6a1e5e390000000006037fc7?xsec_token=ABbeWYVjp2ZGjPnRWc8ju09ppniswPUKlliOm5TmRQIKU=&xsec_source=pc_feed'

async function main(): Promise<void> {
  const info = await getXiaohongshuInfo(url)
  console.log('gallery:', isXiaohongshuGallery(info))
  if (!info) {
    console.log('no info')
    process.exit(1)
  }
  console.log('kind:', info.kind)
  console.log('title:', info.title)
  console.log('author:', info.author)
  console.log('description:', info.description.slice(0, 160))
  if (isXiaohongshuGallery(info)) {
    console.log('images:', info.imageUrls.length)
    for (const [i, u] of info.imageUrls.entries()) {
      console.log(`  ${i + 1}: ${u.slice(0, 120)}`)
    }
  }

  if (process.argv.includes('--download')) {
    const dir = mkdtempSync(join(tmpdir(), 'xhs-test-'))
    if (isXiaohongshuGallery(info)) {
      const out = await downloadXiaohongshuImageGallery(info.imageUrls, dir, info.title)
      const md = noteFilePath('gallery', out, info.title)
      writeNoteMarkdownFile(md, {
        title: info.title,
        author: info.author,
        url,
        description: info.description,
      })
      console.log('saved to', out)
      for (const f of readdirSync(out)) {
        console.log(' ', f, statSync(join(out, f)).size, 'bytes')
      }
    } else {
      const md = noteFilePath('text', dir, info.title)
      writeNoteMarkdownFile(md, {
        title: info.title,
        author: info.author,
        url,
        description: info.description,
      })
      console.log('saved to', md)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
