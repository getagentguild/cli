import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
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

test('clones when the cache is empty', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'ag-cache-'))
  const calls = []
  const runner = async ({ args }) => {
    calls.push(args[0])
    return { stdout: '', stderr: '' }
  }
  const path = await syncKit('mobile', cacheDir, runner)
  assert.equal(path, join(cacheDir, 'kit-mobile'))
  assert.equal(calls[0], 'clone')
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
