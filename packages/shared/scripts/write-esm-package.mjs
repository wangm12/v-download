import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const esmPackagePath = resolve(packageRoot, 'dist/esm/package.json')

await mkdir(dirname(esmPackagePath), { recursive: true })
await writeFile(esmPackagePath, '{\n  "type": "module"\n}\n')
