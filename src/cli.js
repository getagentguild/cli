const HELP = `
agentguild — install AgentGuild kits into your project

Usage:
  agentguild [options]              Install kits you have access to
  agentguild validate <dir>         Validate a kit directory (used by CI)

Options:
  --kit=<name>     Install only this kit (engineering|marketing|mobile)
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

export async function runCli(argv) {
  const opts = parseArgs(argv)
  if (opts.help) {
    console.log(HELP)
    return 0
  }
  console.log(HELP)
  return 0
}
