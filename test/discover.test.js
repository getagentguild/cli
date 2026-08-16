import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { checkAccess, syncKit, diagnose, KIT_REPOS } from '../src/discover.js'

const ok = async () => ({ stdout: 'ref\tHEAD\n', stderr: '' })
const denied = async () => {
  const err = new Error('exit 128')
  err.stderr = 'remote: Repository not found.'
  throw err
}

test('maps every kit to its repo', () => {
  assert.equal(KIT_REPOS.mobile, 'getagentguild/kit-mobile')
  assert.equal(KIT_REPOS.engineering, 'getagentguild/kit-engineering')
  assert.equal(KIT_REPOS.marketing, 'getagentguild/kit-marketing')
  assert.equal(KIT_REPOS.games, 'getagentguild/kit-games')
  assert.equal(Object.keys(KIT_REPOS).length, 4)
})

test('reports access when ls-remote succeeds', async () => {
  assert.equal(await checkAccess('getagentguild/kit-mobile', ok), true)
})

test('reports no access when ls-remote fails', async () => {
  assert.equal(await checkAccess('getagentguild/kit-mobile', denied), false)
})

test('rejects an unknown kit before resolving a cache destination', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'ag-cache-unknown-kit-'))
  const calls = []
  await assert.rejects(
    () => syncKit('../../escape', cacheDir, async (call) => {
      calls.push(call)
      return { stdout: '', stderr: '' }
    }),
    /unknown kit "\.\.\/\.\.\/escape"/
  )
  assert.deepEqual(calls, [])
})

test('clones when the cache is empty', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'ag-cache-'))
  const calls = []
  const runner = async ({ args }) => {
    calls.push(args[0])
    return { stdout: '', stderr: '' }
  }
  const path = await syncKit('mobile', cacheDir, { runner })
  assert.equal(path, join(await realpath(cacheDir), 'kit-mobile'))
  assert.equal(calls[0], 'clone')
})

test('supports the legacy third-argument runner function', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'ag-cache-legacy-runner-'))
  const calls = []
  const runner = async (call) => {
    calls.push(call)
    return { stdout: '', stderr: '' }
  }

  const path = await syncKit('mobile', cacheDir, runner)
  const expectedPath = join(await realpath(cacheDir), 'kit-mobile')
  assert.equal(path, expectedPath)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], {
    cmd: 'git',
    args: [
      'clone',
      '--depth',
      '1',
      'https://github.com/getagentguild/kit-mobile.git',
      expectedPath,
    ],
  })
})

test(
  'rejects a symlinked cache root without invoking git',
  { skip: process.platform === 'win32' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ag-cache-root-link-'))
    const realCache = join(dir, 'real-cache')
    const cacheLink = join(dir, 'cache-link')
    const calls = []
    await mkdir(realCache)
    await symlink(realCache, cacheLink)

    await assert.rejects(
      () => syncKit('mobile', cacheLink, async (call) => {
        calls.push(call)
        return { stdout: '', stderr: '' }
      }),
      /cache must be a real directory, not a symbolic link/i
    )
    assert.deepEqual(calls, [])
  }
)

test(
  'rejects a symlinked cached kit without invoking git',
  { skip: process.platform === 'win32' },
  async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'ag-cache-kit-link-'))
    const outside = await mkdtemp(join(tmpdir(), 'ag-cache-kit-outside-'))
    const calls = []
    await symlink(outside, join(cacheDir, 'kit-mobile'))

    await assert.rejects(
      () => syncKit('mobile', cacheDir, {
        update: true,
        runner: async (call) => {
          calls.push(call)
          return { stdout: '', stderr: '' }
        },
      }),
      /cached kit-mobile must not be a symbolic link/
    )
    assert.deepEqual(calls, [])
  }
)

test('rejects a cached directory that is not a Git checkout without invoking git', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'ag-cache-not-git-'))
  const calls = []
  await mkdir(join(cacheDir, 'kit-mobile'))

  await assert.rejects(
    () => syncKit('mobile', cacheDir, {
      update: true,
      runner: async (call) => {
        calls.push(call)
        return { stdout: '', stderr: '' }
      },
    }),
    /cached kit-mobile is not a Git checkout/
  )
  assert.deepEqual(calls, [])
})

test(
  'rejects a symlinked cached .git marker without invoking git',
  { skip: process.platform === 'win32' },
  async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'ag-cache-git-link-'))
    const cachedKit = join(cacheDir, 'kit-mobile')
    const outsideGit = await mkdtemp(join(tmpdir(), 'ag-cache-outside-git-'))
    const calls = []
    await mkdir(cachedKit)
    await symlink(outsideGit, join(cachedKit, '.git'))

    await assert.rejects(
      () => syncKit('mobile', cacheDir, {
        update: true,
        runner: async (call) => {
          calls.push(call)
          return { stdout: '', stderr: '' }
        },
      }),
      /cached kit-mobile\/\.git must not be a symbolic link/
    )
    assert.deepEqual(calls, [])
  }
)

test('rejects a cached gitfile because cache clones must own their Git directory', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'ag-cache-gitfile-'))
  const cachedKit = join(cacheDir, 'kit-mobile')
  const calls = []
  await mkdir(cachedKit)
  await writeFile(join(cachedKit, '.git'), 'gitdir: /tmp/untrusted\n')

  await assert.rejects(
    () => syncKit('mobile', cacheDir, {
      update: true,
      runner: async (call) => {
        calls.push(call)
        return { stdout: '', stderr: '' }
      },
    }),
    /cached kit-mobile\/\.git must be a real directory/
  )
  assert.deepEqual(calls, [])
})

test('still clones an uncached kit when update is requested', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'ag-cache-new-update-'))
  const calls = []
  const runner = async ({ args }) => {
    calls.push(args[0])
    return { stdout: '', stderr: '' }
  }

  await syncKit('mobile', cacheDir, { update: true, runner })
  assert.deepEqual(calls, ['clone'])
})

test('uses an existing cached kit without pulling by default', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'ag-cache-reuse-'))
  await mkdir(join(cacheDir, 'kit-mobile', '.git'), { recursive: true })
  const calls = []
  const runner = async (call) => {
    calls.push(call)
    return { stdout: '', stderr: '' }
  }

  const path = await syncKit('mobile', cacheDir, { runner })
  assert.equal(path, join(await realpath(cacheDir), 'kit-mobile'))
  assert.deepEqual(calls, [])
})

test('pulls an existing cached kit only when update is requested', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'ag-cache-update-'))
  const cachedKit = join(cacheDir, 'kit-mobile')
  await mkdir(join(cachedKit, '.git'), { recursive: true })
  const calls = []
  const runner = async (call) => {
    calls.push(call)
    return { stdout: '', stderr: '' }
  }

  const path = await syncKit('mobile', cacheDir, { update: true, runner })
  const expectedPath = await realpath(cachedKit)
  assert.equal(path, expectedPath)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], {
    cmd: 'git',
    args: ['pull', '--ff-only'],
    cwd: expectedPath,
  })
})

test('explains how to recover when a cached kit cannot fast-forward', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'ag-cache-diverged-'))
  const cachedKit = join(cacheDir, 'kit-mobile')
  await mkdir(join(cachedKit, '.git'), { recursive: true })
  const pullError = new Error('exit 128')
  pullError.stderr = 'fatal: Not possible to fast-forward, aborting.'

  await assert.rejects(
    () =>
      syncKit('mobile', cacheDir, {
        update: true,
        runner: async () => {
          throw pullError
        },
      }),
    (err) => {
      assert.match(err.message, /could not update cached kit-mobile/i)
      assert.match(err.message, /Rename .*kit-mobile and rerun/i)
      assert.match(err.message, /without --update/i)
      return true
    }
  )
})

test('diagnosis names the signed-in account when there is one', () => {
  const msg = diagnose('mobile', 'someuser')
  assert.match(msg, /kit-mobile/)
  assert.match(msg, /@someuser/)
  assert.match(msg, /different GitHub account/i)
})

test('diagnosis tells an unauthenticated user how to sign in', () => {
  const msg = diagnose('mobile', null)
  assert.match(msg, /gh auth login/)
})
