import { open, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { FileEntry, FilePreview } from '@kits/core'
import { SKIP } from './search'

// 文件面板（界面改版方案“文件面板”一节）：一层层列目录、按类型读文件。
// 只读工作区里的东西：根目录和目标都取真实路径再比，软链接逃出去的一律拒绝。

const require = createRequire(import.meta.url)

const IMAGES: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
}

// 再大的文本只显示开头
const TEXT_LIMIT = 2 * 1024 * 1024
// 比这大的不读
const FILE_LIMIT = 20 * 1024 * 1024
const SNIFF = 8192

// 工作区里的相对路径 → 真实路径；不在工作区里时抛错
export async function resolveInside(workdir: string, rel: string): Promise<string> {
  const root = await realpath(workdir)
  const target = await realpath(path.resolve(root, rel))
  const inside = path.relative(root, target)
  if (inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) {
    throw new Error('这个文件不在工作区里')
  }
  return target
}

export async function listDir(workdir: string, dir: string): Promise<FileEntry[]> {
  const base = await resolveInside(workdir, dir)
  const entries = await readdir(base, { withFileTypes: true })
  const list: FileEntry[] = []
  for (const e of entries) {
    if (SKIP.has(e.name)) continue
    const rel = dir ? `${dir}/${e.name}` : e.name
    if (e.isDirectory()) list.push({ name: e.name, path: rel, dir: true })
    else if (e.isFile()) list.push({ name: e.name, path: rel, dir: false })
    else if (e.isSymbolicLink()) {
      // 坏掉的软链接不列
      const target = await stat(path.join(base, e.name)).catch(() => undefined)
      if (target) list.push({ name: e.name, path: rel, dir: target.isDirectory() })
    }
  }
  return list.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
}

export async function readPreview(workdir: string, rel: string): Promise<FilePreview> {
  return previewFile(await resolveInside(workdir, rel))
}

// 按扩展名取预览。路径由调用方把关
export async function previewFile(file: string): Promise<FilePreview> {
  const { size } = await stat(file)
  if (size > FILE_LIMIT) return { kind: 'unsupported', reason: 'large', size }
  const ext = path.extname(file).slice(1).toLowerCase()
  const image = IMAGES[ext]
  if (image) {
    const data = await readFile(file)
    return { kind: 'image', dataUrl: `data:${image};base64,${data.toString('base64')}`, size }
  }
  if (ext === 'pdf') return { kind: 'pdf', data: new Uint8Array(await readFile(file)), size }
  if (ext === 'docx') {
    try {
      const mammoth = await import('mammoth')
      const { value } = await mammoth.convertToHtml({ buffer: await readFile(file) })
      return { kind: 'html', html: value, size }
    } catch {
      // 坏文件、加密文件转不出来
      return { kind: 'unsupported', reason: 'binary', size }
    }
  }
  const handle = await open(file, 'r')
  try {
    const length = Math.min(size, TEXT_LIMIT)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, 0)
    // 文本里不会有 NUL
    if (buffer.subarray(0, SNIFF).includes(0))
      return { kind: 'unsupported', reason: 'binary', size }
    const truncated = size > TEXT_LIMIT
    let text = new TextDecoder().decode(buffer)
    // 截断时丢掉最后不完整的一行，也丢掉被切开的多字节字符
    const end = text.lastIndexOf('\n')
    if (truncated && end >= 0) text = text.slice(0, end + 1)
    return { kind: 'text', text, size, truncated }
  } finally {
    await handle.close()
  }
}

const PDF_DIRS = { cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts', wasmUrl: 'wasm' }

export async function pdfAsset(kind: keyof typeof PDF_DIRS, filename: string): Promise<Uint8Array> {
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'))
  // 文件名来自 PDF 里写的编码名，不让它走出这个目录
  return new Uint8Array(await readFile(path.join(root, PDF_DIRS[kind], path.basename(filename))))
}
