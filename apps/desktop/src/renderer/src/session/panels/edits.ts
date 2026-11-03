// 产出面板底部的“改了 N 处”：按行对齐原稿和修改稿，连续改动的一段算一处。纯函数，有单测。
// 产出一般几百行，O(n·m) 的最长公共子序列够用；太长就只说改过
const LIMIT = 4_000

export function countEdits(before: string, after: string): number | undefined {
  if (before === after) return 0
  const a = before.split('\n')
  const b = after.split('\n')
  if (a.length * b.length > LIMIT * LIMIT) return undefined
  // at(i, j)：a[i..] 和 b[j..] 的最长公共子序列长度，存在一维数组里
  const w = b.length + 1
  const dp = new Uint32Array((a.length + 1) * w)
  const at = (i: number, j: number) => dp[i * w + j] ?? 0
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
    }
  }
  let i = 0
  let j = 0
  let hunks = 0
  let inHunk = false
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++
      j++
      inHunk = false
      continue
    }
    if (!inHunk) hunks++
    inHunk = true
    if (j < b.length && (i >= a.length || at(i, j + 1) >= at(i + 1, j))) j++
    else i++
  }
  return hunks
}
