import type { SessionSummary } from '@kits/core/ipc'
import { FolderPlus, Pin, PinOff } from 'lucide-react'
import { useMemo } from 'react'
import { t } from '../app/i18n'
import { usePrefs } from '../lib/composer-prefs'
import { kits, useSettings } from '../lib/kits'
import { useSessions } from '../lib/sessions'
import { useNow } from '../lib/use-now'
import { buildWorkspaces } from '../lib/workspaces'
import { cx } from '../ui/cx'
import { SessionRow } from './SessionRow'
import { WorkspaceGroup } from './WorkspaceGroup'

// 侧栏的会话列表（原型 shell.js）：置顶的在最前，其余按工作区分组；运行中蓝点闪，等处理黄点，出错红点并带状态字。

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
  const settings = useSettings()
  const list = sessions.data ?? []
  const workdirs = settings.data?.workdirs
  // 行尾的相对时间每分钟刷新一次
  const now = useNow(60_000)
  const workspaces = useMemo(() => buildWorkspaces(workdirs ?? [], list), [workdirs, list])
  const pinned = useMemo(
    () =>
      list
        .filter((s) => s.pinnedAt !== null)
        // 后置顶的在上面；会话有新内容时位置不动
        .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)),
    [list],
  )
  const add = async () => {
    const dir = await kits.workdir.pick()
    if (dir) usePrefs.getState().set({ workdir: dir })
  }
  return (
    <>
      {pinned.length ? (
        <div className="flex flex-col gap-0.5">
          <div className="px-2 pt-2 pb-1 font-medium text-[0.857rem] text-fg-label">
            {t('nav.pinned')}
          </div>
          {pinned.map((s) => (
            <SessionRow key={s.id} session={s} now={now} />
          ))}
        </div>
      ) : null}
      <div className="flex h-7 shrink-0 items-center pr-1 pl-2 font-medium text-[0.857rem] text-fg-label">
        <span className="flex-1">{t('nav.workspaces')}</span>
        <button
          type="button"
          aria-label={t('nav.addWorkspace')}
          title={t('nav.addWorkspace')}
          onClick={() => void add()}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-[6px] text-fg-muted hover:bg-hover hover:text-fg"
        >
          <FolderPlus size={15} />
        </button>
      </div>
      {workspaces.length === 0 && sessions.isSuccess ? (
        <p className="m-0 px-2 py-1 text-[0.857rem] text-fg-subtle">{t('nav.empty')}</p>
      ) : null}
      {workspaces.map((w) => (
        <WorkspaceGroup key={w.key} workspace={w} now={now} />
      ))}
    </>
  )
}
