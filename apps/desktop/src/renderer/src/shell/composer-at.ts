// 输入框的 @ 引用：光标前面是“行首或空白 + @ + 不含空白的字”时弹出文件菜单，选中后换成 @路径 加一个空格。纯函数，有单测。
// 引用的文件就在工作目录里，Agent 自己会去读，消息里留着 @路径 就行。

export interface AtQuery {
  // @ 所在的位置
  start: number
  query: string
}

export function atQuery(text: string, caret: number): AtQuery | undefined {
  const before = text.slice(0, caret)
  const m = /(^|\s)@([^\s@]*)$/.exec(before)
  if (!m) return undefined
  return { start: caret - (m[2] ?? '').length - 1, query: m[2] ?? '' }
}

export function insertAt(
  text: string,
  at: AtQuery,
  caret: number,
  path: string,
): { text: string; caret: number } {
  const inserted = `@${path} `
  // 只吃掉紧跟的一个普通空格，换行、制表符留着
  const next = text.slice(0, at.start) + inserted + text.slice(caret).replace(/^ /, '')
  return { text: next, caret: at.start + inserted.length }
}

// 12.3 KB、1.2 MB
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
