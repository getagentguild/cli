import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  unlink,
} from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'

function isContained(root, target) {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

async function lstatIfPresent(path) {
  try {
    return await lstat(path)
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null
    throw err
  }
}

function displayPath(path) {
  return path.split(sep).join('/')
}

async function inspectPath({ projectRoot, relativePath, finalKind }) {
  const target = resolve(projectRoot, relativePath)
  if (!isContained(projectRoot, target)) {
    throw new Error(`destination ${displayPath(relativePath)} escapes the project root`)
  }

  const rel = relative(projectRoot, target)
  const parts = rel === '' ? [] : rel.split(sep)
  let current = projectRoot

  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index])
    const info = await lstatIfPresent(current)
    if (info === null) return { path: target, exists: false }

    const display = displayPath(relative(projectRoot, current))
    if (info.isSymbolicLink()) {
      throw new Error(`destination ${display} must not be a symbolic link`)
    }

    const isFinal = index === parts.length - 1
    if (!isFinal || finalKind === 'directory') {
      if (!info.isDirectory()) {
        throw new Error(`destination ${display} must be a directory`)
      }
    } else if (!info.isFile()) {
      throw new Error(`destination ${display} must be a regular file`)
    }

    const resolved = await realpath(current)
    if (!isContained(projectRoot, resolved)) {
      throw new Error(`destination ${display} resolves outside the project root`)
    }
  }

  return { path: target, exists: parts.length > 0 }
}

export async function resolveDestinationRoot(projectDir) {
  let projectRoot
  try {
    projectRoot = await realpath(resolve(projectDir))
  } catch (err) {
    throw new Error(`project directory could not be resolved: ${err.message}`)
  }

  const info = await lstat(projectRoot)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('project path must resolve to a real directory')
  }
  return projectRoot
}

export function inspectDestinationFile(projectRoot, relativePath) {
  return inspectPath({ projectRoot, relativePath, finalKind: 'file' })
}

async function ensureDestinationDirectory(projectRoot, relativePath) {
  const target = resolve(projectRoot, relativePath)
  if (!isContained(projectRoot, target)) {
    throw new Error(`destination ${displayPath(relativePath)} escapes the project root`)
  }

  const rel = relative(projectRoot, target)
  const parts = rel === '' ? [] : rel.split(sep)
  let current = projectRoot

  for (const part of parts) {
    current = join(current, part)
    let info = await lstatIfPresent(current)
    if (info === null) {
      try {
        await mkdir(current)
      } catch (err) {
        if (err.code !== 'EEXIST') throw err
      }
      info = await lstat(current)
    }

    const display = displayPath(relative(projectRoot, current))
    if (info.isSymbolicLink()) {
      throw new Error(`destination ${display} must not be a symbolic link`)
    }
    if (!info.isDirectory()) {
      throw new Error(`destination ${display} must be a directory`)
    }

    const resolved = await realpath(current)
    if (!isContained(projectRoot, resolved)) {
      throw new Error(`destination ${display} resolves outside the project root`)
    }
  }
}

export async function createDestinationFile(projectRoot, relativePath, content) {
  await ensureDestinationDirectory(projectRoot, dirname(relativePath))
  const inspected = await inspectDestinationFile(projectRoot, relativePath)
  if (inspected.exists) {
    throw new Error(`destination ${displayPath(relativePath)} appeared during installation`)
  }

  let handle
  try {
    // `wx` combines O_CREAT and O_EXCL. An existing regular file or dangling
    // symlink therefore fails instead of being followed or overwritten.
    handle = await open(inspected.path, 'wx')
    await handle.writeFile(content)
  } catch (err) {
    if (err.code === 'EEXIST' || err.code === 'ELOOP') {
      throw new Error(`destination ${displayPath(relativePath)} changed during installation`)
    }
    throw err
  } finally {
    await handle?.close()
  }
}

export async function replaceDestinationFile(projectRoot, relativePath, content) {
  await ensureDestinationDirectory(projectRoot, dirname(relativePath))
  await inspectDestinationFile(projectRoot, relativePath)

  const target = resolve(projectRoot, relativePath)
  const temp = join(
    dirname(target),
    `.${basename(target)}.agentguild-${process.pid}-${randomUUID()}.tmp`
  )
  let handle

  try {
    handle = await open(temp, 'wx')
    await handle.writeFile(content)
    await handle.close()
    handle = null

    // Recheck immediately before the atomic replacement. If a symlink was
    // introduced after the first preflight, refuse it; rename itself never
    // follows the final path.
    await inspectDestinationFile(projectRoot, relativePath)
    await rename(temp, target)
  } catch (err) {
    await handle?.close().catch(() => {})
    await unlink(temp).catch(() => {})
    throw err
  }
}
