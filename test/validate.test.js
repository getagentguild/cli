import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtemp, writeFile, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { validateKit } from '../src/validate.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => join(here, 'fixtures', name)
const execFileAsync = promisify(execFile)

test('a well-formed kit with ancillary Markdown produces no errors and correct counts', async () => {
  const { errors, counts } = await validateKit(fixture('good-kit'))
  assert.deepEqual(errors, [])
  assert.deepEqual(counts, { agent: 1, skill: 1, command: 1 })
})

test('flags a file on disk that is missing from the registry', async () => {
  const { errors } = await validateKit(fixture('orphan-kit'))
  assert.ok(errors.some((e) => /unregistered\.md/.test(e)))
})

test('flags a registry path that does not exist on disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ag-missing-'))
  await writeFile(
    join(dir, 'registry.json'),
    JSON.stringify({
      kit: 'mobile',
      version: '1.0.0',
      items: [
        {
          id: 'ghost',
          type: 'agent',
          path: 'agents/ghost.md',
          name: 'Ghost',
          description: 'Not on disk',
          tags: [],
          provenance: { origin: 'original' },
        },
      ],
    })
  )
  const { errors } = await validateKit(dir)
  assert.ok(errors.some((e) => /agents\/ghost\.md/.test(e)))
})

test('flags an agent missing required frontmatter', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ag-fm-'))
  await mkdir(join(dir, 'agents'), { recursive: true })
  await writeFile(
    join(dir, 'agents', 'thin.md'),
    '---\nname: thin\ndescription: does things\n---\n\nbody\n'
  )
  await writeFile(
    join(dir, 'registry.json'),
    JSON.stringify({
      kit: 'mobile',
      version: '1.0.0',
      items: [
        {
          id: 'thin',
          type: 'agent',
          path: 'agents/thin.md',
          name: 'Thin',
          description: 'does things',
          tags: [],
          provenance: { origin: 'original' },
        },
      ],
    })
  )
  const { errors } = await validateKit(dir)
  assert.ok(errors.some((e) => /tools/.test(e)))
  assert.ok(errors.some((e) => /model/.test(e)))
})

test('reports a missing registry file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ag-none-'))
  const { errors } = await validateKit(dir)
  assert.ok(errors.some((e) => /registry\.json/.test(e)))
})

test('rejects a registry path written with a ./ prefix', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ag-dotslash-'))
  await mkdir(join(dir, 'agents'), { recursive: true })
  await writeFile(
    join(dir, 'agents', 'a.md'),
    '---\nname: a\ndescription: d\ntools: Read\nmodel: sonnet\n---\n\nbody\n'
  )
  await writeFile(
    join(dir, 'registry.json'),
    JSON.stringify({
      kit: 'mobile',
      version: '1.0.0',
      items: [
        {
          id: 'a', type: 'agent', path: './agents/a.md', name: 'A',
          description: 'd', tags: [], provenance: { origin: 'original' },
        },
      ],
    })
  )
  const { errors } = await validateKit(dir)
  assert.ok(errors.some((error) => /agents\/<id>\.md exactly/.test(error)))
})

test('rejects an item whose path is a symlink pointing outside the kit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ag-symlink-'))
  await mkdir(join(dir, 'kit', 'commands'), { recursive: true })
  await writeFile(join(dir, 'outside.md'), 'SECRET OUTSIDE THE KIT\n')
  await symlink(join(dir, 'outside.md'), join(dir, 'kit', 'commands', 'innocent.md'))
  await writeFile(
    join(dir, 'kit', 'registry.json'),
    JSON.stringify({
      kit: 'mobile',
      version: '1.0.0',
      items: [
        {
          id: 'innocent', type: 'command', path: 'commands/innocent.md',
          name: 'Innocent', description: 'd', tags: [],
          provenance: { origin: 'original' },
        },
      ],
    })
  )
  const { errors } = await validateKit(join(dir, 'kit'))
  assert.ok(errors.some((e) => /must not be a symbolic link/.test(e)))
  assert.ok(errors.some((e) => /resolves outside the kit directory/.test(e)))
})

test('rejects a registered path that is not a regular file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ag-nonregular-item-'))
  await mkdir(join(dir, 'commands', 'not-a-file.md'), { recursive: true })
  await writeFile(
    join(dir, 'registry.json'),
    JSON.stringify({
      kit: 'mobile',
      version: '1.0.0',
      items: [
        {
          id: 'not-a-file', type: 'command', path: 'commands/not-a-file.md',
          name: 'Not a file', description: 'd', tags: [],
          provenance: { origin: 'original' },
        },
      ],
    })
  )

  const { errors } = await validateKit(dir)
  assert.ok(errors.some((error) => /commands\/not-a-file\.md must be a regular file/.test(error)))
})

test('rejects an ancillary skill symlink to a file outside the kit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ag-skill-link-'))
  const kitDir = join(dir, 'kit')
  const skillDir = join(kitDir, 'skills', 'safe-name')
  await mkdir(skillDir, { recursive: true })
  await writeFile(
    join(skillDir, 'SKILL.md'),
    '---\nname: safe-name\ndescription: safe\n---\n\nbody\n'
  )
  await writeFile(join(dir, 'outside.txt'), 'SECRET OUTSIDE THE KIT\n')
  await symlink(join(dir, 'outside.txt'), join(skillDir, 'notes.txt'))
  await writeFile(
    join(kitDir, 'registry.json'),
    JSON.stringify({
      kit: 'mobile',
      version: '1.0.0',
      items: [
        {
          id: 'safe-name', type: 'skill', path: 'skills/safe-name/SKILL.md',
          name: 'Safe name', description: 'd', tags: [],
          provenance: { origin: 'original' },
        },
      ],
    })
  )

  const { errors } = await validateKit(kitDir)
  assert.ok(errors.some((error) => /notes\.txt must not be a symbolic link/.test(error)))
  assert.ok(errors.some((error) => /notes\.txt .*resolves outside the kit directory/.test(error)))
})

test('rejects a root SKILL registration before it can broaden recursive copying', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ag-root-skill-'))
  await writeFile(join(dir, 'SKILL.md'), '---\nname: broad\ndescription: broad\n---\n')
  await writeFile(join(dir, 'private.txt'), 'MUST NOT BE COPIED\n')
  await writeFile(
    join(dir, 'registry.json'),
    JSON.stringify({
      kit: 'mobile',
      version: '1.0.0',
      items: [
        {
          id: 'broad', type: 'skill', path: 'SKILL.md', name: 'Broad',
          description: 'd', tags: [], provenance: { origin: 'original' },
        },
      ],
    })
  )

  const { errors } = await validateKit(dir)
  assert.ok(errors.some((error) => /skills\/<id>\/SKILL\.md exactly/.test(error)))
})

test(
  'rejects a non-regular ancillary skill file',
  { skip: process.platform === 'win32' },
  async () => {
    const kitDir = await mkdtemp(join(tmpdir(), 'ag-vs-'))
    const skillDir = join(kitDir, 'skills', 's')
    const pipePath = join(skillDir, 'x.pipe')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: s\ndescription: d\n---\n\nbody\n'
    )
    await writeFile(
      join(kitDir, 'registry.json'),
      JSON.stringify({
        kit: 'mobile',
        version: '1.0.0',
        items: [
          {
            id: 's', type: 'skill', path: 'skills/s/SKILL.md',
            name: 'Socket skill', description: 'd', tags: [],
            provenance: { origin: 'original' },
          },
        ],
      })
    )

    await execFileAsync('mkfifo', [pipePath])
    const { errors } = await validateKit(kitDir)
    assert.ok(errors.some((error) => /x\.pipe must be a regular file/.test(error)))
  }
)
