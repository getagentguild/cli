import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
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
