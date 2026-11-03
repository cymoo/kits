// 记忆：memory.md，一行一条无序列表，每条末尾用 HTML 注释记来源和日期：
//   - 测试命令是 uv run pytest。 <!-- session:01J… 2026-10-29 -->
//   - 接口返回时间一律 ISO 8601 带时区。 <!-- manual 2026-10-27 -->
// 个人在 ~/.kits/memory.md，项目在 <工作目录>/.agents/memory.md；内核经 instructions 读入。
// 不是列表项的行（标题、空行、人手写的说明）原样保留，只有列表项算记忆。

export type MemoryScope = 'project' | 'personal'

export interface MemoryEntry {
  text: string
  // `manual` 或 `session:<id>`；人手写、没带注释的为空串
  source: string
  // YYYY-MM-DD，没带注释的为空串
  date: string
}

const ITEM = /^[-*]\s+(.*?)\s*(?:<!--\s*(\S+)(?:\s+(\d{4}-\d{2}-\d{2}))?\s*-->)?\s*$/

export function parseMemory(text: string): MemoryEntry[] {
  const entries: MemoryEntry[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = ITEM.exec(line)
    if (!m?.[1]) continue
    entries.push({ text: m[1], source: m[2] ?? '', date: m[3] ?? '' })
  }
  return entries
}

export function formatMemoryEntry(entry: MemoryEntry): string {
  // 一条只占一行，换行压成空格
  const text = entry.text.replace(/\s*\r?\n\s*/g, ' ').trim()
  const meta = [entry.source, entry.date].filter(Boolean).join(' ')
  return meta ? `- ${text} <!-- ${meta} -->` : `- ${text}`
}

export function appendMemory(text: string, entry: MemoryEntry): string {
  const line = formatMemoryEntry(entry)
  if (text.length === 0) return `${line}\n`
  return `${text.replace(/\s*$/, '')}\n${line}\n`
}

// 按序号改或删（序号是 parseMemory 返回的下标），非列表行不动
export function updateMemory(text: string, index: number, entry: MemoryEntry | null): string {
  const lines = text.split(/\r?\n/)
  let seen = -1
  const out: string[] = []
  for (const line of lines) {
    const m = ITEM.exec(line)
    if (m?.[1]) {
      seen += 1
      if (seen === index) {
        if (entry) out.push(formatMemoryEntry(entry))
        continue
      }
    }
    out.push(line)
  }
  if (seen < index) throw new Error(`memory entry ${index} not found`)
  return out.join('\n')
}
