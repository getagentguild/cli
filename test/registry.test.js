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
