// 同一个目录的比较键：去掉末尾的分隔符；Windows 盘符路径不分大小写，分隔符也不讲究
export function workdirKey(dir: string): string {
  const trimmed = dir.replace(/[\\/]+$/, '') || dir
  return /^[A-Za-z]:/.test(trimmed) ? trimmed.replace(/\//g, '\\').toLowerCase() : trimmed
}
