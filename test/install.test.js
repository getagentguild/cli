import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { installItems } from '../src/install.js'

const here = dirname(fileURLToPath(import.meta.url))
const KIT = join(here, 'fixtures', 'good-kit')

async function loadRegistry() {
  return JSON.parse(await readFile(join(KIT, 'registry.json'), 'utf8'))
}

async function project() {
  return mkdtemp(join(tmpdir(), 'ag-proj-'))
}

test('writes agents, skills and commands to the right places', async () => {
  const projectDir = await project()
  const registry = await loadRegistry()
  const res = await installItems({
    kitDir: KIT,
    registry,
    itemIds: ['postgres-pro', 'aso-screenshots', 'ship'],
    projectDir,
    dryRun: false,
  })

  assert.equal(res.conflicts.length, 0)
  assert.equal(res.written.length, 3)

  const agent = await readFile(join(projectDir, '.claude/agents/postgres-pro.md'), 'utf8')
  assert.match(agent, /name: postgres-pro/)
  const skill = await readFile(join(projectDir, '.claude/skills/aso-screenshots/SKILL.md'), 'utf8')
  assert.match(skill, /name: aso-screenshots/)
  const command = await readFile(join(projectDir, '.claude/commands/ship.md'), 'utf8')
  assert.match(command, /release checklist/)
})

test('re-running is idempotent — everything is skipped, nothing conflicts', async () => {
  const projectDir = await project()
  const registry = await loadRegistry()
  const args = {
    kitDir: KIT,
    registry,
    itemIds: ['postgres-pro', 'aso-screenshots', 'ship'],
    projectDir,
    dryRun: false,
  }
  await installItems(args)
  const second = await installItems(args)

  assert.equal(second.written.length, 0)
  assert.equal(second.conflicts.length, 0)
  assert.equal(second.skipped.length, 3)
})

test('never overwrites a file the user has modified', async () => {
  const projectDir = await project()
  const registry = await loadRegistry()
  await mkdir(join(projectDir, '.claude/agents'), { recursive: true })
  await writeFile(join(projectDir, '.claude/agents/postgres-pro.md'), 'MY OWN VERSION\n')

  const res = await installItems({
    kitDir: KIT,
    registry,
    itemIds: ['postgres-pro'],
    projectDir,
    dryRun: false,
  })

  assert.equal(res.written.length, 0)
  assert.deepEqual(res.conflicts, ['.claude/agents/postgres-pro.md'])
  const kept = await readFile(join(projectDir, '.claude/agents/postgres-pro.md'), 'utf8')
  assert.equal(kept, 'MY OWN VERSION\n')
})

test('dry run reports what would be written but writes nothing', async () => {
  const projectDir = await project()
  const registry = await loadRegistry()
  const res = await installItems({
    kitDir: KIT,
    registry,
    itemIds: ['ship'],
    projectDir,
    dryRun: true,
  })

  assert.deepEqual(res.written, ['.claude/commands/ship.md'])
  await assert.rejects(() => readFile(join(projectDir, '.claude/commands/ship.md'), 'utf8'))
})

test('ignores item ids that are not in the registry', async () => {
  const projectDir = await project()
  const registry = await loadRegistry()
  const res = await installItems({
    kitDir: KIT,
    registry,
    itemIds: ['does-not-exist'],
    projectDir,
    dryRun: false,
  })
  assert.equal(res.written.length, 0)
  assert.equal(res.skipped.length, 0)
  assert.equal(res.conflicts.length, 0)
})
