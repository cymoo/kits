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
