import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { stat } from 'node:fs/promises'

const execFileAsync = promisify(execFile)

export const ORG = 'getagentguild'
export const KIT_REPOS = {
  engineering: `${ORG}/kit-engineering`,
  marketing: `${ORG}/kit-marketing`,
  mobile: `${ORG}/kit-mobile`,
  games: `${ORG}/kit-games`,
}

const defaultRunner = ({ cmd, args, cwd }) => execFileAsync(cmd, args, { cwd })

export async function checkAccess(repo, runner = defaultRunner) {
  try {
    await runner({ cmd: 'git', args: ['ls-remote', `https://github.com/${repo}.git`, 'HEAD'] })
    return true
  } catch {
    return false
  }
}

export async function syncKit(kit, cacheDir, runner = defaultRunner) {
  const repo = KIT_REPOS[kit]
  const dest = join(cacheDir, `kit-${kit}`)

  let cached = false
  try {
    await stat(join(dest, '.git'))
    cached = true
  } catch {
    cached = false
  }

  if (cached) {
    await runner({ cmd: 'git', args: ['pull', '--ff-only'], cwd: dest })
  } else {
    await runner({
      cmd: 'git',
      args: ['clone', '--depth', '1', `https://github.com/${repo}.git`, dest],
    })
  }

  return dest
}

export async function currentGitHubUser(runner = defaultRunner) {
  try {
    const { stdout } = await runner({ cmd: 'gh', args: ['api', 'user', '--jq', '.login'] })
    return stdout.trim() || null
  } catch {
    return null
  }
}

export function diagnose(kit, ghUser) {
  const repo = KIT_REPOS[kit] ?? `${ORG}/kit-${kit}`
  const lines = [`Could not access ${repo}.`]

  if (ghUser) {
    lines.push(
      `You appear to be signed in to GitHub as @${ghUser}.`,
      `If you purchased with a different GitHub account, check your email for the`,
      `repository invitation and accept it with that account.`
    )
  } else {
    lines.push(
      `You do not appear to be signed in to GitHub.`,
      `Run "gh auth login", or configure an SSH key, then try again.`
    )
  }

  lines.push(`If you have not purchased this kit yet: https://agentguild.co`)
  return lines.join('\n')
}
