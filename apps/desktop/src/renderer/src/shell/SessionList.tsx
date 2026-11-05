import type { SessionSummary } from '@kits/core/ipc'
import { Pin, PinOff } from 'lucide-react'
import { useMemo } from 'react'
import { type MessageKey, t } from '../app/i18n'
import { kits } from '../lib/kits'
import { type Group, groupSessions } from '../lib/session-groups'
import { useSessions } from '../lib/sessions'
import { useToday } from '../lib/use-today'
import { cx } from '../ui/cx'
import { SessionRow } from './SessionRow'

// 侧栏的会话列表（原型 shell.js）：置顶的在最前，其余按今天 / 昨天 / 本周 / 更早分组；运行中蓝点闪，等处理黄点，出错红点并带状态字。

const GROUP_LABEL: Record<Group, MessageKey> = {
  pinned: 'nav.pinned',
  today: 'nav.today',
  yesterday: 'nav.yesterday',
  week: 'nav.week',
  earlier: 'nav.earlier',
}

// 置顶按钮（侧栏、全部会话共用）：平时藏着，鼠标移到行上或键盘选中才出现，行要带 group
export function PinButton({ session, className }: { session: SessionSummary; className: string }) {
  const pinned = session.pinnedAt !== null
  const Icon = pinned ? PinOff : Pin
  return (
    <button
      type="button"
      aria-label={t(pinned ? 'nav.unpin' : 'nav.pin', { title: session.title })}
      title={t(pinned ? 'nav.unpinShort' : 'nav.pinShort')}
      onClick={() => void kits.session.setPinned({ id: session.id, pinned: !pinned })}
      className={cx(
        'absolute top-1/2 flex -translate-y-1/2 cursor-pointer items-center justify-center text-fg-muted opacity-0 hover:bg-active hover:text-fg focus-visible:opacity-100 group-hover:opacity-100',
        className,
      )}
    >
      <Icon size={13} />
    </button>
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
    return <p className="px-2 py-2 text-[0.857rem] text-fg-subtle">{t('nav.empty')}</p>
  }
  return (
    <>
      {groups.map(([group, items]) => (
        <div key={group} className="flex flex-col gap-0.5">
          <div className="px-2 pt-2 pb-1 font-medium text-[0.857rem] text-fg-label">
            {t(GROUP_LABEL[group])}
          </div>
          {items.map((s) => (
            <SessionRow key={s.id} session={s} />
          ))}
        </div>
      ))}
    </>
  )
}
