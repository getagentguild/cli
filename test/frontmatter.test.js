import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFrontmatter } from '../src/frontmatter.js'

test('parses flat key/value frontmatter', () => {
  const input = [
    '---',
    'name: postgres-pro',
    'description: Use when optimizing Postgres queries',
    'tools: Read, Grep, Bash',
    'model: sonnet',
    '---',
    '',
    '# Postgres Pro',
  ].join('\n')
  const { data, body } = parseFrontmatter(input)
  assert.equal(data.name, 'postgres-pro')
  assert.equal(data.description, 'Use when optimizing Postgres queries')
  assert.equal(data.tools, 'Read, Grep, Bash')
  assert.equal(data.model, 'sonnet')
  assert.match(body, /# Postgres Pro/)
})

test('returns empty data when there is no frontmatter', () => {
  const { data, body } = parseFrontmatter('# Just a heading\n')
  assert.deepEqual(data, {})
  assert.equal(body, '# Just a heading\n')
})

test('strips surrounding quotes from values', () => {
  const input = '---\nname: "quoted-name"\n---\nbody\n'
  const { data } = parseFrontmatter(input)
  assert.equal(data.name, 'quoted-name')
})

test('ignores comment lines and blank lines inside frontmatter', () => {
  const input = '---\n# a comment\n\nname: x\n---\nbody\n'
  const { data } = parseFrontmatter(input)
  assert.deepEqual(data, { name: 'x' })
})

test('keeps colons that appear inside a value', () => {
  const input = '---\ndescription: Use when: you need it\n---\nbody\n'
  const { data } = parseFrontmatter(input)
  assert.equal(data.description, 'Use when: you need it')
})
