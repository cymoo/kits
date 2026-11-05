// CSV / TSV 预览：引号里的分隔符和换行不切开；只取前面这么多行，大文件不卡
export const CSV_ROWS = 1000

export function parseTable(text: string, sep: ',' | '\t', limit = CSV_ROWS): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length && rows.length < limit; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') cell += c
      else if (text[i + 1] === '"') {
        cell += '"'
        i += 1
      } else quoted = false
    } else if (c === '"' && cell === '') quoted = true
    else if (c === sep) {
      row.push(cell)
      cell = ''
    } else if (c === '\n') {
      row.push(cell.replace(/\r$/, ''))
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if ((cell || row.length) && rows.length < limit) rows.push([...row, cell])
  return rows
}
