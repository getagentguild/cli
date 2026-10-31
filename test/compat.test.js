import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { runCli } from '../src/cli.js'

// Buyers already have installs made by the published installer (getagentguild/cli main at f313b70, before the AI Games
// Kit rename). The two CLAUDE.md files in fixtures/published-f313b70/ are exactly what that installer wrote for the two
// fixture kits, with the owner's own lines above and below the block. An update with this installer must rewrite the
// block in place: one marker pair, the owner's lines untouched, the new wording, and nothing more on a second run.
const here = dirname(fileURLToPath(import.meta.url))
const PUBLISHED = join(here, 'fixtures', 'published-f313b70')
const START = '<!-- agentguild:start -->'
const END = '<!-- agentguild:end -->'

async function projectFrom(publishedClaudeMd, prefix) {
  const projectDir = await mkdtemp(join(tmpdir(), prefix))
  await writeFile(join(projectDir, 'package.json'), '{}\n')
  await cp(join(PUBLISHED, publishedClaudeMd), join(projectDir, 'CLAUDE.md'))
  return projectDir
}

const outside = (text) => [text.slice(0, text.indexOf(START)), text.slice(text.indexOf(END) + END.length)]
const count = (text, needle) => text.split(needle).length - 1

for (const [fixture, kit, heading, owner] of [
  ['games-CLAUDE.md', 'games-agreements-kit', '## AI Games Kit', ['Mine.', 'Also mine.']],
  ['mobile-CLAUDE.md', 'good-kit', '## Mobile Kit', ['Owner notes before the block.', 'Owner notes after the block.']],
]) {
  test(`an install made by the published installer updates in place (${kit})`, async () => {
    const projectDir = await projectFrom(fixture, 'ag-compat-')
    const before = await readFile(join(projectDir, 'CLAUDE.md'), 'utf8')
    assert.match(before, /^## AgentGuild$/m, 'the fixture is the old wording')

    assert.equal(await runCli(['--from=' + join(here, 'fixtures', kit), '--update', '--yes', projectDir]), 0)
    const after = await readFile(join(projectDir, 'CLAUDE.md'), 'utf8')

    assert.equal(count(after, START), 1)
    assert.equal(count(after, END), 1)
    assert.ok(after.indexOf(START) < after.indexOf(END))
    assert.deepEqual(outside(after), outside(before), 'the owner lines around the block are byte-identical')
    for (const line of owner) assert.ok(after.includes(line))
    assert.match(after, new RegExp(`^${heading}$`, 'm'))
    assert.doesNotMatch(after, /AgentGuild/)
    assert.match(after, /npx --yes --package=github:getagentguild\/cli agentguild --update/)
    if (kit === 'games-agreements-kit') assert.match(after, /### Kit working agreements/)

    // The pre-update file is backed up under the name the published installer used.
    assert.equal(await readFile(join(projectDir, 'CLAUDE.md.agentguild-backup'), 'utf8'), before)

    assert.equal(await runCli(['--from=' + join(here, 'fixtures', kit), '--update', '--yes', projectDir]), 0)
    assert.equal(await readFile(join(projectDir, 'CLAUDE.md'), 'utf8'), after, 'a second run changes nothing')
  })
}
