import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtemp, readFile, writeFile, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { installItems } from '../src/install.js'

const here = dirname(fileURLToPath(import.meta.url))
const KIT = join(here, 'fixtures', 'good-kit')
const execFileAsync = promisify(execFile)

async function loadRegistry() {
  return JSON.parse(await readFile(join(KIT, 'registry.json'), 'utf8'))
}

async function project() {
  return mkdtemp(join(tmpdir(), 'ag-proj-'))
}

test('writes agents, complete skill trees and commands to the right places', async () => {
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
  assert.equal(res.written.length, 4)

  const agent = await readFile(join(projectDir, '.claude/agents/postgres-pro.md'), 'utf8')
  assert.match(agent, /name: postgres-pro/)
  const skill = await readFile(join(projectDir, '.claude/skills/aso-screenshots/SKILL.md'), 'utf8')
  assert.match(skill, /name: aso-screenshots/)
  const guide = await readFile(
    join(projectDir, '.claude/skills/aso-screenshots/references/guide.md'),
    'utf8'
  )
  assert.match(guide, /ancillary skill material/)
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
  assert.equal(second.skipped.length, 4)
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

test(
  'rejects a dangling destination symlink before writing any selected item',
  { skip: process.platform === 'win32' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ag-install-dest-link-'))
    const projectDir = join(dir, 'project')
    const outside = join(dir, 'outside-command.md')
    const registry = await loadRegistry()
    await mkdir(join(projectDir, '.claude', 'commands'), { recursive: true })
    await symlink(outside, join(projectDir, '.claude', 'commands', 'ship.md'))

    await assert.rejects(
      () => installItems({
        kitDir: KIT,
        registry,
        itemIds: ['postgres-pro', 'ship'],
        projectDir,
      }),
      /destination \.claude\/commands\/ship\.md must not be a symbolic link/
    )

    await assert.rejects(() => readFile(outside))
    await assert.rejects(() => readFile(join(projectDir, '.claude/agents/postgres-pro.md')))
  }
)

test(
  'rejects a symlinked destination directory without writing outside the project',
  { skip: process.platform === 'win32' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ag-install-dest-dir-link-'))
    const projectDir = join(dir, 'project')
    const outside = join(dir, 'outside')
    const registry = await loadRegistry()
    await mkdir(projectDir)
    await mkdir(outside)
    await symlink(outside, join(projectDir, '.claude'))

    await assert.rejects(
      () => installItems({
        kitDir: KIT,
        registry,
        itemIds: ['postgres-pro'],
        projectDir,
      }),
      /destination \.claude must not be a symbolic link/
    )

    await assert.rejects(() => readFile(join(outside, 'agents/postgres-pro.md')))
  }
)

test(
  'dry run still rejects an unsafe destination symlink',
  { skip: process.platform === 'win32' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ag-install-dry-dest-link-'))
    const projectDir = join(dir, 'project')
    const outside = join(dir, 'outside-agent.md')
    const registry = await loadRegistry()
    await mkdir(join(projectDir, '.claude', 'agents'), { recursive: true })
    await writeFile(outside, 'DO NOT TOUCH\n')
    await symlink(outside, join(projectDir, '.claude', 'agents', 'postgres-pro.md'))

    await assert.rejects(
      () => installItems({
        kitDir: KIT,
        registry,
        itemIds: ['postgres-pro'],
        projectDir,
        dryRun: true,
      }),
      /destination \.claude\/agents\/postgres-pro\.md must not be a symbolic link/
    )
    assert.equal(await readFile(outside, 'utf8'), 'DO NOT TOUCH\n')
  }
)

test('rejects an ancillary skill symlink outside the kit before writing any item', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ag-install-link-'))
  const kitDir = join(dir, 'kit')
  const projectDir = join(dir, 'project')
  const skillDir = join(kitDir, 'skills', 'linked-notes')
  await mkdir(join(kitDir, 'agents'), { recursive: true })
  await mkdir(skillDir, { recursive: true })
  await mkdir(projectDir)
  await writeFile(join(kitDir, 'agents', 'safe.md'), 'SAFE AGENT\n')
  await writeFile(
    join(skillDir, 'SKILL.md'),
    '---\nname: linked-notes\ndescription: d\n---\n\nbody\n'
  )
  await writeFile(join(dir, 'outside.txt'), 'SECRET OUTSIDE THE KIT\n')
  await symlink(join(dir, 'outside.txt'), join(skillDir, 'notes.txt'))

  const registry = {
    kit: 'mobile',
    version: '1.0.0',
    items: [
      {
        id: 'safe', type: 'agent', path: 'agents/safe.md', name: 'Safe',
        description: 'd', tags: [], provenance: { origin: 'original' },
      },
      {
        id: 'linked-notes', type: 'skill', path: 'skills/linked-notes/SKILL.md',
        name: 'Linked notes', description: 'd', tags: [],
        provenance: { origin: 'original' },
      },
    ],
  }

  await assert.rejects(
    () => installItems({
      kitDir,
      registry,
      itemIds: ['safe', 'linked-notes'],
      projectDir,
    }),
    /unsafe skill .*notes\.txt must not be a symbolic link.*resolves outside the kit directory/
  )
  await assert.rejects(() => readFile(join(projectDir, '.claude/agents/safe.md')))
  await assert.rejects(() => readFile(join(projectDir, '.claude/skills/linked-notes/notes.txt')))
})

test('rejects a root SKILL registration without copying kit-root files', async () => {
  const kitDir = await mkdtemp(join(tmpdir(), 'ag-install-root-skill-'))
  const projectDir = await project()
  await writeFile(join(kitDir, 'SKILL.md'), '---\nname: broad\ndescription: broad\n---\n')
  await writeFile(join(kitDir, 'private.txt'), 'MUST NOT BE COPIED\n')

  const registry = {
    kit: 'mobile',
    version: '1.0.0',
    items: [
      {
        id: 'broad', type: 'skill', path: 'SKILL.md', name: 'Broad',
        description: 'd', tags: [], provenance: { origin: 'original' },
      },
    ],
  }

  await assert.rejects(
    () => installItems({ kitDir, registry, itemIds: ['broad'], projectDir }),
    /skills\/<id>\/SKILL\.md exactly/
  )
  await assert.rejects(() => readFile(join(projectDir, '.claude/skills/private.txt')))
})

test('rejects a registered source that is not a regular file', async () => {
  const kitDir = await mkdtemp(join(tmpdir(), 'ag-install-nonregular-item-'))
  const projectDir = await project()
  await mkdir(join(kitDir, 'commands', 'directory.md'), { recursive: true })
  const registry = {
    kit: 'mobile',
    version: '1.0.0',
    items: [
      {
        id: 'directory', type: 'command', path: 'commands/directory.md',
        name: 'Directory', description: 'd', tags: [],
        provenance: { origin: 'original' },
      },
    ],
  }

  await assert.rejects(
    () => installItems({ kitDir, registry, itemIds: ['directory'], projectDir }),
    /commands\/directory\.md must be a regular file/
  )
  await assert.rejects(() => readFile(join(projectDir, '.claude/commands/directory.md')))
})

test(
  'rejects a non-regular ancillary skill file during installation',
  { skip: process.platform === 'win32' },
  async () => {
    const kitDir = await mkdtemp(join(tmpdir(), 'ag-is-'))
    const projectDir = await project()
    const skillDir = join(kitDir, 'skills', 's')
    const pipePath = join(skillDir, 'x.pipe')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: s\ndescription: d\n---\n\nbody\n'
    )
    const registry = {
      kit: 'mobile',
      version: '1.0.0',
      items: [
        {
          id: 's', type: 'skill', path: 'skills/s/SKILL.md',
          name: 'Socket skill', description: 'd', tags: [],
          provenance: { origin: 'original' },
        },
      ],
    }

    await execFileAsync('mkfifo', [pipePath])
    await assert.rejects(
      () => installItems({ kitDir, registry, itemIds: ['s'], projectDir }),
      /x\.pipe must be a regular file/
    )
    await assert.rejects(
      () => readFile(join(projectDir, '.claude/skills/s/SKILL.md'))
    )
  }
)
