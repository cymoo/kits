import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryService, projectMemoryFile } from './memory-service'

let root: string
afterEach(() => rmSync(root, { recursive: true, force: true }))

function setup() {
  root = mkdtempSync(path.join(os.tmpdir(), 'kits-memory-'))
  const personalFile = path.join(root, 'config', 'memory.md')
  const workdir = path.join(root, 'repo')
  const onPersonalCreated = vi.fn()
  const memory = new MemoryService({
    personalFile,
    sessionTitle: (id) => (id === 's1' ? '给兑换接口加幂等校验' : undefined),
    onPersonalCreated,
    now: () => new Date(2026, 10, 4).getTime(),
  })
  return { memory, personalFile, workdir, onPersonalCreated }
}

describe('MemoryService', () => {
  it('writes a project memory under the workdir with its source and date', () => {
    const { memory, workdir } = setup()
    memory.add('project', '测试命令是 uv run pytest', 'session:s1', workdir)
    expect(readFileSync(projectMemoryFile(workdir), 'utf8')).toBe(
      '- 测试命令是 uv run pytest <!-- session:s1 2026-11-04 -->\n',
    )
    expect(memory.list('project', workdir).entries).toEqual([
      {
        index: 0,
        text: '测试命令是 uv run pytest',
        origin: 'session',
        sessionTitle: '给兑换接口加幂等校验',
        date: '2026-11-04',
      },
    ])
  })

  it('does not write the same memory twice', () => {
    const { memory, workdir } = setup()
    memory.add('project', '回复用中文', 'manual', workdir)
    memory.add('project', '回复用中文', 'session:s1', workdir)
    expect(memory.list('project', workdir).entries).toHaveLength(1)
  })

  it('asks for a kernel restart when the personal file is first created', () => {
    const { memory, onPersonalCreated } = setup()
    memory.add('personal', '不要自动提交', 'manual')
    memory.add('personal', '改动多先列计划', 'manual')
    expect(onPersonalCreated).toHaveBeenCalledOnce()
  })

  it('edits and removes entries and keeps the lines that are not entries', () => {
    const { memory, personalFile } = setup()
    memory.add('personal', '第一条', 'manual')
    const text = readFileSync(personalFile, 'utf8')
    writeFileSync(personalFile, `# 我的偏好\n\n${text}- 手写的一条\n`)
    memory.update('personal', 1, '手写的一条，改过')
    memory.remove('personal', 0)
    expect(readFileSync(personalFile, 'utf8')).toBe('# 我的偏好\n\n- 手写的一条，改过\n')
    expect(memory.list('personal').entries[0]).toMatchObject({ origin: 'file', date: '' })
  })

  it('refuses project memory without a workdir', () => {
    const { memory } = setup()
    expect(() => memory.add('project', 'x', 'manual')).toThrow(/工作目录/)
  })
})
