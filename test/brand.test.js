import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Brand drift. Buyers see "AI Games Kit" (or a product-neutral "kit"); the capitalised AgentGuild / AgentsGuild brand
// and the old domain must not appear anywhere in the installer. The lowercase `agentguild` stays on purpose as an
// identifier that existing installs depend on (decision b of the rebrand): the `agentguild` command, the
// getagentguild organisation, the @agentguild/cli package scope, the <!-- agentguild:start/end --> block markers,
// the CLAUDE.md.agentguild-backup file and the ~/.agentguild/cache folder.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OLD_BRAND = /AgentGuild|AgentsGuild|agentsguild/

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name !== '.git' && entry.name !== 'node_modules') yield* walk(join(dir, entry.name))
    } else if (entry.isFile() && entry.name !== '.DS_Store') {
      yield join(dir, entry.name)
    }
  }
}

test('no old brand name in the installer, its docs or its tests', async () => {
  const stray = []
  for await (const file of walk(root)) {
    const path = relative(root, file).split(sep).join('/')
    if (path === 'test/brand.test.js' || path === 'package-lock.json') continue
    const lines = (await readFile(file, 'utf8')).split('\n')
    lines.forEach((line, index) => {
      if (OLD_BRAND.test(line)) stray.push(`${path}:${index + 1}: ${line.trim().slice(0, 160)}`)
    })
  }
  assert.deepEqual(stray, [])
})

test('the aigameskit command is the same program as agentguild', async () => {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.bin.agentguild, './bin/agentguild.js')
  assert.equal(pkg.bin.aigameskit, pkg.bin.agentguild)
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
  assert.deepEqual(lock.packages[''].bin, { agentguild: 'bin/agentguild.js', aigameskit: 'bin/agentguild.js' })
})
