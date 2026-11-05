// 文件列表的图标按类型分，颜色在界面上定
export type FileKind = 'doc' | 'pdf' | 'code' | 'data' | 'sheet' | 'image' | 'other'

const KINDS: Record<Exclude<FileKind, 'other'>, string[]> = {
  doc: ['md', 'markdown', 'txt', 'doc', 'docx', 'rtf'],
  pdf: ['pdf'],
  code: [
    ...['py', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'go', 'java', 'kt', 'kts'],
    ...['rs', 'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'php', 'rb', 'sh', 'bash', 'zsh', 'ps1', 'sql'],
    ...['css', 'html', 'htm'],
  ],
  data: ['json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'ini', 'conf', 'lock', 'env'],
  sheet: ['csv', 'tsv', 'xls', 'xlsx'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'svg'],
}

const BY_EXT = new Map(
  Object.entries(KINDS).flatMap(([kind, exts]) => exts.map((e) => [e, kind as FileKind] as const)),
)

export function fileKind(name: string): FileKind {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? 'other' : (BY_EXT.get(name.slice(dot + 1).toLowerCase()) ?? 'other')
}
