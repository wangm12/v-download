import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function filesUnder(path, extension) {
  return readdirSync(join(root, path), { withFileTypes: true })
    .filter((entry) => entry.isFile() && (!extension || entry.name.endsWith(extension)))
    .map((entry) => join(path, entry.name))
}

const tokenSource = read('src/renderer/src/styles/globals.css')
const tailwind = read('tailwind.config.ts')
for (const token of [
  '--color-surface-hover',
  '--color-selection',
  '--color-accent',
  '--color-divider-subtle',
  '--color-divider-strong'
]) {
  assert.match(tokenSource, new RegExp(token), `missing renderer token ${token}`)
}
for (const color of ['surface-hover', 'selection', 'accent', 'divider-subtle', 'divider-strong']) {
  assert.match(tailwind, new RegExp(`['"]?${color}['"]?`), `missing Tailwind color ${color}`)
}

const rendererFiles = [
  ...filesUnder('src/renderer/src/components', '.tsx'),
  'src/renderer/src/styles/globals.css'
]
for (const path of rendererFiles) {
  const source = read(path)
  assert.doesNotMatch(source, /border-white|ring-white/, `high-contrast white border remains in ${path}`)
}

assert.match(read('extension/manifest.json'), /"theme\.css"/)
assert.match(read('extension/popup.html'), /theme\.css/)
const extensionTheme = read('extension/theme.css')
assert.match(extensionTheme, /--vdl-accent/)
assert.match(extensionTheme, /--vdl-overlay-bg/)
assert.match(extensionTheme, /--vdl-overlay-icon/)

for (const path of ['extension/content-video-overlay.css', 'extension/content-douyin.css', 'extension/content-tiktok.css', 'extension/content-x.css']) {
  const source = read(path)
  assert.match(source, /var\(--vdl-overlay-bg\)/, `missing protected overlay surface in ${path}`)
  assert.match(source, /stroke: currentColor !important/, `overlay icon can be overridden by host CSS in ${path}`)
}

const extensionFiles = [
  ...filesUnder('extension', '.css'),
  ...filesUnder('extension', '.js')
]
for (const path of extensionFiles) {
  const source = read(path)
  assert.doesNotMatch(source, /ytdl-/, `legacy unscoped ytdl selector remains in ${path}`)
}

console.log(`ui contract: ${rendererFiles.length} renderer files and ${extensionFiles.length} extension files checked`)
