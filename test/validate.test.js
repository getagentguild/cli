import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtemp, writeFile, mkdir, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { validateKit } from '../src/validate.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => join(here, 'fixtures', name)

test('a well-formed kit produces no errors and correct counts', async () => {
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

test('accepts a registry path written with a ./ prefix', async () => {
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
  assert.deepEqual(errors, [])
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
  assert.ok(errors.some((e) => /resolves outside the kit directory/.test(e)))
})
