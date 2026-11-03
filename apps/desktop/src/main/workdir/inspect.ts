import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { loadAgentsDir, loadSkillsDir, parseMemory } from '@kits/core'
import type { WorkdirInspection } from '@kits/core/ipc'

// 首次引导第 2 步（原型 onboarding.html）：选了工作目录后看一眼里面有什么——Git 分支和工作区、
// AGENTS.md、项目技能和 Agent、项目记忆、项目类型（猜测试命令）。只读，不改任何文件。

const run = promisify(execFile)

async function git(dir: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await run('git', args, { cwd: dir, timeout: 5_000, windowsHide: true })
    return stdout.trim()
  } catch {
    return undefined
  }
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

// 按根目录里的构建文件猜项目类型和测试命令
function projectType(dir: string): { file: string; note: string } | undefined {
  const has = (f: string) => existsSync(path.join(dir, f))
  if (has('pyproject.toml')) {
    const cmd = has('uv.lock')
      ? 'uv run pytest'
      : has('poetry.lock')
        ? 'poetry run pytest'
        : 'pytest'
    return { file: 'pyproject.toml', note: `Python 项目，测试命令可能是 ${cmd}` }
  }
  if (has('package.json')) {
    const pkg = readJson(path.join(dir, 'package.json'))
    const scripts = (pkg?.scripts ?? {}) as Record<string, unknown>
    const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : 'npm'
    return {
      file: 'package.json',
      note: scripts.test ? `Node 项目，测试命令可能是 ${pm} test` : 'Node 项目，没有 test 脚本',
    }
  }
  if (has('pom.xml')) return { file: 'pom.xml', note: 'Java（Maven）项目，测试命令可能是 mvn test' }
  if (has('build.gradle') || has('build.gradle.kts'))
    return {
      file: 'build.gradle',
      note: 'Java / Kotlin（Gradle）项目，测试命令可能是 ./gradlew test',
    }
  if (has('go.mod')) return { file: 'go.mod', note: 'Go 项目，测试命令可能是 go test ./...' }
  if (has('Cargo.toml')) return { file: 'Cargo.toml', note: 'Rust 项目，测试命令可能是 cargo test' }
  if (has('requirements.txt'))
    return { file: 'requirements.txt', note: 'Python 项目，测试命令可能是 pytest' }
  return undefined
}

export async function inspectWorkdir(dir: string): Promise<WorkdirInspection> {
  const found: WorkdirInspection['found'] = []
  for (const f of ['AGENTS.md', 'CLAUDE.md']) {
    if (existsSync(path.join(dir, f))) {
      found.push({ file: f, note: '会作为项目约定自动加载' })
      break
    }
  }
  const skills = loadSkillsDir(path.join(dir, '.agents', 'skills'), 'project').items
  if (skills.length) {
    const names = skills.map((s) => s.name)
    found.push({
      file: '.agents/skills/',
      note: `${names.length} 个项目技能：${names.slice(0, 4).join('、')}${names.length > 4 ? ' 等' : ''}`,
    })
  }
  const agents = loadAgentsDir(path.join(dir, '.agents', 'agents'), 'project').items
  if (agents.length) {
    found.push({
      file: '.agents/agents/',
      note: `${agents.length} 个项目 Agent：${agents
        .map((a) => a.name)
        .slice(0, 4)
        .join('、')}`,
    })
  }
  const memoryFile = path.join(dir, '.agents', 'memory.md')
  if (existsSync(memoryFile)) {
    const n = parseMemory(readFileSync(memoryFile, 'utf8')).length
    if (n) found.push({ file: '.agents/memory.md', note: `${n} 条项目记忆` })
  }
  const type = projectType(dir)
  if (type) found.push(type)

  const branch = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const status = branch === undefined ? undefined : await git(dir, ['status', '--porcelain'])
  return {
    path: dir,
    ...(branch !== undefined
      ? { git: { branch, changed: status ? status.split('\n').filter(Boolean).length : 0 } }
      : {}),
    found,
  }
}
