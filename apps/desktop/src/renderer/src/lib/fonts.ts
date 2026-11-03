// 通用设置的字体下拉框：只列本机装了的。浏览器不给字体列表，挨个量一下：
// 同一段文字用“候选字体, 兜底字体”画出来的宽度和只用兜底字体不一样，就说明装了。

export const UI_FONTS = [
  'Inter',
  'PingFang SC',
  'Hiragino Sans GB',
  'Microsoft YaHei',
  'Noto Sans SC',
  'Source Han Sans SC',
  'HarmonyOS Sans SC',
  'Segoe UI',
  'Helvetica Neue',
]

export const CODE_FONTS = [
  'JetBrains Mono',
  'SF Mono',
  'Menlo',
  'Monaco',
  'Consolas',
  'Cascadia Code',
  'Fira Code',
  'Source Code Pro',
  'Sarasa Mono SC',
]

const SAMPLE = 'mmmmmmmmmlli 测试用例 0123 WWW'

export function installedFonts(candidates: string[]): string[] {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return candidates
  const width = (font: string) => {
    ctx.font = `32px ${font}`
    return ctx.measureText(SAMPLE).width
  }
  const bases = ['monospace', 'serif', 'sans-serif']
  const base = bases.map(width)
  return candidates.filter((name) =>
    bases.some((b, i) => Math.abs(width(`"${name}", ${b}`) - (base[i] ?? 0)) > 0.5),
  )
}
