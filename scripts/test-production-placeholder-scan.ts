import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const rendererSource = join(process.cwd(), 'src/renderer/src')
const forbidden = [
  /coming\s+soon/i,
  /coming\s+in\s+a\s+later\s+update/i,
  /roadmap/i,
  /not\s+persisted\s+yet/i,
  /(?:placeholder\s+TODO|TODO\s+placeholder)/i
]

function maskInputPlaceholderAttributes(source: string): string {
  return source.replace(/(<input\b[^>]*?\bplaceholder\s*=\s*)(?:"[^"]*"|'[^']*'|\{[^}]*\})/gis, '$1')
}

export function findProductionPlaceholderViolations(source: string): string[] {
  const scanSource = maskInputPlaceholderAttributes(source)
  return forbidden.flatMap((pattern) => {
    const matches = scanSource.match(pattern)
    return matches ? [matches[0]] : []
  })
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : /\.(tsx?|jsx?)$/.test(entry.name) ? [path] : []
  })
}

function runFixtures(): void {
  assert.deepEqual(findProductionPlaceholderViolations('<input placeholder="Coming soon" />'), [])
  assert.deepEqual(findProductionPlaceholderViolations('<div>Coming soon</div>'), ['Coming soon'])
  assert.deepEqual(findProductionPlaceholderViolations('// TODO placeholder'), ['TODO placeholder'])
}

runFixtures()

const violations = sourceFiles(rendererSource).flatMap((file) =>
  findProductionPlaceholderViolations(readFileSync(file, 'utf8')).map((match) => `${relative(process.cwd(), file)}: ${match}`)
)

assert.deepEqual(violations, [], `Production renderer placeholder scan failed:\n${violations.join('\n')}`)
console.log(`production renderer placeholder scan passed (${sourceFiles(rendererSource).length} source files)`)
