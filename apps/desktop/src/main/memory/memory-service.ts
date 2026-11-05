import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import {
  appendMemory,
  type MemoryEntry,
  type MemoryScope,
  parseMemory,
  updateMemory,
} from '@kits/core'
import type { MemoryOverview } from '@kits/core/ipc'
import { writeFileAtomic } from '../config/atomic'

// 记忆（phase1-implementation 3.5 节）：个人 ~/.kits/memory.md，项目 <工作目录>/.agents/memory.md，一行一条。
// Agent 用 kits 工具 remember 记，设置页 #skills 的记忆列表能看、改、删、手动加；两份文件经内核的 instructions 读入。

export interface MemoryServiceDeps {
  personalFile: string
  // 会话 id → 标题，列表里显示“会话“…””
  sessionTitle(id: string): string | undefined
  // 个人记忆文件第一次建出来：内核配置里的 instructions 只列存在的文件，要重启内核才读得到
  onPersonalCreated(): void
  now?: () => number
}

export function projectMemoryFile(workdir: string): string {
  return path.join(workdir, '.agents', 'memory.md')
}

function today(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export class MemoryService {
  constructor(private readonly deps: MemoryServiceDeps) {}

  private file(scope: MemoryScope, workdir?: string): string {
    if (scope === 'personal') return this.deps.personalFile
    if (!workdir) throw new Error('项目记忆要先选工作区')
    return projectMemoryFile(existsSync(workdir) ? realpathSync(workdir) : workdir)
  }

  private read(file: string): string {
    return existsSync(file) ? readFileSync(file, 'utf8') : ''
  }

  private write(scope: MemoryScope, file: string, text: string): void {
    const created = !existsSync(file)
    writeFileAtomic(file, text)
    if (created && scope === 'personal') this.deps.onPersonalCreated()
  }

  // 打开文件前先确保它在（人要直接在编辑器里写）
  ensure(scope: MemoryScope, workdir?: string): string {
    const file = this.file(scope, workdir)
    if (!existsSync(file)) this.write(scope, file, '')
    return file
  }

  list(scope: MemoryScope, workdir?: string): MemoryOverview {
    const file = this.file(scope, workdir)
    return {
      path: file,
      entries: parseMemory(this.read(file)).map((e, index) => {
        const sessionId = e.source.startsWith('session:') ? e.source.slice(8) : undefined
        const title = sessionId ? this.deps.sessionTitle(sessionId) : undefined
        return {
          index,
          text: e.text,
          origin: sessionId ? 'session' : e.source === 'manual' ? 'manual' : 'file',
          ...(title ? { sessionTitle: title } : {}),
          date: e.date,
        }
      }),
    }
  }

  // 同样的话已经记过就不再记一遍
  add(scope: MemoryScope, text: string, source: string, workdir?: string): void {
    const clean = text.replace(/\s*\r?\n\s*/g, ' ').trim()
    if (!clean) throw new Error('记忆不能是空的')
    const file = this.file(scope, workdir)
    const current = this.read(file)
    if (parseMemory(current).some((e) => e.text === clean)) return
    const entry: MemoryEntry = { text: clean, source, date: today((this.deps.now ?? Date.now)()) }
    this.write(scope, file, appendMemory(current, entry))
  }

  // 改了正文，来源和日期保留
  update(scope: MemoryScope, index: number, text: string, workdir?: string): void {
    const clean = text.replace(/\s*\r?\n\s*/g, ' ').trim()
    if (!clean) throw new Error('记忆不能是空的')
    const file = this.file(scope, workdir)
    const current = this.read(file)
    const entry = parseMemory(current)[index]
    if (!entry) throw new Error('这条记忆已经不在了，刷新一下')
    this.write(scope, file, updateMemory(current, index, { ...entry, text: clean }))
  }

  remove(scope: MemoryScope, index: number, workdir?: string): void {
    const file = this.file(scope, workdir)
    const current = this.read(file)
    if (!parseMemory(current)[index]) throw new Error('这条记忆已经不在了，刷新一下')
    this.write(scope, file, updateMemory(current, index, null))
  }
}
