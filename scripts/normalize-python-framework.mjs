import { existsSync, lstatSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

function isSymlink(path) {
  return existsSync(path) && lstatSync(path).isSymbolicLink()
}

function isDir(path) {
  return existsSync(path) && lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink()
}

function replaceWithSymlink(path, target) {
  if (existsSync(path) || isSymlink(path)) rmSync(path, { recursive: true, force: true })
  symlinkSync(target, path)
}

export function findVersionDirectory(frameworkDir) {
  const versions = join(frameworkDir, 'Versions')
  if (!existsSync(versions)) return null
  const names = readdirSync(versions).filter((name) => name !== 'Current')
  for (const name of names.sort()) {
    const dir = join(versions, name)
    if (isDir(dir) && existsSync(join(dir, 'Python'))) return name
  }
  return null
}

export function isNormalizedPythonFramework(frameworkDir) {
  return (
    isSymlink(join(frameworkDir, 'Python')) &&
    isSymlink(join(frameworkDir, 'Resources')) &&
    isSymlink(join(frameworkDir, 'Versions', 'Current'))
  )
}

/**
 * Rewrite a PyInstaller-copied Python.framework into Apple's layout:
 * Versions/<ver> holds the only real files; Current, Python, and Resources are symlinks.
 * codesign then treats the bundle as a framework instead of "ambiguous".
 */
export function normalizePythonFramework(frameworkDir) {
  if (!existsSync(frameworkDir)) return { changed: false }
  if (isNormalizedPythonFramework(frameworkDir)) return { changed: false }

  const version = findVersionDirectory(frameworkDir)
  if (!version) {
    throw new Error(`Python.framework at ${frameworkDir} has no Versions/<ver>/Python`)
  }

  const versions = join(frameworkDir, 'Versions')
  const current = join(versions, 'Current')
  if (existsSync(current) || isSymlink(current)) rmSync(current, { recursive: true, force: true })
  symlinkSync(version, current)

  replaceWithSymlink(join(frameworkDir, 'Python'), 'Versions/Current/Python')
  replaceWithSymlink(join(frameworkDir, 'Resources'), 'Versions/Current/Resources')

  return { changed: true, version }
}

export function findPythonFrameworks(rootDir) {
  const found = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, name.name)
      if (name.isDirectory() && name.name === 'Python.framework') {
        found.push(full)
        continue
      }
      if (name.isDirectory() && !name.isSymbolicLink()) walk(full)
    }
  }
  walk(rootDir)
  return found
}
