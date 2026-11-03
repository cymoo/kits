import type { SessionSummary } from '@kits/core/ipc'
import { useMemo } from 'react'
import { NavLink } from 'react-router'
import { type MessageKey, t } from '../app/i18n'
import { type Group, groupSessions } from '../lib/session-groups'
import { useSessions } from '../lib/sessions'
import { useToday } from '../lib/use-today'
import { cx } from '../ui/cx'

// 侧栏的会话列表（原型 shell.js）：按今天 / 昨天 / 本周 / 更早分组；运行中蓝点闪，等处理黄点，出错红点并带状态字。

const GROUP_LABEL: Record<Group, MessageKey> = {
  today: 'nav.today',
  yesterday: 'nav.yesterday',
  week: 'nav.week',
  earlier: 'nav.earlier',
}

export function StatusDot({ status }: { status: SessionSummary['status'] }) {
  if (status !== 'running' && status !== 'waiting' && status !== 'error') return null
  return (
    <span
      aria-hidden="true"
      className={cx(
        'h-[7px] w-[7px] shrink-0 rounded-full',
        status === 'running' && 'animate-[k-pulse_1.4s_ease-in-out_infinite] bg-accent',
        status === 'waiting' && 'bg-warn',
        status === 'error' && 'bg-danger',
      )}
    />
  )
}

export function SessionList() {
  const sessions = useSessions()
  const list = sessions.data ?? []
  // 跨过午夜要重新分组
  const today = useToday()
  // biome-ignore lint/correctness/useExhaustiveDependencies: today 变了要重算
  const groups = useMemo(() => groupSessions(list), [list, today])
  if (sessions.isSuccess && list.length === 0) {
    return <p className="px-2 py-2 text-[0.885rem] text-fg-subtle">{t('nav.empty')}</p>
  }
  return (
    <>
      {groups.map(([group, items]) => (
        <div key={group} className="flex flex-col gap-px">
          <div className="px-2 pt-2 pb-1 font-medium text-[0.885rem] text-fg-label">
            {t(GROUP_LABEL[group])}
          </div>
          {items.map((s) => (
            <NavLink
              key={s.id}
              to={`/s/${s.id}`}
              title={s.title}
              className={({ isActive }) =>
                cx(
                  'flex h-[30px] items-center gap-2 rounded-[8px] px-2 text-fg no-underline hover:bg-hover',
                  isActive && 'bg-hover font-medium',
                )
              }
            >
              <StatusDot status={s.status} />
              <span className="min-w-0 flex-1 truncate">{s.title}</span>
              {/* 运行中只有一个圆点，给读屏补上状态 */}
              {s.status === 'running' ? (
                <span className="sr-only">{t('nav.tag.running')}</span>
              ) : null}
              {s.status === 'waiting' || s.status === 'error' ? (
                <span
                  className={cx(
                    'shrink-0 text-[0.846rem]',
                    s.status === 'error' ? 'text-danger' : 'text-warn',
                  )}
                >
                  {t(s.status === 'error' ? 'nav.tag.error' : 'nav.tag.waiting')}
                </span>
              ) : null}
            </NavLink>
          ))}
        </div>
      ))}
    </>
  )
}
