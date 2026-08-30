import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function parseLatestMac(text) {
  const version = text.match(/^version:\s+(.+)$/m)?.[1]?.trim()
  if (!version) throw new Error('latest-mac.yml is missing version')
  const path = text.match(/^path:\s+(.+)$/m)?.[1]?.trim() || ''
  const sha512 = text.match(/^sha512:\s+(.+)$/m)?.[1]?.trim() || ''
  const releaseDate = text.match(/^releaseDate:\s+'?([^'\n]+)'?$/m)?.[1]?.trim() || ''
  const files = []
  for (const block of text.split(/\n\s*-\s+url:\s*/).slice(1)) {
    const url = block.match(/^[^\n]+/)?.[0]?.trim()
    if (!url) continue
    const fileSha = block.match(/sha512:\s+(\S+)/)?.[1]
    const size = Number(block.match(/size:\s+(\d+)/)?.[1] || 0)
    files.push({ url, sha512: fileSha || '', size })
  }
  if (!files.length) throw new Error('latest-mac.yml has no files')
  return { version, path, sha512, releaseDate, files }
}

export function mergeLatestMac(documents) {
  if (!documents.length) throw new Error('no latest-mac.yml documents')
  const version = documents[0].version
  if (documents.some((doc) => doc.version !== version)) throw new Error('latest-mac.yml version mismatch')
  const filesByUrl = new Map()
  for (const doc of documents) {
    for (const file of doc.files) filesByUrl.set(file.url, file)
  }
  const files = [...filesByUrl.values()].sort((a, b) => a.url.localeCompare(b.url))
  const newest = [...documents].sort((a, b) => String(b.releaseDate).localeCompare(String(a.releaseDate)))[0]
  const primary = files.find((file) => /-arm64/i.test(file.url)) || files[0]
  return {
    version,
    files,
    path: primary.url,
    sha512: primary.sha512,
    releaseDate: newest.releaseDate
  }
}

export function stringifyLatestMac(info) {
  const lines = [`version: ${info.version}`, 'files:']
  for (const file of info.files) {
    lines.push(`  - url: ${file.url}`)
    if (file.sha512) lines.push(`    sha512: ${file.sha512}`)
    if (file.size) lines.push(`    size: ${file.size}`)
  }
  lines.push(`path: ${info.path}`)
  if (info.sha512) lines.push(`sha512: ${info.sha512}`)
  if (info.releaseDate) lines.push(`releaseDate: '${info.releaseDate}'`)
  return `${lines.join('\n')}\n`
}

async function main() {
  const args = process.argv.slice(2)
  let out = ''
  const inputs = []
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--out') {
      out = args[i + 1] || ''
      i += 1
      continue
    }
    inputs.push(args[i])
  }
  if (!out || !inputs.length) {
    console.error('usage: node scripts/merge-latest-mac.mjs --out <file> <latest-mac.yml>...')
    process.exit(1)
  }
  const documents = []
  for (const input of inputs) {
    documents.push(parseLatestMac(await readFile(input, 'utf8')))
  }
  const merged = stringifyLatestMac(mergeLatestMac(documents))
  await mkdir(dirname(resolve(out)), { recursive: true })
  await writeFile(out, merged)
  console.log(`merged ${inputs.length} latest-mac.yml files into ${out}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`MERGE LATEST-MAC BLOCKED: ${error.message}`)
    process.exit(1)
  })
}
