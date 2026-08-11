import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { runCli } from '../src/cli.js'

const here = dirname(fileURLToPath(import.meta.url))
const KIT = join(here, 'fixtures', 'good-kit')

test('installs a local kit into a project with --from and --yes', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'ag-e2e-'))
  const code = await runCli(['--from=' + KIT, '--yes', projectDir])
  assert.equal(code, 0)

  const agent = await readFile(join(projectDir, '.claude/agents/postgres-pro.md'), 'utf8')
  assert.match(agent, /postgres-pro/)
  const skill = await readFile(join(projectDir, '.claude/skills/aso-screenshots/SKILL.md'), 'utf8')
  assert.match(skill, /aso-screenshots/)
  const command = await readFile(join(projectDir, '.claude/commands/ship.md'), 'utf8')
  assert.match(command, /release checklist/)

  const claudeMd = await readFile(join(projectDir, 'CLAUDE.md'), 'utf8')
  assert.match(claudeMd, /agentguild:start/)
})

test('a second run changes nothing', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'ag-e2e-idem-'))
  await runCli(['--from=' + KIT, '--yes', projectDir])
  const after1 = await readFile(join(projectDir, 'CLAUDE.md'), 'utf8')

  const code = await runCli(['--from=' + KIT, '--yes', projectDir])
  assert.equal(code, 0)
  const after2 = await readFile(join(projectDir, 'CLAUDE.md'), 'utf8')
  assert.equal(after1, after2)
})

test('a user-modified file survives reinstall', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'ag-e2e-conflict-'))
  await runCli(['--from=' + KIT, '--yes', projectDir])
  const target = join(projectDir, '.claude/agents/postgres-pro.md')
  await writeFile(target, 'MINE\n')

  await runCli(['--from=' + KIT, '--yes', projectDir])
  assert.equal(await readFile(target, 'utf8'), 'MINE\n')
})

test('dry run writes nothing', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'ag-e2e-dry-'))
  const code = await runCli(['--from=' + KIT, '--yes', '--dry-run', projectDir])
  assert.equal(code, 0)
  await assert.rejects(() => readFile(join(projectDir, '.claude/commands/ship.md'), 'utf8'))
})

test('exits non-zero when --from points at an invalid kit', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'ag-e2e-bad-'))
  const code = await runCli(['--from=' + join(here, 'fixtures', 'orphan-kit'), '--yes', projectDir])
  assert.equal(code, 1)
})
