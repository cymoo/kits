// unified diff → 改动面板的行。纯函数，有单测。
// 内核给的 patch 带 Index: / ===== / --- / +++ 头，这些不显示；`\ No newline at end of file` 也略过。

export interface DiffLine {
  // + 新增、- 删除、空格 上下文、@ 分段头
  kind: '+' | '-' | ' ' | '@'
  // 旧文件 / 新文件里的行号；分段头和对面那一侧没有
  a?: number
  b?: number
  text: string
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export function parsePatch(patch: string): DiffLine[] {
  const out: DiffLine[] = []
  let a = 0
  let b = 0
  let inHunk = false
  for (const raw of patch.split('\n')) {
    const hunk = HUNK.exec(raw)
    if (hunk) {
      a = Number(hunk[1])
      b = Number(hunk[2])
      inHunk = true
      out.push({ kind: '@', text: raw })
      continue
    }
    // 第一个分段之前都是文件头
    if (!inHunk || raw.startsWith('\\')) continue
    const kind = raw[0]
    const text = raw.slice(1)
    if (kind === '+') out.push({ kind: '+', b: b++, text })
    else if (kind === '-') out.push({ kind: '-', a: a++, text })
    else if (kind === ' ') out.push({ kind: ' ', a: a++, b: b++, text })
    // 末尾的空行（patch 以换行结尾）不算
  }
  return out
}

export interface SplitRow {
  left?: DiffLine
  right?: DiffLine
  // 分段头占一整行
  hunk?: DiffLine
}

// 并排视图：一段连续的删除和紧跟的新增左右配对，多出来的一侧留空
export function splitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let dels: DiffLine[] = []
  let adds: DiffLine[] = []
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) {
      const left = dels[i]
      const right = adds[i]
      rows.push({ ...(left ? { left } : {}), ...(right ? { right } : {}) })
    }
    dels = []
    adds = []
  }
  for (const line of lines) {
    if (line.kind === '-') {
      // 新增后面又来删除：前一组先配完
      if (adds.length) flush()
      dels.push(line)
    } else if (line.kind === '+') {
      adds.push(line)
    } else {
      flush()
      rows.push(line.kind === '@' ? { hunk: line } : { left: line, right: line })
    }
  }
  flush()
  return rows
}

// 行号栏的宽度（字符数）：按最大的行号算，五位数的行号也不挤在一起
export function gutterChars(lines: DiffLine[]): number {
  let max = 0
  for (const l of lines) max = Math.max(max, l.a ?? 0, l.b ?? 0)
  return Math.max(2, String(max).length)
}

// 只有新增或只有删除（新建、删除的文件）：并排时另一半全空，直接按统一视图显示
export function oneSided(lines: DiffLine[]): boolean {
  return (
    !lines.some((l) => l.kind === ' ') &&
    !(lines.some((l) => l.kind === '+') && lines.some((l) => l.kind === '-'))
  )
}

export interface HighlightSource {
  // 旧文件、新文件里出现在 diff 中的行，按顺序拼起来交给高亮
  old: string
  new: string
  // 每一行 diff 在哪一侧的第几行；分段头没有。上下文行取新文件那一侧
  rows: ({ side: 'old' | 'new'; row: number } | undefined)[]
}

// 高亮按两侧各拼一段代码：分段之间断开的地方可能有跨行的字符串、注释接不上，只影响颜色
export function highlightSource(lines: DiffLine[]): HighlightSource {
  const old: string[] = []
  const neu: string[] = []
  const rows: HighlightSource['rows'] = []
  for (const l of lines) {
    if (l.kind === '@') {
      rows.push(undefined)
      continue
    }
    if (l.kind === '-' || l.kind === ' ') old.push(l.text)
    if (l.kind === '-') {
      rows.push({ side: 'old', row: old.length - 1 })
      continue
    }
    neu.push(l.text)
    rows.push({ side: 'new', row: neu.length - 1 })
  }
  return { old: old.join('\n'), new: neu.join('\n'), rows }
}

// 路径拆成目录和文件名：列表里文件名放后面不截断，长路径先截目录
export function splitPath(path: string): { dir: string; name: string } {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1
  return { dir: path.slice(0, cut), name: path.slice(cut) }
}
