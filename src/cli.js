import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { validateKit } from './validate.js'
import { installItems } from './install.js'
import { writeClaudeMd } from './claudemd.js'
import {
  KIT_REPOS,
  checkAccess,
  syncKit,
  currentGitHubUser,
  diagnose,
} from './discover.js'

const HELP = `
agentguild — install AgentGuild kits into your project

Usage:
  agentguild [dir]                  Install kits you have access to
  agentguild validate <dir>         Validate a kit directory (used by CI)

Options:
  --kit=<name>     Install only this kit (${Object.keys(KIT_REPOS).join('|')})
  --from=<dir>     Install from a local kit directory instead of GitHub
  --yes            Accept defaults, no prompts
  --dry-run        Show what would change without writing
  --update         Refresh cached kits before installing
  --help           Show this help
`.trim()

export function parseArgs(argv) {
  const opts = {
    command: 'install',
    kit: null,
    from: null,
    yes: false,
    dryRun: false,
    update: false,
    help: false,
    target: null,
  }
  for (const arg of argv) {
    if (arg === 'validate') opts.command = 'validate'
    else if (arg === '--yes' || arg === '-y') opts.yes = true
    else if (arg === '--dry-run') opts.dryRun = true
    else if (arg === '--update') opts.update = true
    else if (arg === '--help' || arg === '-h') opts.help = true
    else if (arg.startsWith('--kit=')) opts.kit = arg.slice(6)
    else if (arg.startsWith('--from=')) opts.from = arg.slice(7)
    else if (!arg.startsWith('-')) opts.target = arg
  }
  return opts
}

function claudeMdBlock(kits) {
  const names = kits.map((k) => k.registry.kit).join(', ')
  const total = kits.reduce((sum, k) => sum + k.registry.items.length, 0)
  return [
    `## AgentGuild`,
    ``,
    `This project has ${total} AgentGuild items installed (${names}).`,
    `Agents live in .claude/agents, skills in .claude/skills, commands in .claude/commands.`,
    `Re-run \`npx @agentguild/cli\` to update. Edited files are never overwritten.`,
  ].join('\n')
}

async function loadKitDir(kitDir) {
  const { errors } = await validateKit(kitDir)
  if (errors.length > 0) {
    console.error(`✗ ${kitDir} failed validation:\n`)
    for (const err of errors) console.error(`  • ${err}`)
    return null
  }
  const registry = JSON.parse(await readFile(join(kitDir, 'registry.json'), 'utf8'))
  return { kitDir, registry }
}

async function resolveKits(opts) {
  if (opts.from) {
    const kit = await loadKitDir(opts.from)
    return kit ? [kit] : null
  }

  const cacheDir = join(homedir(), '.agentguild', 'cache')
  await mkdir(cacheDir, { recursive: true })

  const wanted = opts.kit ? [opts.kit] : Object.keys(KIT_REPOS)
  const kits = []
  const denied = []

  for (const name of wanted) {
    if (!KIT_REPOS[name]) {
      console.error(`Unknown kit "${name}". Expected one of: ${Object.keys(KIT_REPOS).join(', ')}`)
      return null
    }
    if (!(await checkAccess(KIT_REPOS[name]))) {
      denied.push(name)
      continue
    }
    const dir = await syncKit(name, cacheDir)
    const kit = await loadKitDir(dir)
    if (kit) kits.push(kit)
  }

  if (kits.length === 0) {
    const ghUser = await currentGitHubUser()
    for (const name of denied) console.error(`\n${diagnose(name, ghUser)}`)
    return null
  }

  for (const name of denied) console.log(`(skipping ${name} — no access)`)
  return kits
}

export async function runInstall(opts) {
  const projectDir = opts.target ?? process.cwd()

  const kits = await resolveKits(opts)
  if (kits === null) return 1

  const totals = { written: 0, skipped: 0, conflicts: [] }

  for (const kit of kits) {
    let itemIds = kit.registry.items.map((i) => i.id)
    if (!opts.yes) {
      const { pickItems } = await import('./prompts.js')
      const picked = await pickItems(kit.registry)
      if (picked === null) {
        console.log('Cancelled.')
        return 1
      }
      itemIds = picked
    }

    const res = await installItems({
      kitDir: kit.kitDir,
      registry: kit.registry,
      itemIds,
      projectDir,
      dryRun: opts.dryRun,
    })

    totals.written += res.written.length
    totals.skipped += res.skipped.length
    totals.conflicts.push(...res.conflicts)
  }

  const { backedUp } = await writeClaudeMd({
    projectDir,
    block: claudeMdBlock(kits),
    dryRun: opts.dryRun,
  })

  const prefix = opts.dryRun ? 'Would install' : 'Installed'
  console.log(`\n${prefix} ${totals.written} file(s) into ${projectDir}`)
  if (totals.skipped > 0) console.log(`${totals.skipped} already up to date`)
  if (backedUp) console.log(`Backed up your CLAUDE.md to ${backedUp}`)
  if (totals.conflicts.length > 0) {
    console.log(`\nLeft ${totals.conflicts.length} modified file(s) untouched:`)
    for (const c of totals.conflicts) console.log(`  • ${c}`)
  }

  return 0
}

export async function runCli(argv) {
  const opts = parseArgs(argv)
  if (opts.help) {
    console.log(HELP)
    return 0
  }

  if (opts.command === 'validate') {
    const dir = opts.target ?? process.cwd()
    const { errors, counts } = await validateKit(dir)
    if (errors.length > 0) {
      console.error(`✗ ${errors.length} validation error(s) in ${dir}\n`)
      for (const err of errors) console.error(`  • ${err}`)
      return 1
    }
    const total = counts.agent + counts.skill + counts.command
    console.log(
      `✓ ${dir} is valid — ${total} items ` +
        `(${counts.agent} agents, ${counts.skill} skills, ${counts.command} commands)`
    )
    return 0
  }

  return runInstall(opts)
}
