import { z } from 'zod'
import { type ConfigSource, mergeBySource } from './agent'
import { parseFrontmatter } from './frontmatter'

// 技能遵循 Agent Skills 规范：一个目录 + SKILL.md（frontmatter 里 name、description）。
// 三级来源：内置（resources/builtin/skills）、个人（~/.kits/skills）、项目（<工作目录>/.agents/skills），
// 同名时项目覆盖个人覆盖内置。settings.json 只记关闭的技能。

export const skillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
})

export interface SkillInfo {
  name: string
  description: string
  source: ConfigSource
  // 技能目录（SKILL.md 所在目录）的绝对路径
  dir: string
}

export function parseSkillMarkdown(
  text: string,
  options: { source: ConfigSource; dir: string; fallbackName: string },
): SkillInfo {
  const { data } = parseFrontmatter(text)
  const front = skillFrontmatterSchema.parse({ name: options.fallbackName, ...data })
  return { ...front, source: options.source, dir: options.dir }
}

export interface ResolvedSkill extends SkillInfo {
  enabled: boolean
  // 被它覆盖的同名技能来源
  shadows: ConfigSource[]
}

// lists 按优先级从低到高传：内置、个人、项目
export function resolveSkills(lists: SkillInfo[][], disabled: string[]): ResolvedSkill[] {
  const off = new Set(disabled)
  return mergeBySource(...lists).map((s) => ({ ...s, enabled: !off.has(s.name) }))
}
