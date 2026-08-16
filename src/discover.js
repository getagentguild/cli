import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { lstat, realpath } from 'node:fs/promises'

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

function isContained(root, target) {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

async function inspectCache(cacheDir, kit) {
  const lexicalRoot = resolve(cacheDir)
  const rootInfo = await lstat(lexicalRoot)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('AgentGuild cache must be a real directory, not a symbolic link')
  }

  const cacheRoot = await realpath(lexicalRoot)
  const dest = join(cacheRoot, `kit-${kit}`)
  let destInfo
  try {
    destInfo = await lstat(dest)
  } catch (err) {
    if (err.code === 'ENOENT') return { cacheRoot, dest, cached: false }
    throw err
  }

  if (destInfo.isSymbolicLink()) {
    throw new Error(`cached kit-${kit} must not be a symbolic link`)
  }
  if (!destInfo.isDirectory()) {
    throw new Error(`cached kit-${kit} must be a directory`)
  }

  const resolvedDest = await realpath(dest)
  if (!isContained(cacheRoot, resolvedDest)) {
    throw new Error(`cached kit-${kit} resolves outside the AgentGuild cache`)
  }

  const gitMarker = join(resolvedDest, '.git')
  let gitInfo
  try {
    gitInfo = await lstat(gitMarker)
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      throw new Error(`cached kit-${kit} is not a Git checkout`)
    }
    throw err
  }
  if (gitInfo.isSymbolicLink()) {
    throw new Error(`cached kit-${kit}/.git must not be a symbolic link`)
  }
  if (!gitInfo.isDirectory()) {
    throw new Error(`cached kit-${kit}/.git must be a real directory`)
  }
  const resolvedGitMarker = await realpath(gitMarker)
  if (!isContained(resolvedDest, resolvedGitMarker)) {
    throw new Error(`cached kit-${kit}/.git resolves outside the cached checkout`)
  }
  return { cacheRoot, dest: resolvedDest, cached: true }
}

export async function syncKit(kit, cacheDir, options = {}) {
  // Preserve the original documented third-argument runner interface while
  // accepting the newer options object that carries `--update` semantics.
  const update = typeof options === 'function' ? false : (options.update ?? false)
  const runner = typeof options === 'function' ? options : (options.runner ?? defaultRunner)
  if (!Object.hasOwn(KIT_REPOS, kit)) {
    throw new Error(`unknown kit "${kit}"`)
  }
  const repo = KIT_REPOS[kit]
  const { dest, cached } = await inspectCache(cacheDir, kit)

  if (cached && update) {
    try {
      await runner({ cmd: 'git', args: ['pull', '--ff-only'], cwd: dest })
    } catch (err) {
      const detail = err.stderr?.trim() || err.message
      throw new Error(
        `could not update cached kit-${kit}; Git pull with --ff-only failed. ` +
          `If the cache diverged, rename ${dest} and rerun to clone a clean cache. ` +
          `Otherwise check your connection and GitHub access, or rerun without --update ` +
          `to use the current cached copy unchanged. ${detail}`
      )
    }
  } else if (!cached) {
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

  lines.push(`If you have not purchased this kit yet, use AgentGuild's current checkout link.`)
  return lines.join('\n')
}
