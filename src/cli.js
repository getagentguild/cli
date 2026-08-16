import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { validateKit } from './validate.js'
import { installItems } from './install.js'
import { writeClaudeMd } from './claudemd.js'
import { findProjectRoot } from './project.js'
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
  agentguild [path]                 Install at the detected project root
  agentguild validate <dir>         Validate a kit directory (used by CI)

Options:
  --kit=<name>     Install only this kit (${Object.keys(KIT_REPOS).join('|')})
  --from=<dir>     Install from a local kit directory instead of GitHub
  --yes            Accept defaults, no prompts
  --dry-run        Show what would change without writing
  --update         Pull cached kits before installing (new kits are always cloned)
  --help           Show this help

Project roots are detected from .git, package.json, or a Unity project containing
Assets and ProjectSettings/ProjectVersion.txt. Home and filesystem roots are refused.
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

export function claudeMdBlock(selections) {
  const installed = selections.filter(({ itemIds }) => itemIds.length > 0)
  const names = installed.map(({ kit }) => kit.registry.kit).join(', ')
  const total = installed.reduce((sum, { itemIds }) => sum + itemIds.length, 0)
  const itemLabel = total === 1 ? 'item' : 'items'
  const selectionSummary =
    total === 0
      ? 'No AgentGuild items were selected in the latest installation run.'
      : `The latest AgentGuild installation selected ${total} ${itemLabel} from ${names}.`
  return [
    `## AgentGuild`,
    ``,
    selectionSummary,
    `Agents live in .claude/agents, skills in .claude/skills, commands in .claude/commands.`,
    `Re-run \`npx --yes --package=github:getagentguild/cli agentguild --update\` to update. Edited files are never overwritten.`,
  ].join('\n')
}

export function findSelectionCollisions(selections) {
  const owners = new Map()
  const collisions = []

  for (const { kit, itemIds } of selections) {
    const selected = new Set(itemIds)
    for (const item of kit.registry.items) {
      if (!selected.has(item.id)) continue
      const key = `${item.type}:${item.id}`
      const existing = owners.get(key)
      if (existing) {
        collisions.push(
          `${item.type} "${item.id}" is selected from both ${existing} and ${kit.registry.kit}`
        )
      } else {
        owners.set(key, kit.registry.kit)
      }
    }
  }

  return collisions
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
    let dir
    try {
      dir = await syncKit(name, cacheDir, { update: opts.update })
    } catch (err) {
      console.error(`Could not prepare ${name}: ${err.message}`)
      return null
    }
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
  let projectDir
  try {
    projectDir = await findProjectRoot(opts.target ?? process.cwd())
  } catch (err) {
    console.error(`Could not determine the project root: ${err.message}`)
    return 1
  }

  const kits = await resolveKits(opts)
  if (kits === null) return 1

  const selections = []
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

    selections.push({ kit, itemIds })
  }

  const collisions = findSelectionCollisions(selections)
  if (collisions.length > 0) {
    console.error('Cannot install overlapping items from multiple kits:')
    for (const collision of collisions) console.error(`  • ${collision}`)
    return 1
  }

  // Preflight every selected kit and both root-level instruction paths before
  // the first write. This prevents a malformed destination in a later kit (or
  // a CLAUDE.md/backup symlink) from leaving a partial installation behind.
  const preflight = []
  for (const { kit, itemIds } of selections) {
    try {
      preflight.push(
        await installItems({
          kitDir: kit.kitDir,
          registry: kit.registry,
          itemIds,
          projectDir,
          dryRun: true,
        })
      )
    } catch (err) {
      console.error(`Could not install ${kit.registry.kit}: ${err.message}`)
      return 1
    }
  }

  let claudePreflight
  try {
    claudePreflight = await writeClaudeMd({
      projectDir,
      block: claudeMdBlock(selections),
      dryRun: true,
    })
  } catch (err) {
    console.error(`Could not update CLAUDE.md: ${err.message}`)
    return 1
  }

  const results = []
  if (opts.dryRun) {
    results.push(...preflight)
  } else {
    for (const { kit, itemIds } of selections) {
      let res
      try {
        res = await installItems({
          kitDir: kit.kitDir,
          registry: kit.registry,
          itemIds,
          projectDir,
          dryRun: false,
        })
      } catch (err) {
        console.error(`Could not install ${kit.registry.kit}: ${err.message}`)
        return 1
      }
      results.push(res)
    }
  }

  const totals = { written: 0, skipped: 0, conflicts: [] }
  for (const res of results) {
    totals.written += res.written.length
    totals.skipped += res.skipped.length
    totals.conflicts.push(...res.conflicts)
  }

  let claudeResult = claudePreflight
  if (!opts.dryRun) {
    try {
      claudeResult = await writeClaudeMd({
        projectDir,
        block: claudeMdBlock(selections),
        dryRun: false,
      })
    } catch (err) {
      console.error(`Could not update CLAUDE.md: ${err.message}`)
      return 1
    }
  }
  const { backedUp } = claudeResult

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
