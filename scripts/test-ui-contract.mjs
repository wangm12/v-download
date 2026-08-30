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
assert.match(tokenSource, /--color-action: 255 255 255/, 'dark primary action must be white')
assert.match(tokenSource, /scrollbar-width: thin/, 'scrollbars must remain visible')
assert.doesNotMatch(tokenSource, /::-webkit-scrollbar \{\s*display: none/, 'global scrollbar hiding is not allowed')
assert.match(tailwind, /button: '8px'/, 'button radius must be 8px')
assert.match(tailwind, /card: '10px'/, 'card radius must be 10px')
assert.match(tailwind, /panel: '12px'/, 'panel radius must be 12px')
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
  assert.doesNotMatch(source, /242 184 96|95 208 163|244 123 111/, `colored status token remains in ${path}`)
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

const sidebar = read('src/renderer/src/components/AppSidebar.tsx')
assert.match(
  sidebar,
  /mt-auto[\s\S]{0,400}PREF_SECTION_ADVANCED/,
  'Advanced must sit in an mt-auto slot so it pins to the bottom of the sidebar'
)
assert.doesNotMatch(
  sidebar,
  /flex-1 min-h-2 shrink-0/,
  'Advanced must not be pushed by a flex-1 shrink-0 spacer (that spacer cannot grow when the height chain is content-sized)'
)
assert.match(sidebar, /self-stretch/, 'sidebar must stretch on the app shell cross axis')
assert.doesNotMatch(
  sidebar,
  /h-full/,
  'aside must not use h-full; percentage height against an auto-height flex parent disables stretch and shrinks the sidebar to its content'
)
const appShell = read('src/renderer/src/App.tsx')
assert.match(
  appShell,
  /h-0 min-h-0 min-w-0 flex-1 flex-row/,
  'app shell row must resolve a definite height via h-0 + flex-1 so the sidebar can stretch'
)
assert.doesNotMatch(
  sidebar,
  /focus-visible:ring-offset/,
  'sidebar nav rows must not use focus ring-offset; it adds a halo that looks like extra padding on the focused active item'
)
assert.match(appShell, /<BottomBar/, 'queue controls must remain available on Downloads')
assert.ok(
  appShell.indexOf('<BottomBar') < appShell.indexOf('<DownloadInspector'),
  'BottomBar must live in the downloads column, not as a window-wide footer that lifts the sidebar'
)
assert.doesNotMatch(sidebar, /onSelectLibrary|nav\.library/, 'Library workspace entry must be removed')
assert.doesNotMatch(appShell, /LibraryView|openLibrary|'library'/, 'Library view must be removed from the app shell')
assert.doesNotMatch(sidebar, /onSelectSniff|nav\.sniff/, 'Sniff workspace entry must be removed')
assert.doesNotMatch(appShell, /SniffPanel|openSniff|'sniff'/, 'In-app Sniff view must be removed; capture goes through the Chrome extension')

console.log(`ui contract: ${rendererFiles.length} renderer files and ${extensionFiles.length} extension files checked`)
