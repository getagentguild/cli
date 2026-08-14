import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, parse, resolve } from 'node:path'
import { homedir } from 'node:os'

async function lstatIfPresent(path) {
  try {
    return await lstat(path)
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null
    throw new Error(`could not inspect ${path}: ${err.message}`)
  }
}

function isRealDirectory(info) {
  return info?.isDirectory() && !info.isSymbolicLink()
}

function isRealFile(info) {
  return info?.isFile() && !info.isSymbolicLink()
}

async function hasProjectMarker(dir) {
  const [git, packageJson, assets, projectSettings, unityVersion] = await Promise.all([
    lstatIfPresent(resolve(dir, '.git')),
    lstatIfPresent(resolve(dir, 'package.json')),
    lstatIfPresent(resolve(dir, 'Assets')),
    lstatIfPresent(resolve(dir, 'ProjectSettings')),
    lstatIfPresent(resolve(dir, 'ProjectSettings', 'ProjectVersion.txt')),
  ])

  let isGitRoot = isRealDirectory(git)
  if (isRealFile(git)) {
    try {
      isGitRoot = /^gitdir:[ \t]*[^\r\n]+/.test(await readFile(resolve(dir, '.git'), 'utf8'))
    } catch {
      isGitRoot = false
    }
  }

  let isPackageRoot = false
  if (isRealFile(packageJson)) {
    try {
      const text = await readFile(resolve(dir, 'package.json'), 'utf8')
      const parsed = JSON.parse(text.replace(/^\uFEFF/, ''))
      isPackageRoot = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    } catch {
      isPackageRoot = false
    }
  }
  const isUnityRoot =
    isRealDirectory(assets) && isRealDirectory(projectSettings) && isRealFile(unityVersion)

  return isGitRoot || isPackageRoot || isUnityRoot
}

export async function findProjectRoot(startDir, { homeDir = homedir() } = {}) {
  const requested = resolve(startDir)
  const requestedInfo = await lstatIfPresent(requested)
  if (requestedInfo === null) {
    throw new Error(`project path does not exist: ${requested}`)
  }

  let canonical
  try {
    canonical = await realpath(requested)
  } catch (err) {
    throw new Error(`project path could not be resolved: ${requested}: ${err.message}`)
  }

  const canonicalInfo = await lstat(canonical)
  if (!canonicalInfo.isDirectory()) {
    throw new Error(`project path is not a directory: ${requested}`)
  }

  const home = await realpath(resolve(homeDir)).catch(() => resolve(homeDir))
  const filesystemRoot = parse(canonical).root
  let candidate = canonical

  while (true) {
    // A home directory or filesystem root is too broad an installation target,
    // even if it happens to contain a package.json or .git entry.
    if (candidate !== home && candidate !== filesystemRoot && (await hasProjectMarker(candidate))) {
      return candidate
    }

    const parent = dirname(candidate)
    if (candidate === home || candidate === filesystemRoot || parent === candidate) break
    candidate = parent
  }

  throw new Error(
    `no project root found from ${requested}; expected a .git entry, package.json, ` +
      `or Unity Assets plus ProjectSettings/ProjectVersion.txt`
  )
}
