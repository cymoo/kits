import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { projectInstructions } from './project-instructions'

describe('projectInstructions', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'kits-instructions-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const put = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), text)
  }

  it('is empty when the project has neither file', () => {
    expect(projectInstructions(root)).toBe('')
  })

  it('names the file each text came from', () => {
    put('AGENTS.md', '用中文回答\n')
    expect(projectInstructions(root)).toBe(
      `Instructions from: ${path.join(root, 'AGENTS.md')}\n用中文回答`,
    )
  })

  it('reads the project memory too', () => {
    put('.agents/memory.md', '- 测试库在 10.0.0.1')
    expect(projectInstructions(root)).toContain('测试库在 10.0.0.1')
  })

  it('walks up to the repository root, the nearest file first', () => {
    mkdirSync(path.join(root, '.git'))
    put('AGENTS.md', '仓库根')
    put('apps/web/AGENTS.md', '子目录')
    const text = projectInstructions(path.join(root, 'apps/web'))
    expect(text.indexOf('子目录')).toBeLessThan(text.indexOf('仓库根'))
    expect(text).toContain('仓库根')
  })

  it('stops at the repository root', () => {
    put('AGENTS.md', '仓库外面')
    mkdirSync(path.join(root, 'repo/.git'), { recursive: true })
    expect(projectInstructions(path.join(root, 'repo'))).toBe('')
  })

  it('only looks at the working directory outside a repository', () => {
    put('AGENTS.md', '上一级')
    mkdirSync(path.join(root, 'work'))
    expect(projectInstructions(path.join(root, 'work'))).toBe('')
  })
})
