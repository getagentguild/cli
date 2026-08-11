import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs } from '../src/cli.js'

test('defaults to the install command', () => {
  const opts = parseArgs([])
  assert.equal(opts.command, 'install')
  assert.equal(opts.kit, null)
  assert.equal(opts.yes, false)
})

test('parses validate subcommand with a target directory', () => {
  const opts = parseArgs(['validate', './kit-mobile'])
  assert.equal(opts.command, 'validate')
  assert.equal(opts.target, './kit-mobile')
})

test('parses value flags', () => {
  const opts = parseArgs(['--kit=mobile', '--from=/tmp/kit'])
  assert.equal(opts.kit, 'mobile')
  assert.equal(opts.from, '/tmp/kit')
})

test('parses boolean flags', () => {
  const opts = parseArgs(['--yes', '--dry-run', '--update'])
  assert.equal(opts.yes, true)
  assert.equal(opts.dryRun, true)
  assert.equal(opts.update, true)
})
