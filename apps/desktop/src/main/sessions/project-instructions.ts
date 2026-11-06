import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// 项目的 AGENTS.md 和记忆：OpenCode 关了项目配置（dialects/opencode.ts）后也不读这两样，由 kits 随消息带上。
// 从工作目录往上找到仓库根，近的排前面，和内核原来的范围一致。不在仓库里时只看工作目录本身
const FILES = ['AGENTS.md', path.join('.agents', 'memory.md')]

function dirsUpToRepoRoot(workdir: string): string[] {
  const start = path.resolve(workdir)
  const dirs: string[] = []
  for (let dir = start; ; dir = path.dirname(dir)) {
    dirs.push(dir)
    if (existsSync(path.join(dir, '.git'))) return dirs
    if (dir === path.dirname(dir)) return [start]
  }
}

function read(file: string): string {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return ''
  }
}

export function projectInstructions(workdir: string): string {
  return dirsUpToRepoRoot(workdir)
    .flatMap((dir) => FILES.map((name) => path.join(dir, name)))
    .flatMap((file) => {
      const text = read(file)
      return text ? [`Instructions from: ${file}\n${text}`] : []
    })
    .join('\n\n')
}
