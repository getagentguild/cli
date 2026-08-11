import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { join, dirname, basename, relative, sep } from 'node:path'

function toPosix(p) {
  return p.split(sep).join('/')
}

function destForItem(item) {
  const base = basename(item.path)
  if (item.type === 'agent') return { kind: 'file', dest: `.claude/agents/${base}` }
  if (item.type === 'command') return { kind: 'file', dest: `.claude/commands/${base}` }
  const skillName = dirname(item.path).split('/').pop()
  return { kind: 'dir', dest: `.claude/skills/${skillName}`, srcDir: dirname(item.path) }
}

async function readIfExists(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function listFiles(dir, base = dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await listFiles(full, base, out)
    else out.push(relative(base, full))
  }
  return out
}

async function placeFile({ srcPath, destRel, projectDir, dryRun, result }) {
  const srcContent = await readFile(srcPath, 'utf8')
  const destPath = join(projectDir, destRel)
  const existing = await readIfExists(destPath)

  if (existing !== null) {
    if (existing === srcContent) result.skipped.push(destRel)
    else result.conflicts.push(destRel)
    return
  }

  result.written.push(destRel)
  if (dryRun) return
  await mkdir(dirname(destPath), { recursive: true })
  await writeFile(destPath, srcContent)
}

export async function installItems({ kitDir, registry, itemIds, projectDir, dryRun = false }) {
  const result = { written: [], skipped: [], conflicts: [] }
  const wanted = new Set(itemIds)

  for (const item of registry.items) {
    if (!wanted.has(item.id)) continue
    const target = destForItem(item)

    if (target.kind === 'file') {
      await placeFile({
        srcPath: join(kitDir, item.path),
        destRel: target.dest,
        projectDir,
        dryRun,
        result,
      })
      continue
    }

    const srcDir = join(kitDir, target.srcDir)
    let files
    try {
      files = await listFiles(srcDir)
    } catch {
      continue
    }
    for (const rel of files) {
      await placeFile({
        srcPath: join(srcDir, rel),
        destRel: toPosix(join(target.dest, rel)),
        projectDir,
        dryRun,
        result,
      })
    }
  }

  return result
}
