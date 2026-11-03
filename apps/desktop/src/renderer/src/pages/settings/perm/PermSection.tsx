import type { PermissionLevel, PermissionMode } from '@kits/core/ipc'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { type MessageKey, t } from '../../../app/i18n'
import { kits, useSettings, useUpdateSettings } from '../../../lib/kits'
import { cx } from '../../../ui/cx'

// 设置 · 权限（原型 settings.html#perm 只有说明）：新会话默认的权限模式，加上默认权限和只读命令的说明。
// 细则不在这里改：Agent 页改单个 Agent 的，MCP 页改每个工具的。

const MODES: PermissionMode[] = ['ask', 'read', 'auto']
// 说明里列的内置工具，顺序和 Agent 页一致
const TOOLS = ['read', 'edit', 'bash', 'external_directory', 'webfetch', 'task', 'skill']

const TONE: Record<PermissionLevel, string> = {
  allow: 'text-ok',
  ask: 'text-warn-strong',
  deny: 'text-danger',
}

export function PermSection() {
  const settings = useSettings()
  const update = useUpdateSettings()
  const defaults = useQuery({
    queryKey: ['permission-defaults'],
    queryFn: () => kits.app.permissionDefaults(),
  })
  const mode = settings.data?.permissionMode ?? 'ask'
  return (
    <div className="flex w-full max-w-[720px] flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-semibold text-[1.538rem] tracking-[-0.01em]">
          {t('settings.perm')}
        </h2>
        <p className="m-0 text-fg-muted">{t('perm.intro')}</p>
      </div>

      <section className="flex flex-col overflow-hidden rounded-[14px] border border-line bg-raised">
        <div className="flex items-baseline gap-2.5 border-line-soft border-b px-[18px] py-3">
          <b className="font-semibold">{t('perm.mode')}</b>
          <small className="text-[0.923rem] text-fg-muted">{t('perm.modeHint')}</small>
        </div>
        <div
          role="radiogroup"
          aria-label={t('perm.mode')}
          className="grid grid-cols-3 gap-2.5 p-[18px]"
        >
          {MODES.map((m) => {
            const on = mode === m
            return (
              // biome-ignore lint/a11y/useSemanticElements: 选项带说明文字，按原型的选项卡片画
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => update.mutate({ permissionMode: m })}
                className={cx(
                  'flex cursor-pointer flex-col items-start gap-1.5 rounded-[12px] border px-3.5 py-3 text-left',
                  on ? 'border-accent bg-accent-bg' : 'border-line bg-raised hover:bg-active',
                )}
              >
                <span className="font-semibold">{t(`perm.mode.${m}` as MessageKey)}</span>
                <span className="text-[0.923rem] text-fg-muted leading-[1.55]">
                  {t(`perm.mode.${m}.note` as MessageKey)}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="flex flex-col overflow-hidden rounded-[14px] border border-line bg-raised">
        <div className="flex items-baseline gap-2.5 border-line-soft border-b px-[18px] py-3">
          <b className="font-semibold">{t('perm.defaults')}</b>
          <small className="text-[0.923rem] text-fg-muted">{t('perm.defaultsHint')}</small>
        </div>
        {TOOLS.map((tool) => {
          const level = defaults.data?.tools[tool]
          return (
            <div
              key={tool}
              className="flex min-h-10 items-center gap-3 border-line-soft border-b px-[18px] py-1.5 last:border-b-0"
            >
              <span className="w-[156px] shrink-0 font-mono text-[0.962rem]">{tool}</span>
              <span className="min-w-0 flex-1 truncate text-[0.923rem] text-fg-muted">
                {t(`perm.tool.${tool}` as MessageKey)}
              </span>
              {level ? (
                <span className={cx('font-medium text-[0.923rem]', TONE[level])}>
                  {t(`mcp.${level}` as MessageKey)}
                </span>
              ) : null}
            </div>
          )
        })}
      </section>

      <section className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-raised px-[18px] py-3.5">
        <div className="flex items-baseline gap-2.5">
          <b className="font-semibold">{t('perm.readonly')}</b>
          <small className="text-[0.923rem] text-fg-muted">{t('perm.readonlyHint')}</small>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(defaults.data?.readonlyCommands ?? []).map((c) => (
            <span
              key={c}
              className="inline-flex h-[24px] items-center rounded-[6px] bg-muted px-2 font-mono text-[0.885rem]"
            >
              {c}
            </span>
          ))}
        </div>
      </section>

      <p className="mx-1 my-0 text-[0.923rem] text-fg-label leading-[1.6]">
        {t('perm.where')}{' '}
        <Link to="/settings/agent" className="text-accent no-underline hover:text-accent-fg">
          {t('settings.agent')}
        </Link>
        {' · '}
        <Link to="/settings/mcp" className="text-accent no-underline hover:text-accent-fg">
          {t('settings.mcp')}
        </Link>
      </p>
    </div>
  )
}
