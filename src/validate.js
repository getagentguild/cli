import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { validateRegistry } from './registry.js'
import { parseFrontmatter } from './frontmatter.js'

const REQUIRED_FRONTMATTER = {
  agent: ['name', 'description', 'tools', 'model'],
  skill: ['name', 'description'],
  command: [],
}

const CONTENT_DIRS = ['agents', 'skills', 'commands']

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function walkMarkdown(dir, base = dir, out = []) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await walkMarkdown(full, base, out)
    else if (entry.name.endsWith('.md')) out.push(full)
  }
  return out
}

export async function validateKit(kitDir) {
  const errors = []
  const counts = { agent: 0, skill: 0, command: 0 }

  const registryPath = join(kitDir, 'registry.json')
  let registry
  try {
    registry = JSON.parse(await readFile(registryPath, 'utf8'))
  } catch (err) {
    errors.push(`registry.json could not be read or parsed: ${err.message}`)
    return { errors, counts }
  }

  errors.push(...validateRegistry(registry))
  if (errors.length > 0) return { errors, counts }

  const registered = new Set()

  for (const item of registry.items) {
    counts[item.type] += 1
    const itemPath = join(kitDir, item.path)
    registered.add(item.path.split('/').join(sep))

    if (!(await exists(itemPath))) {
      errors.push(`item "${item.id}": path ${item.path} does not exist on disk`)
      continue
    }

    const required = REQUIRED_FRONTMATTER[item.type]
    if (required.length === 0) continue

    const { data } = parseFrontmatter(await readFile(itemPath, 'utf8'))
    for (const field of required) {
      if (!data[field]) {
        errors.push(`item "${item.id}" (${item.path}): missing frontmatter field "${field}"`)
      }
    }
  }

  for (const dir of CONTENT_DIRS) {
    const files = await walkMarkdown(join(kitDir, dir))
    for (const file of files) {
      const rel = relative(kitDir, file)
      if (!registered.has(rel)) {
        errors.push(`${rel} exists on disk but has no registry entry`)
      }
    }
  }

  return { errors, counts }
}
