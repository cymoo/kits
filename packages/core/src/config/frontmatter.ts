import { parse, stringify } from 'yaml'

// Agent 文件和 SKILL.md 都是“YAML frontmatter + Markdown 正文”。
// 只认文件开头的 `---` 块；没有 frontmatter 时 data 为空对象、正文是全文。

export interface Frontmatter {
  data: Record<string, unknown>
  body: string
}

// 两条 `---` 可以紧挨着（空 frontmatter）
const FENCE = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/

export function parseFrontmatter(text: string): Frontmatter {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const match = FENCE.exec(source)
  if (!match) return { data: {}, body: source }
  const parsed: unknown = parse(match[1] ?? '')
  if (
    parsed !== null &&
    parsed !== undefined &&
    (typeof parsed !== 'object' || Array.isArray(parsed))
  ) {
    throw new Error('frontmatter must be a YAML mapping')
  }
  return {
    data: (parsed ?? {}) as Record<string, unknown>,
    body: source.slice(match[0].length).replace(/^\r?\n/, ''),
  }
}

export function stringifyFrontmatter(data: Record<string, unknown>, body: string): string {
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
  const yaml = Object.keys(clean).length > 0 ? stringify(clean, { lineWidth: 0 }) : ''
  return `---\n${yaml}---\n\n${body.replace(/^\n+/, '')}`
}
