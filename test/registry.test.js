import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateRegistry, ALLOWED_LICENSES } from '../src/registry.js'

const valid = {
  kit: 'mobile',
  version: '1.0.0',
  items: [
    {
      id: 'aso-screenshots',
      type: 'skill',
      path: 'skills/aso-screenshots/SKILL.md',
      name: 'ASO Screenshot Generator',
      description: 'Use when creating or refreshing App Store screenshots',
      tags: ['aso', 'ios'],
      provenance: { origin: 'original' },
    },
  ],
}

test('accepts a valid registry', () => {
  assert.deepEqual(validateRegistry(valid), [])
})

test('rejects an unknown kit name', () => {
  const bad = { ...valid, kit: 'quantum' }
  const errors = validateRegistry(bad)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /kit/)
})

test('rejects an unknown item type', () => {
  const bad = { ...valid, items: [{ ...valid.items[0], type: 'wizard' }] }
  const errors = validateRegistry(bad)
  assert.ok(errors.some((e) => /type/.test(e)))
})

test('rejects duplicate item ids', () => {
  const bad = { ...valid, items: [valid.items[0], valid.items[0]] }
  const errors = validateRegistry(bad)
  assert.ok(errors.some((e) => /duplicate/i.test(e)))
})

test('requires source, license and copyright on derived items', () => {
  const bad = {
    ...valid,
    items: [{ ...valid.items[0], provenance: { origin: 'derived' } }],
  }
  const errors = validateRegistry(bad)
  assert.ok(errors.some((e) => /source/.test(e)))
  assert.ok(errors.some((e) => /license/.test(e)))
  assert.ok(errors.some((e) => /copyright/.test(e)))
})

test('rejects a non-permissive license', () => {
  const bad = {
    ...valid,
    items: [
      {
        ...valid.items[0],
        provenance: {
          origin: 'derived',
          source: 'https://github.com/foo/bar',
          license: 'CC-BY-NC-4.0',
          copyright: 'Copyright (c) 2024 Foo',
        },
      },
    ],
  }
  const errors = validateRegistry(bad)
  assert.ok(errors.some((e) => /CC-BY-NC-4.0/.test(e)))
})

test('accepts every allowlisted license', () => {
  for (const license of ALLOWED_LICENSES) {
    const reg = {
      ...valid,
      items: [
        {
          ...valid.items[0],
          provenance: {
            origin: 'derived',
            source: 'https://github.com/foo/bar',
            license,
            copyright: 'Copyright (c) 2024 Foo',
          },
        },
      ],
    }
    assert.deepEqual(validateRegistry(reg), [], `license ${license} should pass`)
  }
})

test('rejects a registry that is not an object', () => {
  assert.ok(validateRegistry(null).length > 0)
  assert.ok(validateRegistry([]).length > 0)
})

test('rejects an absolute item path', () => {
  const bad = { ...valid, items: [{ ...valid.items[0], path: '/etc/hosts' }] }
  assert.ok(validateRegistry(bad).some((e) => /relative to the kit root/.test(e)))
})

test('rejects a path containing .. segments', () => {
  for (const p of ['../../../etc/hosts', 'skills/../../secret.md']) {
    const bad = { ...valid, items: [{ ...valid.items[0], path: p }] }
    assert.ok(
      validateRegistry(bad).some((e) => /must not contain "\.\." segments/.test(e)),
      `should reject ${p}`
    )
  }
})

test('accepts an ordinary canonical relative path', () => {
  const ok = {
    ...valid,
    items: [{ ...valid.items[0], id: 'x', path: 'skills/x/SKILL.md' }],
  }
  assert.deepEqual(validateRegistry(ok), [])
})

test('accepts only the exact path shape for each item type', () => {
  const items = [
    { id: 'reviewer', type: 'agent', path: 'agents/reviewer.md' },
    { id: 'release', type: 'command', path: 'commands/release.md' },
    { id: 'release-review', type: 'skill', path: 'skills/release-review/SKILL.md' },
  ]

  for (const item of items) {
    const ok = { ...valid, items: [{ ...valid.items[0], ...item }] }
    assert.deepEqual(validateRegistry(ok), [], `${item.type} path should pass`)
  }
})

test('requires every registry path to use its exact item id', () => {
  for (const item of [
    { id: 'reviewer', type: 'agent', path: 'agents/other.md' },
    { id: 'release', type: 'command', path: 'commands/ship.md' },
    { id: 'release-review', type: 'skill', path: 'skills/other/SKILL.md' },
    { id: 'unity-debugger', type: 'agent', path: 'agents/Unity-Debugger.md' },
  ]) {
    const bad = { ...valid, items: [{ ...valid.items[0], ...item }] }
    assert.ok(
      validateRegistry(bad).some((error) => /use the item id/.test(error)),
      `${item.type} path ${item.path} should be rejected for id ${item.id}`
    )
  }
})

test('requires lowercase kebab-case item ids', () => {
  for (const id of ['UnityDebugger', 'unity_debugger', 'unity--debugger', '-unity', 'unity-']) {
    const bad = {
      ...valid,
      items: [{ ...valid.items[0], id, path: `skills/${id}/SKILL.md` }],
    }
    assert.ok(
      validateRegistry(bad).some((error) => /lowercase kebab-case/.test(error)),
      `${id} should be rejected`
    )
  }
})

test('rejects Windows reserved device names as item ids', () => {
  for (const id of ['con', 'prn', 'aux', 'nul', 'com1', 'com9', 'lpt1', 'lpt9']) {
    const bad = {
      ...valid,
      items: [{ ...valid.items[0], id, path: `skills/${id}/SKILL.md` }],
    }
    assert.ok(
      validateRegistry(bad).some((error) => /reserved on Windows/.test(error)),
      `${id} should be rejected`
    )
  }
})

test('rejects nested or non-Markdown agent and command paths', () => {
  for (const [type, path] of [
    ['agent', 'agents/nested/reviewer.md'],
    ['agent', 'agents/reviewer.txt'],
    ['command', 'commands/release/ship.md'],
    ['command', 'commands/ship.txt'],
  ]) {
    const bad = { ...valid, items: [{ ...valid.items[0], type, path }] }
    assert.ok(
      validateRegistry(bad).some((error) => /must match .* exactly/.test(error)),
      `${path} should be rejected`
    )
  }
})

test('rejects broad or non-canonical skill paths', () => {
  for (const path of [
    'SKILL.md',
    'skills/SKILL.md',
    'skills/release-review',
    'skills/release-review/notes/SKILL.md',
    'skills/./SKILL.md',
  ]) {
    const bad = { ...valid, items: [{ ...valid.items[0], path }] }
    assert.ok(
      validateRegistry(bad).some((error) => /skills\/<id>\/SKILL\.md exactly/.test(error)),
      `${path} should be rejected`
    )
  }
})

test('rejects backslashes in registry paths', () => {
  for (const path of ['skills\\release-review\\SKILL.md', 'agents\\..\\secret.md']) {
    const bad = {
      ...valid,
      items: [{ ...valid.items[0], path }],
    }
    assert.ok(
      validateRegistry(bad).some((error) => /backslashes/.test(error)),
      `${path} should be rejected`
    )
  }
})

test('rejects an original item that carries third-party attribution', () => {
  const bad = {
    ...valid,
    items: [{ ...valid.items[0], provenance: { origin: 'original', license: 'GPL-3.0' } }],
  }
  const errors = validateRegistry(bad)
  assert.ok(errors.some((e) => /origin is "original" but provenance.license is set/.test(e)))
})

test('accepts a license with surrounding whitespace', () => {
  const ok = {
    ...valid,
    items: [
      {
        ...valid.items[0],
        provenance: {
          origin: 'derived',
          source: 'https://github.com/foo/bar',
          license: '  MIT  ',
          copyright: 'Copyright (c) 2024 Foo',
        },
      },
    ],
  }
  assert.deepEqual(validateRegistry(ok), [])
})

test('rejects two items sharing the same path', () => {
  const bad = {
    ...valid,
    items: [valid.items[0], { ...valid.items[0], id: 'different-id' }],
  }
  assert.ok(validateRegistry(bad).some((e) => /duplicate item path/.test(e)))
})

test('accepts every valid kit name', () => {
  for (const kit of ['engineering', 'marketing', 'mobile', 'games']) {
    assert.deepEqual(validateRegistry({ ...valid, kit }), [], `kit "${kit}" should be valid`)
  }
})
