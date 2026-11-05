import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listDir, readPreview, resolveInside } from './browse'

let root: string
let work: string
beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'kits-browse-')))
  work = path.join(root, 'work')
  mkdirSync(path.join(work, 'src'), { recursive: true })
  mkdirSync(path.join(work, 'node_modules'))
  writeFileSync(path.join(work, 'src', 'a.py'), 'print(1)\n')
  writeFileSync(path.join(work, 'README.md'), '# hi\n')
  writeFileSync(path.join(root, 'secret.txt'), 'nope\n')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('listDir', () => {
  it('lists folders first and skips dependency folders', async () => {
    expect(await listDir(work, '')).toEqual([
      { name: 'src', path: 'src', dir: true },
      { name: 'README.md', path: 'README.md', dir: false },
    ])
  })

  it('lists a subfolder with paths from the workspace root', async () => {
    expect(await listDir(work, 'src')).toEqual([{ name: 'a.py', path: 'src/a.py', dir: false }])
  })

  it('leaves out a broken link', async () => {
    symlinkSync(path.join(work, 'gone'), path.join(work, 'broken'))
    expect((await listDir(work, '')).map((e) => e.name)).not.toContain('broken')
  })

  it('refuses to list outside the workspace', async () => {
    await expect(listDir(work, '..')).rejects.toThrow('不在工作区里')
  })
})

describe('resolveInside', () => {
  it('refuses a parent path', async () => {
    await expect(resolveInside(work, '../secret.txt')).rejects.toThrow('不在工作区里')
  })

  it('refuses an absolute path outside', async () => {
    await expect(resolveInside(work, path.join(root, 'secret.txt'))).rejects.toThrow()
  })

  it('refuses a link that leaves the workspace', async () => {
    symlinkSync(path.join(root, 'secret.txt'), path.join(work, 'link.txt'))
    await expect(resolveInside(work, 'link.txt')).rejects.toThrow('不在工作区里')
  })

  it('follows a link that stays inside', async () => {
    symlinkSync(path.join(work, 'README.md'), path.join(work, 'link.md'))
    expect(await resolveInside(work, 'link.md')).toBe(path.join(work, 'README.md'))
  })

  it('does not mistake a sibling with the same prefix for the workspace', async () => {
    mkdirSync(path.join(root, 'work2'))
    writeFileSync(path.join(root, 'work2', 'x.txt'), 'x')
    await expect(resolveInside(work, '../work2/x.txt')).rejects.toThrow('不在工作区里')
  })
})

describe('readPreview', () => {
  it('reads a text file', async () => {
    expect(await readPreview(work, 'README.md')).toEqual({
      kind: 'text',
      text: '# hi\n',
      size: 5,
      truncated: false,
    })
  })

  it('treats a file with NUL bytes as binary', async () => {
    writeFileSync(path.join(work, 'a.bin'), Buffer.from([1, 0, 2]))
    expect(await readPreview(work, 'a.bin')).toMatchObject({
      kind: 'unsupported',
      reason: 'binary',
    })
  })

  it('shows the head of a big text file up to a whole line', async () => {
    writeFileSync(path.join(work, 'big.log'), 'line\n'.repeat(500_000))
    const preview = await readPreview(work, 'big.log')
    expect(preview).toMatchObject({ kind: 'text', truncated: true })
    expect(preview.kind === 'text' && preview.text.endsWith('line\n')).toBe(true)
  })

  it('keeps the head of a big file without line breaks', async () => {
    writeFileSync(path.join(work, 'one.txt'), 'a'.repeat(3 * 1024 * 1024))
    const preview = await readPreview(work, 'one.txt')
    expect(preview.kind === 'text' && preview.text.length).toBe(2 * 1024 * 1024)
  })

  it('does not read a file over the limit', async () => {
    writeFileSync(path.join(work, 'huge.log'), Buffer.alloc(21 * 1024 * 1024, 'a'))
    expect(await readPreview(work, 'huge.log')).toMatchObject({
      kind: 'unsupported',
      reason: 'large',
    })
  })
})
