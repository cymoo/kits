import { readdir } from 'node:fs/promises'
import path from 'node:path'

// 输入框 @ 菜单的文件搜索（phase1-implementation PR11 的 files.search）：
// 列出工作目录里的文件（跳过 .git、node_modules 这类目录），按路径匹配，返回相对路径。
// 列表缓存 30 秒，连着打字不用每次都走一遍目录。

export const SKIP = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  'dist',
  'out',
  'build',
  'target',
  'coverage',
  '.next',
  '.turbo',
  '.idea',
  '.gradle',
])
// 大仓库只列这么多，再多也不靠 @ 菜单找了
const MAX_FILES = 20_000
const TTL_MS = 30_000
const LIMIT = 30

export async function listFiles(root: string, max = MAX_FILES): Promise<string[]> {
  const out: string[] = []
  const queue = ['']
  while (queue.length && out.length < max) {
    const rel = queue.shift() as string
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(path.join(root, rel), { withFileTypes: true })
    } catch {
      continue
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) queue.push(child)
      } else if (e.isFile()) {
        out.push(child)
        if (out.length >= max) break
      }
    }
  }
  return out
}

// 排序：文件名开头命中 > 文件名里有 > 路径里有；同一档短路径在前
export function rankFiles(files: string[], query: string, limit = LIMIT): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return files.slice(0, limit)
  const scored: [number, string][] = []
  for (const f of files) {
    const lower = f.toLowerCase()
    const base = lower.slice(lower.lastIndexOf('/') + 1)
    const score = base.startsWith(q) ? 0 : base.includes(q) ? 1 : lower.includes(q) ? 2 : -1
    if (score >= 0) scored.push([score, f])
  }
  return scored
    .sort((a, b) => a[0] - b[0] || a[1].length - b[1].length || a[1].localeCompare(b[1]))
    .slice(0, limit)
    .map(([, f]) => f)
}

export class FileSearch {
  private cache = new Map<string, { at: number; files: Promise<string[]> }>()

  constructor(private readonly now: () => number = Date.now) {}

  async search(workdir: string, query: string): Promise<string[]> {
    let entry = this.cache.get(workdir)
    if (!entry || this.now() - entry.at > TTL_MS) {
      entry = { at: this.now(), files: listFiles(workdir) }
      this.cache.set(workdir, entry)
    }
    return rankFiles(await entry.files, query)
  }
}
