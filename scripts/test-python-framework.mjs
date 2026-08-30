import assert from 'node:assert/strict'
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { normalizePythonFramework } from './normalize-python-framework.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))

function writeFile(path, contents) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

const fixture = mkdtempSync(join(tmpdir(), 'vdl-python-fw-'))
const fw = join(fixture, 'Python.framework')
writeFile(join(fw, 'Python'), 'root-python')
writeFile(join(fw, 'Resources', 'Info.plist'), '<plist/>')
writeFile(join(fw, 'Versions', '3.14', 'Python'), 'version-python')
writeFile(join(fw, 'Versions', '3.14', 'Resources', 'Info.plist'), '<plist/>')
writeFile(join(fw, 'Versions', 'Current', 'Python'), 'current-python')
writeFile(join(fw, 'Versions', 'Current', 'Resources', 'Info.plist'), '<plist/>')
chmodSync(join(fw, 'Python'), 0o755)
chmodSync(join(fw, 'Versions', '3.14', 'Python'), 0o755)

const result = normalizePythonFramework(fw)
assert.equal(result.changed, true)
assert.equal(readFileSync(join(fw, 'Versions', '3.14', 'Python'), 'utf8'), 'version-python')
assert.ok(lstatSync(join(fw, 'Python')).isSymbolicLink())
assert.equal(readlinkSync(join(fw, 'Python')), 'Versions/Current/Python')
assert.ok(lstatSync(join(fw, 'Resources')).isSymbolicLink())
assert.equal(readlinkSync(join(fw, 'Resources')), 'Versions/Current/Resources')
assert.ok(lstatSync(join(fw, 'Versions', 'Current')).isSymbolicLink())
assert.equal(readlinkSync(join(fw, 'Versions', 'Current')), '3.14')
assert.equal(normalizePythonFramework(fw).changed, false)

rmSync(fixture, { recursive: true, force: true })

const realFw = join(root, 'resources/engines/darwin-arm64/_internal/Python.framework')
if (existsSync(join(realFw, 'Python'))) {
  const live = mkdtempSync(join(tmpdir(), 'vdl-python-fw-live-'))
  const copy = join(live, 'Python.framework')
  cpSync(realFw, copy, { recursive: true })
  assert.equal(normalizePythonFramework(copy).changed, true)
  const signed = spawnSync('codesign', ['--force', '--sign', '-', '--timestamp', '--options', 'runtime', join(copy, 'Python')], {
    encoding: 'utf8',
  })
  assert.equal(signed.status, 0, signed.stderr || signed.stdout)
  assert.doesNotMatch(`${signed.stdout}${signed.stderr}`, /bundle format is ambiguous/)
  const bundle = spawnSync('codesign', ['--force', '--sign', '-', '--timestamp', '--options', 'runtime', copy], { encoding: 'utf8' })
  assert.equal(bundle.status, 0, bundle.stderr || bundle.stdout)
  rmSync(live, { recursive: true, force: true })
}

const builderConfig = readFileSync(join(root, 'electron-builder.yml'), 'utf8')
assert.match(builderConfig, /afterPack:\s*\.\/scripts\/after-pack\.mjs/)
const afterPack = readFileSync(join(root, 'scripts/after-pack.mjs'), 'utf8')
assert.match(afterPack, /normalizePythonFramework/)
assert.match(afterPack, /Python\.framework/)

console.log('python framework normalize tests passed')
