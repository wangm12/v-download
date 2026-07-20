import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(directory, 'BottomBar.tsx'), 'utf8')

if (/onSettings|Settings|settings/i.test(source)) {
  throw new Error('BottomBar must not expose a duplicate Settings control')
}

for (const label of ['Start all downloads', 'Pause all downloads', 'Clear downloads', 'Sync cookies']) {
  if (!source.includes(label)) throw new Error(`BottomBar is missing queue/cookie label: ${label}`)
}

for (const policy of ['h-11', 'min-h-11', 'min-w-11', 'focus-visible:ring-2']) {
  if (!source.includes(policy)) throw new Error(`BottomBar is missing 44px accessibility policy: ${policy}`)
}

console.log('BottomBar structure check passed')
