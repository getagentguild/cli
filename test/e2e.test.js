import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { runCli } from '../src/cli.js'

const here = dirname(fileURLToPath(import.meta.url))
const KIT = join(here, 'fixtures', 'good-kit')

async function project(prefix) {
  const projectDir = await mkdtemp(join(tmpdir(), prefix))
  await writeFile(join(projectDir, 'package.json'), '{}\n')
  return projectDir
}

test('installs a local kit into a project with --from and --yes', async () => {
  const projectDir = await project('ag-e2e-')
  const code = await runCli(['--from=' + KIT, '--yes', projectDir])
  assert.equal(code, 0)

  const agent = await readFile(join(projectDir, '.claude/agents/postgres-pro.md'), 'utf8')
  assert.match(agent, /postgres-pro/)
  const skill = await readFile(join(projectDir, '.claude/skills/aso-screenshots/SKILL.md'), 'utf8')
  assert.match(skill, /aso-screenshots/)
  const guide = await readFile(
    join(projectDir, '.claude/skills/aso-screenshots/references/guide.md'),
    'utf8'
  )
  assert.match(guide, /ancillary skill material/)
  const command = await readFile(join(projectDir, '.claude/commands/ship.md'), 'utf8')
  assert.match(command, /release checklist/)

  const claudeMd = await readFile(join(projectDir, 'CLAUDE.md'), 'utf8')
  assert.match(claudeMd, /agentguild:start/)
  assert.match(claudeMd, /agentguild --update/)
})

test('a second run changes nothing', async () => {
  const projectDir = await project('ag-e2e-idem-')
  await runCli(['--from=' + KIT, '--yes', projectDir])
  const after1 = await readFile(join(projectDir, 'CLAUDE.md'), 'utf8')

  const code = await runCli(['--from=' + KIT, '--yes', projectDir])
  assert.equal(code, 0)
  const after2 = await readFile(join(projectDir, 'CLAUDE.md'), 'utf8')
  assert.equal(after1, after2)
})

test('a user-modified file survives reinstall', async () => {
  const projectDir = await project('ag-e2e-conflict-')
  await runCli(['--from=' + KIT, '--yes', projectDir])
  const target = join(projectDir, '.claude/agents/postgres-pro.md')
  await writeFile(target, 'MINE\n')

  await runCli(['--from=' + KIT, '--yes', projectDir])
  assert.equal(await readFile(target, 'utf8'), 'MINE\n')
})

test('dry run writes nothing', async () => {
  const projectDir = await project('ag-e2e-dry-')
  const code = await runCli(['--from=' + KIT, '--yes', '--dry-run', projectDir])
  assert.equal(code, 0)
  await assert.rejects(() => readFile(join(projectDir, '.claude/commands/ship.md'), 'utf8'))
})

test(
  'an unsafe CLAUDE.md symlink aborts before any kit item is written',
  { skip: process.platform === 'win32' },
  async () => {
    const projectDir = await project('ag-e2e-claude-link-')
    const outsideDir = await mkdtemp(join(tmpdir(), 'ag-e2e-claude-outside-'))
    const outside = join(outsideDir, 'CLAUDE.md')
    await writeFile(outside, 'DO NOT TOUCH\n')
    await symlink(outside, join(projectDir, 'CLAUDE.md'))

    const code = await runCli(['--from=' + KIT, '--yes', projectDir])

    assert.equal(code, 1)
    assert.equal(await readFile(outside, 'utf8'), 'DO NOT TOUCH\n')
    await assert.rejects(() => readFile(join(projectDir, '.claude/agents/postgres-pro.md')))
    await assert.rejects(() => readFile(join(projectDir, '.claude/commands/ship.md')))
    await assert.rejects(() => readFile(join(projectDir, 'CLAUDE.md.agentguild-backup')))
  }
)

test('exits non-zero when --from points at an invalid kit', async () => {
  const projectDir = await project('ag-e2e-bad-')
  const code = await runCli(['--from=' + join(here, 'fixtures', 'orphan-kit'), '--yes', projectDir])
  assert.equal(code, 1)
})

test('installs at the detected project root when given a nested path', async () => {
  const projectDir = await project('ag-e2e-nested-')
  const nested = join(projectDir, 'src', 'feature')
  await mkdir(nested, { recursive: true })

  const code = await runCli(['--from=' + KIT, '--yes', nested])
  assert.equal(code, 0)
  assert.match(
    await readFile(join(projectDir, '.claude/commands/ship.md'), 'utf8'),
    /release checklist/
  )
  await assert.rejects(() => readFile(join(nested, 'CLAUDE.md'), 'utf8'))
})

test('refuses to install into an unrecognized directory', async () => {
  const target = await mkdtemp(join(tmpdir(), 'ag-e2e-not-project-'))
  const code = await runCli(['--from=' + KIT, '--yes', target])
  assert.equal(code, 1)
  await assert.rejects(() => readFile(join(target, 'CLAUDE.md'), 'utf8'))
})

test('refuses a nonexistent install target clearly', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ag-e2e-missing-target-'))
  const target = join(parent, 'missing')
  const code = await runCli(['--from=' + KIT, '--yes', target])
  assert.equal(code, 1)
  await assert.rejects(() => readFile(join(target, 'CLAUDE.md'), 'utf8'))
})

test('validate remains a kit-directory operation, not a project install', async () => {
  assert.equal(await runCli(['validate', KIT]), 0)
})
