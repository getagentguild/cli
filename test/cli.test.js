import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  claudeMdBlock,
  findSelectionCollisions,
  parseArgs,
} from '../src/cli.js'

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

test('CLAUDE.md block counts only the selected items', () => {
  const block = claudeMdBlock([
    {
      kit: {
        registry: {
          kit: 'games',
          items: [{ id: 'one' }, { id: 'two' }, { id: 'three' }],
        },
      },
      itemIds: ['one', 'three'],
    },
  ])

  assert.match(block, /latest AgentGuild installation selected 2 items from games/)
  assert.doesNotMatch(block, /selected 3 items/)
})

test('CLAUDE.md block uses singular item grammar', () => {
  const block = claudeMdBlock([
    {
      kit: { registry: { kit: 'games', items: [{ id: 'one' }] } },
      itemIds: ['one'],
    },
  ])

  assert.match(block, /latest AgentGuild installation selected 1 item from games/)
})

test('CLAUDE.md block handles an empty latest selection honestly', () => {
  const block = claudeMdBlock([
    {
      kit: { registry: { kit: 'games', items: [{ id: 'one' }] } },
      itemIds: [],
    },
  ])

  assert.match(block, /No AgentGuild items were selected in the latest installation run/)
  assert.doesNotMatch(block, /from \./)
})

test('detects destination collisions across selected kits before installation', () => {
  const selections = [
    {
      kit: {
        registry: {
          kit: 'engineering',
          items: [{ id: 'shared-review', type: 'agent' }],
        },
      },
      itemIds: ['shared-review'],
    },
    {
      kit: {
        registry: {
          kit: 'games',
          items: [
            { id: 'shared-review', type: 'agent' },
            { id: 'shared-review-skill', type: 'skill' },
          ],
        },
      },
      itemIds: ['shared-review', 'shared-review-skill'],
    },
  ]

  assert.deepEqual(findSelectionCollisions(selections), [
    'agent "shared-review" is selected from both engineering and games',
  ])
})
