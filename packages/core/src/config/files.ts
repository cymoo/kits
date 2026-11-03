import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { checkJsonSchema } from '../tools/submit-output'
import { type AgentProfile, type ConfigSource, parseAgentMarkdown } from './agent'
import { parseSkillMarkdown, type SkillInfo } from './skill'

// 从目录读 Agent 和技能。坏文件不让整个列表失败：收进 errors，界面在对应设置页提示。

export interface LoadError {
  path: string
  message: string
}

export interface Loaded<T> {
  items: T[]
  errors: LoadError[]
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function loadAgentFile(file: string, source: ConfigSource): AgentProfile {
  const text = readFileSync(file, 'utf8')
  const profile = parseAgentMarkdown(text, {
    source,
    path: file,
    fallbackName: path.basename(file, '.md'),
  })
  if (!profile.output) return profile
  const schemaFile = path.resolve(path.dirname(file), profile.output)
  let schema: unknown
  try {
    schema = JSON.parse(readFileSync(schemaFile, 'utf8'))
  } catch (e) {
    throw new Error(`输出格式文件 ${profile.output} 读取失败：${message(e)}`)
  }
  // 布尔 schema 只能出现在子 schema 里；根是 true / false 等于没写格式，当错误报出来
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    throw new Error(`输出格式文件 ${profile.output} 的根必须是一个 JSON Schema 对象`)
  }
  const problems = checkJsonSchema(schema)
  if (problems.length > 0) {
    throw new Error(`输出格式文件 ${profile.output} 不是合法的 JSON Schema：${problems.join('；')}`)
  }
  return { ...profile, outputSchema: schema as Record<string, unknown> }
}

// <dir>/*.md，一个文件一个 Agent
export function loadAgentsDir(dir: string, source: ConfigSource): Loaded<AgentProfile> {
  const result: Loaded<AgentProfile> = { items: [], errors: [] }
  if (!existsSync(dir)) return result
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith('.md')) continue
    const file = path.join(dir, entry)
    try {
      result.items.push(loadAgentFile(file, source))
    } catch (e) {
      result.errors.push({ path: file, message: message(e) })
    }
  }
  return result
}

// <dir>/<name>/SKILL.md，一个子目录一个技能
export function loadSkillsDir(dir: string, source: ConfigSource): Loaded<SkillInfo> {
  const result: Loaded<SkillInfo> = { items: [], errors: [] }
  if (!existsSync(dir)) return result
  for (const entry of readdirSync(dir).sort()) {
    const skillDir = path.join(dir, entry)
    const file = path.join(skillDir, 'SKILL.md')
    // 软链接的技能目录也要认，所以用 statSync 而不是 dirent 的类型
    if (!existsSync(file) || !statSync(skillDir).isDirectory()) continue
    try {
      result.items.push(
        parseSkillMarkdown(readFileSync(file, 'utf8'), {
          source,
          dir: skillDir,
          fallbackName: entry,
        }),
      )
    } catch (e) {
      result.errors.push({ path: file, message: message(e) })
    }
  }
  return result
}
