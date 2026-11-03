// 设置页 #skills 和输入框 / 菜单看到的技能（phase1-implementation PR13）

export type SkillSource = 'builtin' | 'personal' | 'project'

export interface SkillView {
  name: string
  description: string
  source: SkillSource
  // 技能目录（SKILL.md 所在目录）
  dir: string
  enabled: boolean
  // 被它覆盖的同名技能来源（项目的覆盖个人的覆盖内置的）
  shadows: SkillSource[]
}

export interface SkillOverview {
  skills: SkillView[]
  // 三个来源的目录；项目目录只在给了工作目录时有
  dirs: Partial<Record<SkillSource, string>>
  // 读不了的 SKILL.md
  errors: { path: string; message: string }[]
}
