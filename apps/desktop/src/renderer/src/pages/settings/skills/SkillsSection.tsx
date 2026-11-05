import type { SkillSource, SkillView } from '@kits/core/ipc'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { type MessageKey, t } from '../../../app/i18n'
import { basename } from '../../../lib/composer-prefs'
import { kits, useHomeLabel, useSettings } from '../../../lib/kits'
import { Button } from '../../../ui/Button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../../ui/Menu'
import { Switch } from '../../../ui/Switch'
import { MemorySection } from './MemorySection'

// 设置 · 技能与记忆的技能部分（原型 settings.html#skills）：内置、项目、个人三组，同名提示，开关，打开目录。
// 下面是记忆（MemorySection）。项目技能和项目记忆按选中的工作目录列（默认最近用的那个）。

export function useSkills(workdir: string | undefined) {
  return useQuery({
    queryKey: ['skills', workdir ?? ''],
    queryFn: () => kits.skills.list(workdir ? { workdir } : {}),
  })
}

const GROUPS: SkillSource[] = ['builtin', 'project', 'personal']
const SOURCE_LABEL: Record<SkillSource, MessageKey> = {
  builtin: 'skills.builtin',
  personal: 'skills.personal',
  project: 'skills.project',
}

function SkillRow({ skill, onToggle }: { skill: SkillView; onToggle(on: boolean): void }) {
  return (
    <div
      data-testid={`skill-${skill.source}-${skill.name}`}
      className="flex min-h-12 items-center gap-3 border-line-soft border-b px-4 py-2 last:border-b-0"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="flex items-center gap-2">
          <span className="font-medium font-mono text-[0.929rem]">/{skill.name}</span>
          {skill.shadows.length ? (
            <span className="rounded-[8px] bg-warn-bg px-[7px] py-px text-[0.857rem] text-warn-strong">
              {t('skills.overrides', {
                what: skill.shadows.map((s) => t(SOURCE_LABEL[s])).join('、'),
              })}
            </span>
          ) : null}
        </span>
        <span className="truncate text-[0.929rem] text-fg-muted" title={skill.description}>
          {skill.description}
        </span>
      </span>
      <Switch
        checked={skill.enabled}
        label={t('skills.enable', { name: skill.name })}
        onCheckedChange={onToggle}
      />
    </div>
  )
}

export function SkillsSection() {
  const client = useQueryClient()
  const settings = useSettings()
  const homeLabel = useHomeLabel()
  const workdirs = settings.data?.workdirs ?? []
  const [picked, setPicked] = useState<string>()
  const workdir = picked ?? workdirs[0]?.path
  const skills = useSkills(workdir)
  const list = skills.data?.skills ?? []
  const dirs = skills.data?.dirs ?? {}
  const toggle = (name: string, enabled: boolean) =>
    void kits.skills
      .setEnabled({ name, enabled })
      .then(() => client.invalidateQueries({ queryKey: ['skills'] }))

  return (
    <div className="flex w-full max-w-[820px] flex-col gap-7">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-semibold text-[1.429rem] tracking-[-0.01em]">
          {t('settings.skills')}
        </h2>
        <p className="m-0 text-fg-muted">{t('skills.intro')}</p>
      </div>
      <section className="flex flex-col gap-2.5">
        {skills.data?.errors.map((e) => (
          <p
            key={e.path}
            role="alert"
            className="m-0 rounded-[12px] bg-danger-bg px-3.5 py-2 text-[0.929rem] text-danger"
          >
            {t('skills.error', { path: e.path, message: e.message })}
          </p>
        ))}
        {GROUPS.map((source) => {
          const items = list.filter((s) => s.source === source)
          const path = dirs[source]
          const note =
            source === 'builtin'
              ? t('skills.count', { n: items.length })
              : source === 'project'
                ? t('skills.projectNote', { n: items.length })
                : t('skills.personalNote', { n: items.length })
          return (
            <div
              key={source}
              data-testid={`skills-${source}`}
              className="flex flex-col overflow-hidden rounded-[16px] border border-line bg-raised"
            >
              <div className="flex items-center gap-2.5 border-line-soft border-b px-4 py-3">
                <b className="font-semibold">{t(SOURCE_LABEL[source])}</b>
                {source === 'project' && workdirs.length > 1 ? (
                  <Menu>
                    <MenuTrigger className="inline-flex h-6 cursor-pointer items-center rounded-[6px] px-1.5 font-mono text-[0.857rem] text-fg-muted hover:bg-active">
                      {workdir ? basename(workdir) : ''} ▾
                    </MenuTrigger>
                    <MenuContent>
                      {workdirs.map((w) => (
                        <MenuItem key={w.path} onSelect={() => setPicked(w.path)}>
                          <span className="font-mono text-[0.929rem]">{homeLabel(w.path)}</span>
                        </MenuItem>
                      ))}
                    </MenuContent>
                  </Menu>
                ) : null}
                <span
                  className="min-w-0 flex-1 truncate font-mono text-[0.857rem] text-fg-label"
                  title={path}
                >
                  {source === 'builtin' ? t('skills.builtinPath') : path ? homeLabel(path) : ''}
                </span>
                <small className="text-[0.929rem] text-fg-muted">{note}</small>
                {source !== 'project' || workdir ? (
                  <Button
                    className="h-[26px] px-2"
                    onClick={() =>
                      void kits.skills.openDir(
                        source === 'project' && workdir ? { source, workdir } : { source },
                      )
                    }
                  >
                    {source === 'builtin' ? t('skills.view') : t('skills.openDir')}
                  </Button>
                ) : null}
              </div>
              {items.map((s) => (
                <SkillRow key={s.name} skill={s} onToggle={(on) => toggle(s.name, on)} />
              ))}
              {/* 被覆盖的同名技能也列出来，灰掉，说明谁优先 */}
              {list
                .filter((s) => s.shadows.includes(source))
                .map((s) => (
                  <div
                    key={`shadow-${s.name}`}
                    className="flex min-h-10 items-center gap-2 border-line-soft border-b px-4 py-2 text-fg-subtle last:border-b-0"
                  >
                    <span className="font-mono text-[0.929rem]">/{s.name}</span>
                    <span className="rounded-[8px] bg-hover px-[7px] py-px text-[0.857rem]">
                      {t('skills.shadowed', { by: t(SOURCE_LABEL[s.source]) })}
                    </span>
                  </div>
                ))}
              {items.length === 0 && !list.some((s) => s.shadows.includes(source)) ? (
                <p className="m-0 px-4 py-3 text-[0.929rem] text-fg-muted">
                  {source === 'project' && !workdir ? t('skills.noWorkdir') : t('skills.none')}
                </p>
              ) : null}
            </div>
          )
        })}
        <p className="mx-1 my-0 text-[0.929rem] text-fg-label">{t('skills.footnote')}</p>
      </section>
      <MemorySection workdir={workdir} />
    </div>
  )
}
