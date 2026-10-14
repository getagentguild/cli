import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { cp, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { runCli, claudeMdBlock } from '../src/cli.js'
import { validateRegistry } from '../src/registry.js'
import { validateKit } from '../src/validate.js'
import { MAX_AGREEMENTS_BYTES, readAgreements } from '../src/agreements.js'

const here = dirname(fileURLToPath(import.meta.url))
const GOOD_KIT = join(here, 'fixtures', 'good-kit')

async function kitWith(claudeMd, files = { 'CLAUDE-BLOCK.md': '## Working agreements\n\nKeep it quick.\n' }) {
  const dir = await mkdtemp(join(tmpdir(), 'ag-agree-'))
  await cp(GOOD_KIT, dir, { recursive: true })
  const registry = JSON.parse(await readFile(join(dir, 'registry.json'), 'utf8'))
  if (claudeMd !== undefined) registry.claudeMd = claudeMd
  await writeFile(join(dir, 'registry.json'), JSON.stringify(registry, null, 2))
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content)
  return dir
}

const registryWith = (claudeMd) => ({
  kit: 'games',
  version: '1.0.0',
  claudeMd,
  items: [
    {
      id: 'stage-ladder',
      type: 'skill',
      path: 'skills/stage-ladder/SKILL.md',
      name: 'Stage Ladder',
      description: 'Use when sizing effort',
      provenance: { origin: 'original' },
    },
  ],
})

test('registry accepts claudeMd with a path, and with requires naming a real item', () => {
  assert.deepEqual(validateRegistry(registryWith({ path: 'CLAUDE-BLOCK.md' })), [])
  assert.deepEqual(validateRegistry(registryWith({ path: 'CLAUDE-BLOCK.md', requires: ['stage-ladder'] })), [])
})

test('registry rejects a malformed claudeMd', () => {
  const bad = [
    'CLAUDE-BLOCK.md',
    {},
    { path: 'docs/block.md' },
    { path: '../block.md' },
    { path: '/etc/passwd.md' },
    { path: 'a\\b.md' },
    { path: 'block.txt' },
    { path: '' },
    { path: 'block.md', extra: true },
    { path: 'block.md', requires: 'stage-ladder' },
    { path: 'block.md', requires: [3] },
    { path: 'block.md', requires: ['nope'] },
  ]
  for (const value of bad) {
    assert.notDeepEqual(validateRegistry(registryWith(value)), [], `${JSON.stringify(value)} should be rejected`)
  }
})

test('a kit with a valid claudeMd file validates', async () => {
  const dir = await kitWith({ path: 'CLAUDE-BLOCK.md' })
  const { errors } = await validateKit(dir)
  assert.deepEqual(errors, [])
})

test('a missing, empty, oversize, marker-bearing or binary claudeMd file fails validation', async () => {
  const cases = {
    missing: [{}, /does not exist/],
    empty: [{ 'CLAUDE-BLOCK.md': '' }, /is empty/],
    oversize: [{ 'CLAUDE-BLOCK.md': 'x'.repeat(MAX_AGREEMENTS_BYTES + 1) }, /the limit is/],
    marker: [{ 'CLAUDE-BLOCK.md': 'hello\n<!-- agentguild:end -->\nbye' }, /block markers/],
    binary: [{ 'CLAUDE-BLOCK.md': 'a\u0000b' }, /NUL/],
  }
  for (const [label, [files, pattern]] of Object.entries(cases)) {
    const dir = await kitWith({ path: 'CLAUDE-BLOCK.md' }, files)
    const { errors } = await validateKit(dir)
    assert.ok(errors.some((error) => pattern.test(error)), `${label}: ${errors.join(' | ')}`)
  }
})

test('a claudeMd file that is a symlink is refused', async () => {
  const dir = await kitWith({ path: 'CLAUDE-BLOCK.md' }, {})
  const outside = join(await mkdtemp(join(tmpdir(), 'ag-outside-')), 'secret.md')
  await writeFile(outside, 'not part of the kit\n')
  await symlink(outside, join(dir, 'CLAUDE-BLOCK.md'))
  const { errors } = await validateKit(dir)
  assert.ok(errors.some((error) => /symbolic link/.test(error)), errors.join(' | '))
  await assert.rejects(readAgreements(dir, JSON.parse(await readFile(join(dir, 'registry.json'), 'utf8'))))
})

test('readAgreements returns the trimmed text and an empty requires by default', async () => {
  const dir = await kitWith({ path: 'CLAUDE-BLOCK.md' }, { 'CLAUDE-BLOCK.md': '\n\n## Agreements\n\nBe quick.\n\n' })
  const registry = JSON.parse(await readFile(join(dir, 'registry.json'), 'utf8'))
  assert.deepEqual(await readAgreements(dir, registry), { text: '## Agreements\n\nBe quick.', requires: [] })
  assert.equal(await readAgreements(GOOD_KIT, JSON.parse(await readFile(join(GOOD_KIT, 'registry.json'), 'utf8'))), null)
})

test('the CLAUDE.md block carries a kit\'s agreements only when everything they require is installed', () => {
  const kit = {
    registry: { kit: 'games', items: [{ id: 'stage-ladder' }, { id: 'other' }] },
    agreements: { text: '### Working agreements\n\nStart quick.', requires: ['stage-ladder'] },
  }
  const withIt = claudeMdBlock([{ kit, itemIds: ['stage-ladder', 'other'] }])
  assert.match(withIt, /Edited files are never overwritten\.\n\n### Working agreements\n\nStart quick\.$/)
  const without = claudeMdBlock([{ kit, itemIds: ['other'] }])
  assert.doesNotMatch(without, /Working agreements/)
  const nothing = claudeMdBlock([{ kit, itemIds: [] }])
  assert.doesNotMatch(nothing, /Working agreements/)
  const noRequires = { registry: { kit: 'games', items: [{ id: 'a' }] }, agreements: { text: 'ALWAYS', requires: [] } }
  assert.match(claudeMdBlock([{ kit: noRequires, itemIds: ['a'] }]), /ALWAYS$/)
  assert.doesNotMatch(claudeMdBlock([{ kit: noRequires, itemIds: [] }]), /ALWAYS/, 'a kit with nothing installed adds nothing')
  const plain = claudeMdBlock([{ kit: { registry: { kit: 'games', items: [{ id: 'a' }] } }, itemIds: ['a'] }])
  assert.equal(plain.split('\n').length, 5, 'a kit with no agreements keeps the five-line block')
})

test('installing a kit with agreements writes them into CLAUDE.md, replaces them on change and is otherwise idempotent', async () => {
  const dir = await kitWith({ path: 'CLAUDE-BLOCK.md' })
  const project = await mkdtemp(join(tmpdir(), 'ag-agree-proj-'))
  await writeFile(join(project, 'package.json'), '{}\n')
  assert.equal(await runCli(['--from=' + dir, '--yes', project]), 0)
  const first = await readFile(join(project, 'CLAUDE.md'), 'utf8')
  assert.match(first, /## Working agreements\n\nKeep it quick\./)
  assert.equal(first.split('<!-- agentguild:start -->').length, 2)

  assert.equal(await runCli(['--from=' + dir, '--yes', project]), 0)
  assert.equal(await readFile(join(project, 'CLAUDE.md'), 'utf8'), first)

  await writeFile(join(dir, 'CLAUDE-BLOCK.md'), '## Working agreements\n\nKeep it thorough.\n')
  assert.equal(await runCli(['--from=' + dir, '--yes', project]), 0)
  const updated = await readFile(join(project, 'CLAUDE.md'), 'utf8')
  assert.match(updated, /Keep it thorough\./)
  assert.doesNotMatch(updated, /Keep it quick\./)
  assert.equal(updated.split('<!-- agentguild:start -->').length, 2)
})

test('an invalid claudeMd stops the install before anything is written', async () => {
  const dir = await kitWith({ path: 'CLAUDE-BLOCK.md' }, { 'CLAUDE-BLOCK.md': 'x'.repeat(MAX_AGREEMENTS_BYTES + 1) })
  const project = await mkdtemp(join(tmpdir(), 'ag-agree-bad-'))
  await writeFile(join(project, 'package.json'), '{}\n')
  assert.notEqual(await runCli(['--from=' + dir, '--yes', project]), 0)
  await assert.rejects(readFile(join(project, 'CLAUDE.md'), 'utf8'))
})
