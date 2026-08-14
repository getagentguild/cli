import { readFile } from 'node:fs/promises'
import {
  inspectDestinationFile,
  replaceDestinationFile,
  resolveDestinationRoot,
} from './destination-files.js'

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
  const projectRoot = await resolveDestinationRoot(projectDir)
  const inspected = await inspectDestinationFile(projectRoot, 'CLAUDE.md')
  const path = inspected.path

  const existing = inspected.exists ? await readFile(path, 'utf8') : null

  const merged = mergeClaudeMd(existing, block)
  if (existing === merged) return { path, backedUp: null }

  let backedUp = null
  if (existing !== null) {
    const backup = await inspectDestinationFile(
      projectRoot,
      'CLAUDE.md.agentguild-backup'
    )
    backedUp = backup.path
  }
  if (dryRun) return { path, backedUp: null }

  // Preflight the main and backup paths before either write. Atomic replacement
  // prevents a final-path symlink from being followed during the write.
  if (backedUp !== null) {
    await replaceDestinationFile(projectRoot, 'CLAUDE.md.agentguild-backup', existing)
  }
  await replaceDestinationFile(projectRoot, 'CLAUDE.md', merged)
  return { path, backedUp }
}
