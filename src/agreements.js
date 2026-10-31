import { readFile } from 'node:fs/promises'
import { inspectRegisteredFile, resolveKitRoot } from './source-files.js'

// A kit may ship a short markdown file of working agreements. The installer adds it to the
// managed block of the buyer's CLAUDE.md, so it is read in every session. Keep it small:
// the block is always in context, and the specialist detail belongs in the skills.
export const MAX_AGREEMENTS_BYTES = 6144
const BLOCK_MARKER = '<!-- agentguild'

export function agreementsProblems(buffer) {
  const problems = []
  if (buffer.length === 0) problems.push('is empty')
  if (buffer.length > MAX_AGREEMENTS_BYTES) {
    problems.push(`is ${buffer.length} bytes; the limit is ${MAX_AGREEMENTS_BYTES}`)
  }
  if (buffer.includes(0)) problems.push('must be text (it contains a NUL byte)')
  if (buffer.toString('utf8').includes(BLOCK_MARKER)) {
    problems.push('must not contain the agentguild block markers')
  }
  return problems
}

// Errors for the registry's claudeMd file (the shape is checked in registry.js).
export async function checkAgreementsFile(kitDir, registry) {
  if (registry.claudeMd === undefined) return []
  const { path } = registry.claudeMd
  const display = `claudeMd (${path})`
  let kitRealRoot
  try {
    kitRealRoot = await resolveKitRoot(kitDir)
  } catch (err) {
    return [`${display}: ${err.message}`]
  }
  const inspected = await inspectRegisteredFile({ kitDir, kitRealRoot, relativePath: path })
  if (inspected.errors.length > 0) return inspected.errors.map((error) => `${display}: ${error}`)
  let buffer
  try {
    buffer = await readFile(inspected.path)
  } catch (err) {
    return [`${display}: could not be read: ${err.message}`]
  }
  return agreementsProblems(buffer).map((problem) => `${display}: ${problem}`)
}

// The text and the items that must be installed for it to apply. Call only after the kit has
// been validated; the file is inspected again so it can never be a link out of the kit.
export async function readAgreements(kitDir, registry) {
  if (registry.claudeMd === undefined) return null
  const errors = await checkAgreementsFile(kitDir, registry)
  if (errors.length > 0) throw new Error(errors.join('; '))
  const kitRealRoot = await resolveKitRoot(kitDir)
  const { path, requires = [] } = registry.claudeMd
  const inspected = await inspectRegisteredFile({ kitDir, kitRealRoot, relativePath: path })
  const text = (await readFile(inspected.path, 'utf8')).trim()
  return { text, requires }
}
