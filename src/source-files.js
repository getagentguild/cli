import { lstat, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

function displayPath(path) {
  return path.split(sep).join('/')
}

function isContained(root, target) {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

async function inspectEntry({ kitRealRoot, path, display, kind }) {
  let info
  try {
    info = await lstat(path)
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      return `${display} does not exist on disk`
    }
    return `${display} could not be inspected: ${err.message}`
  }

  const problems = []
  if (info.isSymbolicLink()) problems.push('must not be a symbolic link')
  if (kind === 'file' && !info.isFile()) {
    problems.push('must be a regular file')
  }
  if (kind === 'directory' && !info.isDirectory()) {
    problems.push('must be a directory')
  }

  let resolved
  try {
    resolved = await realpath(path)
  } catch (err) {
    problems.push(`could not be resolved: ${err.message}`)
  }
  if (resolved && !isContained(kitRealRoot, resolved)) {
    problems.push('resolves outside the kit directory')
  }

  return problems.length > 0 ? `${display} ${problems.join(' and ')}` : null
}

async function inspectRelativePath({ kitDir, kitRealRoot, relativePath, finalKind }) {
  const parts = relativePath.split('/')
  const errors = []
  let current = kitDir

  for (let index = 0; index < parts.length; index += 1) {
    // On case-insensitive filesystems, lstat("foo") can resolve a file named
    // "Foo". Registry paths are portable identifiers, so require the spelling
    // on disk to match exactly instead of reporting a confusing orphan later.
    let siblings
    try {
      siblings = await readdir(current)
    } catch {
      siblings = null
    }
    if (
      siblings &&
      !siblings.includes(parts[index]) &&
      siblings.some((name) => name.toLowerCase() === parts[index].toLowerCase())
    ) {
      errors.push(
        `${parts.slice(0, index + 1).join('/')} casing does not exactly match the registry path`
      )
      break
    }

    current = join(current, parts[index])
    const kind = index === parts.length - 1 ? finalKind : 'directory'
    const error = await inspectEntry({
      kitRealRoot,
      path: current,
      display: parts.slice(0, index + 1).join('/'),
      kind,
    })
    if (error) {
      errors.push(error)
      break
    }
  }

  return { path: current, errors }
}

export async function resolveKitRoot(kitDir) {
  let resolved
  try {
    resolved = await realpath(kitDir)
  } catch (err) {
    throw new Error(`kit directory could not be resolved: ${err.message}`)
  }

  const info = await lstat(resolved)
  if (!info.isDirectory()) throw new Error('kit path must be a directory')
  return resolved
}

export async function inspectRegisteredFile({ kitDir, kitRealRoot, relativePath }) {
  return inspectRelativePath({ kitDir, kitRealRoot, relativePath, finalKind: 'file' })
}

// Enumerate a skill exactly as the installer will copy it. Every directory and
// file is lstat'd so symlinks are rejected rather than followed, every resolved
// path is checked against the kit root, and traversal failures become errors
// instead of silently producing a partial installation.
export async function inspectSkillTree({ kitDir, kitRealRoot, skillDir }) {
  const root = await inspectRelativePath({
    kitDir,
    kitRealRoot,
    relativePath: skillDir,
    finalKind: 'directory',
  })
  if (root.errors.length > 0) return { files: [], errors: root.errors }

  const files = []
  const errors = []

  async function walk(dir, relativeDir = '') {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (err) {
      const display = relativeDir ? `${skillDir}/${displayPath(relativeDir)}` : skillDir
      errors.push(`${display} could not be read: ${err.message}`)
      return
    }

    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const relativeFile = relativeDir ? join(relativeDir, entry.name) : entry.name
      const full = join(dir, entry.name)
      const display = `${skillDir}/${displayPath(relativeFile)}`

      let info
      try {
        info = await lstat(full)
      } catch (err) {
        errors.push(`${display} could not be inspected: ${err.message}`)
        continue
      }

      if (info.isSymbolicLink()) {
        const error = await inspectEntry({
          kitRealRoot,
          path: full,
          display,
          kind: 'file',
        })
        errors.push(error)
        continue
      }

      if (info.isDirectory()) {
        const error = await inspectEntry({
          kitRealRoot,
          path: full,
          display,
          kind: 'directory',
        })
        if (error) errors.push(error)
        else await walk(full, relativeFile)
        continue
      }

      const error = await inspectEntry({
        kitRealRoot,
        path: full,
        display,
        kind: 'file',
      })
      if (error) errors.push(error)
      else files.push({ path: full, relativePath: displayPath(relativeFile) })
    }
  }

  await walk(root.path)
  return { files, errors }
}
