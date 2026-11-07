// 打包前从仓库根目录的 CHANGELOG.md 取出这个版本那一节，写成 resources/release-notes.md。
// electron-builder 把它放进 latest.yml 的 releaseNotes，客户端在新版本的标签和设置页里显示（main/updater.ts 解析）。
// CHANGELOG 按 Keep a Changelog 写：“## [0.2.0] - 2026-11-07”下面“### 新增”“### 修复”…；没有这个版本的一节就不带说明。
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(desktop, '../..')

export function extractReleaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/)
  const v = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const heading = new RegExp(`^##\\s+\\[?v?${v}\\]?(\\s|$)`)
  const start = lines.findIndex((l) => heading.test(l))
  if (start < 0) return ''
  const rest = lines.slice(start + 1)
  // 下一个版本的标题（## 后面跟空白，### 不算）为止
  const end = rest.findIndex((l) => /^##\s/.test(l))
  return (end < 0 ? rest : rest.slice(0, end))
    .filter((l) => !/^\[[^\]]+\]:\s/.test(l)) // 文件末尾的版本链接定义
    .join('\n')
    .trim()
}

export function writeReleaseNotes(
  version,
  {
    changelog = path.join(root, 'CHANGELOG.md'),
    out = path.join(desktop, 'resources/release-notes.md'),
  } = {},
) {
  const notes = existsSync(changelog)
    ? extractReleaseNotes(readFileSync(changelog, 'utf8'), version)
    : ''
  // 上次打包留下的说明不能带进这个版本
  rmSync(out, { force: true })
  if (notes) {
    writeFileSync(out, `${notes}\n`)
    console.log(`release notes for ${version} written to ${path.relative(root, out)}`)
  } else {
    console.log(`no CHANGELOG section for ${version}; packaging without release notes`)
  }
  return notes
}
