import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir, mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises'
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

test(
  'rejects a dangling CLAUDE.md symlink without creating its outside target',
  { skip: process.platform === 'win32' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ag-cmd-link-'))
    const projectDir = join(dir, 'project')
    const outside = join(dir, 'outside-claude.md')
    await mkdir(projectDir)
    await symlink(outside, join(projectDir, 'CLAUDE.md'))

    await assert.rejects(
      () => writeClaudeMd({ projectDir, block: 'GUILD', dryRun: false }),
      /destination CLAUDE\.md must not be a symbolic link/
    )
    await assert.rejects(() => readFile(outside))
    await assert.rejects(() => readFile(join(projectDir, 'CLAUDE.md.agentguild-backup')))
  }
)

test(
  'rejects a symlinked CLAUDE.md backup before changing either file',
  { skip: process.platform === 'win32' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ag-cmd-backup-link-'))
    const projectDir = join(dir, 'project')
    const outside = join(dir, 'outside-backup.md')
    await mkdir(projectDir)
    await writeFile(join(projectDir, 'CLAUDE.md'), '# Original\n')
    await writeFile(outside, 'DO NOT TOUCH\n')
    await symlink(outside, join(projectDir, 'CLAUDE.md.agentguild-backup'))

    await assert.rejects(
      () => writeClaudeMd({ projectDir, block: 'GUILD', dryRun: false }),
      /destination CLAUDE\.md\.agentguild-backup must not be a symbolic link/
    )
    assert.equal(await readFile(join(projectDir, 'CLAUDE.md'), 'utf8'), '# Original\n')
    assert.equal(await readFile(outside, 'utf8'), 'DO NOT TOUCH\n')
  }
)

test(
  'dry run still rejects a CLAUDE.md symlink',
  { skip: process.platform === 'win32' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ag-cmd-dry-link-'))
    const projectDir = join(dir, 'project')
    const outside = join(dir, 'outside-dry-claude.md')
    await mkdir(projectDir)
    await writeFile(outside, 'DO NOT TOUCH\n')
    await symlink(outside, join(projectDir, 'CLAUDE.md'))

    await assert.rejects(
      () => writeClaudeMd({ projectDir, block: 'GUILD', dryRun: true }),
      /destination CLAUDE\.md must not be a symbolic link/
    )
    assert.equal(await readFile(outside, 'utf8'), 'DO NOT TOUCH\n')
  }
)
