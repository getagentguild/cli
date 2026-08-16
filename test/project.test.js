import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, parse } from 'node:path'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { findProjectRoot } from '../src/project.js'

async function tempDir(prefix) {
  return mkdtemp(join(tmpdir(), prefix))
}

test('detects a general Git project from a nested directory', async () => {
  const root = await tempDir('ag-project-git-')
  const nested = join(root, 'src', 'feature')
  await mkdir(join(root, '.git'))
  await mkdir(nested, { recursive: true })

  assert.equal(await findProjectRoot(nested), await realpath(root))
})

test('accepts a git-worktree .git file as a project marker', async () => {
  const root = await tempDir('ag-project-worktree-')
  await writeFile(join(root, '.git'), 'gitdir: /tmp/example\n')

  assert.equal(await findProjectRoot(root), await realpath(root))
})

test('does not treat an arbitrary .git file as a project marker', async () => {
  const container = await tempDir('ag-project-fake-git-')
  const root = join(container, 'candidate')
  await mkdir(root)
  await writeFile(join(root, '.git'), 'not a gitdir pointer\n')

  await assert.rejects(
    () => findProjectRoot(root, { homeDir: container }),
    /no project root found/
  )
})

test('detects a package.json project from a nested directory', async () => {
  const root = await tempDir('ag-project-package-')
  const nested = join(root, 'web', 'components')
  await writeFile(join(root, 'package.json'), '{}\n')
  await mkdir(nested, { recursive: true })

  assert.equal(await findProjectRoot(nested), await realpath(root))
})

test('does not treat an invalid package.json as a project marker', async () => {
  const container = await tempDir('ag-project-invalid-package-')
  const root = join(container, 'candidate')
  await mkdir(root)
  await writeFile(join(root, 'package.json'), 'not json\n')

  await assert.rejects(
    () => findProjectRoot(root, { homeDir: container }),
    /no project root found/
  )
})

test('detects a Unity project only when both Unity markers are present', async () => {
  const root = await tempDir('ag-project-unity-')
  const nested = join(root, 'Assets', 'Scripts')
  await mkdir(nested, { recursive: true })
  await mkdir(join(root, 'ProjectSettings'))
  await writeFile(join(root, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 1\n')

  assert.equal(await findProjectRoot(nested), await realpath(root))
})

test('does not accept an incomplete Unity directory as a project root', async () => {
  const container = await tempDir('ag-project-incomplete-unity-')
  const root = join(container, 'candidate')
  const nested = join(root, 'Assets', 'Scripts')
  await mkdir(nested, { recursive: true })

  await assert.rejects(
    () => findProjectRoot(nested, { homeDir: container }),
    /no project root found/
  )
})

test('refuses an existing directory outside a recognizable project', async () => {
  const container = await tempDir('ag-project-none-')
  const dir = join(container, 'candidate')
  await mkdir(dir)
  await assert.rejects(
    () => findProjectRoot(dir, { homeDir: container }),
    /no project root found.*expected a \.git entry/
  )
})

test('fails clearly when the requested path does not exist', async () => {
  const dir = await tempDir('ag-project-missing-')
  const missing = join(dir, 'does-not-exist')
  await assert.rejects(() => findProjectRoot(missing), /project path does not exist/)
})

test('fails clearly when the requested path is a file', async () => {
  const dir = await tempDir('ag-project-file-')
  const file = join(dir, 'target.txt')
  await writeFile(file, 'not a directory\n')
  await assert.rejects(() => findProjectRoot(file), /project path is not a directory/)
})

test('never promotes the home directory to a project root', async () => {
  const fakeHome = await tempDir('ag-project-home-')
  const nested = join(fakeHome, 'unmarked', 'folder')
  await writeFile(join(fakeHome, 'package.json'), '{}\n')
  await mkdir(nested, { recursive: true })

  await assert.rejects(
    () => findProjectRoot(nested, { homeDir: fakeHome }),
    /no project root found/
  )
})

test('never promotes the filesystem root to a project root', async () => {
  const filesystemRoot = parse(tmpdir()).root
  await assert.rejects(
    () => findProjectRoot(filesystemRoot, { homeDir: join(filesystemRoot, 'not-the-home') }),
    /no project root found/
  )
})
