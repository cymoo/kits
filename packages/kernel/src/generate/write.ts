import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { GeneratedFiles } from '../kernel'

// 先写临时文件再改名，内核读配置时不会读到写了一半的文件。路径不许跳出配置目录。
export async function writeGeneratedFiles(dir: string, generated: GeneratedFiles): Promise<void> {
  const root = path.resolve(dir)
  await mkdir(root, { recursive: true })
  for (const file of generated.files) {
    const target = path.resolve(root, file.path)
    if (path.relative(root, target).startsWith('..') || path.isAbsolute(file.path)) {
      throw new Error(`generated file escapes the config dir: ${file.path}`)
    }
    await mkdir(path.dirname(target), { recursive: true })
    const tmp = `${target}.${process.pid}.tmp`
    await writeFile(tmp, file.content, 'utf8')
    await rename(tmp, target)
  }
}
