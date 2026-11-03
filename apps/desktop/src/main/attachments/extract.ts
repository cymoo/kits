import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

// 附件转文本（phase1-implementation PR11）：Word 用 mammoth 取正文，PDF 用 pdfjs-dist 逐页取文字，
// Markdown、纯文本、代码、日志、CSV、JSON 直接按 UTF-8 读。图片和其他二进制文件这一版不支持。
// 转出来的文字随消息一起发给内核（适配器包成 <attachment name="…"> 段）。

// 单个附件放进消息的文字上限：再长就截断并说明，免得一个附件把上下文撑满
export const MAX_CHARS = 200_000

const TEXT_EXT = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.log',
  '.csv',
  '.tsv',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.xml',
  '.html',
  '.sql',
  '.ini',
  '.toml',
  '.properties',
  '.sh',
  '.py',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.java',
  '.kt',
  '.go',
  '.rs',
  '.c',
  '.h',
  '.cpp',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.vue',
])

export type AttachmentKind = 'docx' | 'pdf' | 'text'

export function attachmentKind(name: string, mime: string): AttachmentKind | undefined {
  const ext = path.extname(name).toLowerCase()
  if (ext === '.docx') return 'docx'
  if (ext === '.pdf' || mime === 'application/pdf') return 'pdf'
  if (TEXT_EXT.has(ext) || mime.startsWith('text/')) return 'text'
  return undefined
}

export class UnsupportedAttachmentError extends Error {
  constructor(name: string) {
    super(`${name}：这一版只支持 Word（.docx）、PDF、Markdown 和纯文本类文件`)
    this.name = 'UnsupportedAttachmentError'
  }
}

async function docxText(data: Uint8Array): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer: Buffer.from(data) })
  return result.value
}

async function pdfText(data: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // 标准 14 种字体的字形数据随 pdfjs-dist 一起发，取文字时也要用
  const fonts = path.join(
    path.dirname(require.resolve('pdfjs-dist/package.json')),
    'standard_fonts',
  )
  const task = pdfjs.getDocument({
    // pdfjs 会改写传进去的数组，给它一份拷贝
    data: new Uint8Array(data),
    standardFontDataUrl: `${fonts}${path.sep}`,
    // 只取文字，不渲染：不装 @napi-rs/canvas，也不打它没装上的警告
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  })
  const doc = await task.promise
  try {
    const pages: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      pages.push(
        content.items
          .map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ''}` : ''))
          .join('')
          .trim(),
      )
    }
    return pages.join('\n\n')
  } finally {
    await task.destroy()
  }
}

// 转成文本；超过上限的截断，末尾注明还有多少没放进来
export async function extractText(name: string, mime: string, data: Uint8Array): Promise<string> {
  const kind = attachmentKind(name, mime)
  if (!kind) throw new UnsupportedAttachmentError(name)
  let raw: string
  try {
    raw =
      kind === 'docx'
        ? await docxText(data)
        : kind === 'pdf'
          ? await pdfText(data)
          : new TextDecoder('utf-8').decode(data)
  } catch (e) {
    // 坏的 docx、加密或损坏的 PDF：一次传好几个时要知道是哪个
    throw new Error(`${name}：读不了（${e instanceof Error ? e.message : String(e)}）`)
  }
  const text = raw.replace(/\r\n/g, '\n').trim()
  if (text.length <= MAX_CHARS) return text
  return `${text.slice(0, MAX_CHARS)}\n\n（附件太长，后面还有 ${text.length - MAX_CHARS} 字没放进来）`
}
