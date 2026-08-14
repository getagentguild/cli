import { readFile, readdir } from 'node:fs/promises'
import { join, relative, normalize, posix, sep } from 'node:path'
import { validateRegistry } from './registry.js'
import { parseFrontmatter } from './frontmatter.js'
import {
  inspectRegisteredFile,
  inspectSkillTree,
  resolveKitRoot,
} from './source-files.js'

const REQUIRED_FRONTMATTER = {
  agent: ['name', 'description', 'tools', 'model'],
  skill: ['name', 'description'],
  command: [],
}

const CONTENT_DIRS = ['agents', 'skills', 'commands']

async function walkMarkdown(dir, out = []) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await walkMarkdown(full, out)
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
  const registeredSkillDirs = []
  let kitRealRoot
  try {
    kitRealRoot = await resolveKitRoot(kitDir)
  } catch (err) {
    errors.push(err.message)
    return { errors, counts }
  }

  for (const item of registry.items) {
    counts[item.type] += 1
    const normalizedItemPath = normalize(item.path.split('/').join(sep))
    registered.add(normalizedItemPath)
    if (item.type === 'skill') {
      registeredSkillDirs.push(normalize(posix.dirname(item.path).split('/').join(sep)))
    }

    const inspected = await inspectRegisteredFile({
      kitDir,
      kitRealRoot,
      relativePath: item.path,
    })
    if (inspected.errors.length > 0) {
      for (const error of inspected.errors) {
        errors.push(`item "${item.id}" (${item.path}): ${error}`)
      }
      continue
    }

    if (item.type === 'skill') {
      const tree = await inspectSkillTree({
        kitDir,
        kitRealRoot,
        skillDir: posix.dirname(item.path),
      })
      for (const error of tree.errors) errors.push(`item "${item.id}": ${error}`)
    }

    const required = REQUIRED_FRONTMATTER[item.type]
    if (required.length === 0) continue

    let data
    try {
      data = parseFrontmatter(await readFile(inspected.path, 'utf8')).data
    } catch (err) {
      errors.push(`item "${item.id}" (${item.path}) could not be read: ${err.message}`)
      continue
    }
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
      const normalizedRel = normalize(rel)
      const isSkillAncillary =
        dir === 'skills' &&
        registeredSkillDirs.some((skillDir) => normalizedRel.startsWith(`${skillDir}${sep}`))
      if (!registered.has(normalizedRel) && !isSkillAncillary) {
        errors.push(`${rel} exists on disk but has no registry entry`)
      }
    }
  }

  return { errors, counts }
}
