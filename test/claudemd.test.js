import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { mergeClaudeMd, writeClaudeMd, START, END } from '../src/claudemd.js'

test('creates the block when there is no existing file', () => {
  const out = mergeClaudeMd(null, 'GUILD RULES')
  assert.ok(out.includes(START))
  assert.ok(out.includes('GUILD RULES'))
  assert.ok(out.includes(END))
})

test('appends the block to existing content, preserving it', () => {
  const out = mergeClaudeMd('# My project\n\nHouse rules.\n', 'GUILD RULES')
  assert.ok(out.startsWith('# My project'))
  assert.ok(out.includes('House rules.'))
  assert.ok(out.includes('GUILD RULES'))
})

test('replaces an existing block rather than duplicating it', () => {
  const first = mergeClaudeMd('# Mine\n', 'VERSION ONE')
  const second = mergeClaudeMd(first, 'VERSION TWO')
  assert.ok(second.includes('VERSION TWO'))
  assert.ok(!second.includes('VERSION ONE'))
  assert.equal(second.indexOf(START), second.lastIndexOf(START))
})

test('merging the same block twice is a no-op', () => {
  const first = mergeClaudeMd('# Mine\n', 'SAME')
  const second = mergeClaudeMd(first, 'SAME')
  assert.equal(first, second)
})

test('backs up an existing CLAUDE.md before writing', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'ag-cmd-'))
  await writeFile(join(projectDir, 'CLAUDE.md'), '# Original\n')

  const { backedUp } = await writeClaudeMd({ projectDir, block: 'GUILD', dryRun: false })
  assert.ok(backedUp)
  assert.equal(await readFile(backedUp, 'utf8'), '# Original\n')
  assert.match(await readFile(join(projectDir, 'CLAUDE.md'), 'utf8'), /GUILD/)
})

test('dry run writes nothing', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'ag-cmd-dry-'))
  await writeClaudeMd({ projectDir, block: 'GUILD', dryRun: true })
  await assert.rejects(() => readFile(join(projectDir, 'CLAUDE.md'), 'utf8'))
})
