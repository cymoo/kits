import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractReleaseNotes, writeReleaseNotes } from './release-notes.mjs'

const CHANGELOG = `# 更新日志

## [Unreleased]

### 新增
- 还没发的功能

## [0.2.1] - 2026-11-07

### 新增
- 侧栏底部的新版本提示

### 修复
- Windows 上 grep、glob 找不到 ripgrep

## [0.2.0] - 2026-11-01

### 新增
- 第一版

[0.2.1]: https://example.invalid/compare/v0.2.0...v0.2.1
[0.2.0]: https://example.invalid/releases/v0.2.0
`

describe('extractReleaseNotes', () => {
  it('returns the section of the version up to the next version heading', () => {
    expect(extractReleaseNotes(CHANGELOG, '0.2.1')).toBe(
      '### 新增\n- 侧栏底部的新版本提示\n\n### 修复\n- Windows 上 grep、glob 找不到 ripgrep',
    )
  })

  it('leaves out the link definitions at the end of the file', () => {
    expect(extractReleaseNotes(CHANGELOG, '0.2.0')).toBe('### 新增\n- 第一版')
  })

  it('returns an empty string when the version has no section', () => {
    expect(extractReleaseNotes(CHANGELOG, '0.3.0')).toBe('')
  })

  it('does not take 0.2.10 for 0.2.1', () => {
    expect(extractReleaseNotes('## [0.2.10] - x\n- a\n', '0.2.1')).toBe('')
  })
})

describe('writeReleaseNotes', () => {
  let dir: string
  let changelog: string
  let out: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kits-notes-'))
    changelog = path.join(dir, 'CHANGELOG.md')
    out = path.join(dir, 'release-notes.md')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes the section of the version', () => {
    writeFileSync(changelog, CHANGELOG)
    writeReleaseNotes('0.2.0', { changelog, out })
    expect(readFileSync(out, 'utf8')).toBe('### 新增\n- 第一版\n')
  })

  it('removes notes left by an earlier build when the version has no section', () => {
    writeFileSync(changelog, CHANGELOG)
    writeFileSync(out, 'old notes')
    writeReleaseNotes('0.3.0', { changelog, out })
    expect(existsSync(out)).toBe(false)
  })

  it('packages without notes when there is no CHANGELOG', () => {
    expect(writeReleaseNotes('0.2.0', { changelog, out })).toBe('')
    expect(existsSync(out)).toBe(false)
  })
})
