import { readFile, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'

export const START = '<!-- agentguild:start -->'
export const END = '<!-- agentguild:end -->'

export function mergeClaudeMd(existing, block) {
  const section = `${START}\n${block}\n${END}`

  if (existing == null || existing.trim() === '') return `${section}\n`

  const startIdx = existing.indexOf(START)
  const endIdx = existing.indexOf(END)

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return existing.slice(0, startIdx) + section + existing.slice(endIdx + END.length)
  }

  const separator = existing.endsWith('\n') ? '\n' : '\n\n'
  return `${existing}${separator}${section}\n`
}

export async function writeClaudeMd({ projectDir, block, dryRun = false }) {
  const path = join(projectDir, 'CLAUDE.md')

  let existing = null
  try {
    existing = await readFile(path, 'utf8')
  } catch {
    existing = null
  }

  const merged = mergeClaudeMd(existing, block)
  if (existing === merged) return { path, backedUp: null }
  if (dryRun) return { path, backedUp: null }

  let backedUp = null
  if (existing !== null) {
    backedUp = join(projectDir, 'CLAUDE.md.agentguild-backup')
    await copyFile(path, backedUp)
  }

  await writeFile(path, merged)
  return { path, backedUp }
}
