import { existsSync, lstatSync, readlinkSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

function isDir(path) {
  try {
    const stat = lstatSync(path)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
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
  const pythonLink = join(frameworkDir, 'Python')
  const resourcesLink = join(frameworkDir, 'Resources')
  const currentLink = join(frameworkDir, 'Versions', 'Current')
  if (!isSymlink(pythonLink) || !isSymlink(resourcesLink) || !isSymlink(currentLink)) return false

  try {
    const currentTarget = readlinkSync(currentLink)
    if (
      readlinkSync(pythonLink) !== 'Versions/Current/Python' ||
      readlinkSync(resourcesLink) !== 'Versions/Current/Resources' ||
      currentTarget === '.' ||
      currentTarget === '..' ||
      currentTarget.includes('/') ||
      currentTarget.includes('\\')
    ) {
      return false
    }
    const versionDir = join(frameworkDir, 'Versions', currentTarget)
    return isDir(versionDir) && existsSync(join(versionDir, 'Python'))
  } catch {
    return false
  }
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
