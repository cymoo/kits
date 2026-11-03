import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileSearch, listFiles, rankFiles } from './search'

let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'kits-files-'))
  const file = (rel: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), '')
  }
  for (const f of [
    'README.md',
    'src/points/redeem.py',
    'src/points/refund.py',
    'tests/points/test_redeem.py',
    'node_modules/x/index.js',
    '.git/HEAD',
  ])
    file(f)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('listFiles', () => {
  it('lists files with relative slash paths and skips vendored and vcs folders', async () => {
    expect(await listFiles(root)).toEqual([
      'README.md',
      'src/points/redeem.py',
      'src/points/refund.py',
      'tests/points/test_redeem.py',
    ])
  })
})

describe('rankFiles', () => {
  it('puts file names starting with the query first, then names containing it, then paths', () => {
    const files = [
      'tests/points/test_redeem.py',
      'src/points/redeem.py',
      'docs/points.md',
      'a/b.md',
    ]
    expect(rankFiles(files, 'redeem')).toEqual([
      'src/points/redeem.py',
      'tests/points/test_redeem.py',
    ])
    expect(rankFiles(files, 'points')).toEqual([
      'docs/points.md',
      'src/points/redeem.py',
      'tests/points/test_redeem.py',
    ])
  })
})

describe('FileSearch', () => {
  it('reuses the listing for a while so typing does not walk the folder every time', async () => {
    let t = 0
    const search = new FileSearch(() => t)
    expect(await search.search(root, 'refund')).toEqual(['src/points/refund.py'])
    writeFileSync(path.join(root, 'src/points/refund_v2.py'), '')
    expect(await search.search(root, 'refund')).toEqual(['src/points/refund.py'])
    t = 31_000
    expect(await search.search(root, 'refund')).toEqual([
      'src/points/refund.py',
      'src/points/refund_v2.py',
    ])
  })
})
