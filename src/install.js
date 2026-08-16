import { readFile } from 'node:fs/promises'
import { posix } from 'node:path'
import { validateRegistry } from './registry.js'
import {
  inspectRegisteredFile,
  inspectSkillTree,
  resolveKitRoot,
} from './source-files.js'
import {
  createDestinationFile,
  inspectDestinationFile,
  resolveDestinationRoot,
} from './destination-files.js'

function destForItem(item) {
  const base = posix.basename(item.path)
  if (item.type === 'agent') return { kind: 'file', dest: `.claude/agents/${base}` }
  if (item.type === 'command') return { kind: 'file', dest: `.claude/commands/${base}` }
  const srcDir = posix.dirname(item.path)
  const skillName = posix.basename(srcDir)
  return { kind: 'dir', dest: `.claude/skills/${skillName}`, srcDir }
}

async function placeFile({ srcPath, destRel, projectRoot, dryRun, result }) {
  const srcContent = await readFile(srcPath)
  const inspected = await inspectDestinationFile(projectRoot, destRel)

  if (inspected.exists) {
    const existing = await readFile(inspected.path)
    if (existing.equals(srcContent)) result.skipped.push(destRel)
    else result.conflicts.push(destRel)
    return
  }

  result.written.push(destRel)
  if (dryRun) return
  await createDestinationFile(projectRoot, destRel, srcContent)
}

export async function installItems({ kitDir, registry, itemIds, projectDir, dryRun = false }) {
  const result = { written: [], skipped: [], conflicts: [] }
  const wanted = new Set(itemIds)
  const registryErrors = validateRegistry(registry)
  if (registryErrors.length > 0) {
    throw new Error(`kit registry is invalid: ${registryErrors.join('; ')}`)
  }

  const kitRealRoot = await resolveKitRoot(kitDir)
  const projectRoot = await resolveDestinationRoot(projectDir)
  const operations = []

  for (const item of registry.items) {
    if (!wanted.has(item.id)) continue
    const target = destForItem(item)
    const registered = await inspectRegisteredFile({
      kitDir,
      kitRealRoot,
      relativePath: item.path,
    })
    if (registered.errors.length > 0) {
      throw new Error(`unsafe kit item "${item.id}": ${registered.errors.join('; ')}`)
    }

    if (target.kind === 'file') {
      operations.push({
        srcPath: registered.path,
        destRel: target.dest,
      })
      continue
    }

    const tree = await inspectSkillTree({
      kitDir,
      kitRealRoot,
      skillDir: target.srcDir,
    })
    if (tree.errors.length > 0) {
      throw new Error(`unsafe skill "${item.id}": ${tree.errors.join('; ')}`)
    }

    for (const file of tree.files) {
      operations.push({
        srcPath: file.path,
        destRel: posix.join(target.dest, file.relativePath),
      })
    }
  }

  // Complete both source and destination safety preflight before writing
  // anything. A malformed later item must not leave the buyer with a partial
  // installation, and a destination symlink must never redirect a write.
  for (const operation of operations) {
    await inspectDestinationFile(projectRoot, operation.destRel)
  }

  for (const operation of operations) {
    await placeFile({ ...operation, projectRoot, dryRun, result })
  }

  return result
}
