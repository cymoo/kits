import { Download } from 'lucide-react'
import { useState } from 'react'
import { t } from '../app/i18n'
import { kits } from '../lib/kits'
import { useBusySessionCount, useUpdate } from '../lib/update'
import { releaseDay } from '../lib/update-labels'
import { Button } from '../ui/Button'
import { cx } from '../ui/cx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/Popover'
import { UpdateNotes } from './UpdateNotes'

// 侧栏底部的新版本标签（原型 shell.js 的 .kn-upd）：下载好了才出现，不闪、不弹窗、不自动重启；
// 点开是更新内容和“重启并更新”，有会话在运行时不让重启。不点的话退出 kits 时自动装上
export function UpdateBadge({ collapsed }: { collapsed: boolean }) {
  const view = useUpdate().data
  const busy = useBusySessionCount()
  const [open, setOpen] = useState(false)
  if (view?.state.status !== 'ready') return null
  const { version, releaseDate, notes } = view.state
  const day = releaseDay(releaseDate)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t('update.badgeTitle', { version })}
          aria-label={t('update.badgeTitle', { version })}
          className={cx(
            'flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-[8px] bg-accent-bg px-2 text-left text-accent-fg hover:bg-accent-line data-[state=open]:bg-accent-line',
            collapsed && 'w-8 justify-center gap-0 px-0',
          )}
        >
          <Download size={15} className="shrink-0" />
          {collapsed ? null : (
            <>
              <span className="min-w-0 flex-1 truncate">{t('update.badge', { version })}</span>
              <span
                aria-hidden="true"
                className="h-[7px] w-[7px] shrink-0 rounded-full bg-accent"
              />
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={collapsed ? 'right' : 'top'}
        align={collapsed ? 'end' : 'start'}
        label={t('update.badge', { version })}
        className="w-[320px] px-4 py-3.5 text-[0.929rem] leading-5"
      >
        <h3 className="m-0 font-semibold text-[1rem]">{t('update.readyTitle', { version })}</h3>
        <p className="mt-0.5 mb-2.5 text-[0.857rem] text-fg-subtle">
          {t('update.current', { version: view.current })}
          {day ? ` · ${t('update.released', { date: day })}` : ''}
        </p>
        <UpdateNotes notes={notes} className="max-h-[240px] overflow-y-auto" />
        {busy ? (
          <p className="mt-3 mb-0 rounded-[8px] bg-warn-bg px-2.5 py-2 text-[0.857rem] text-warn-strong leading-[18px]">
            {t('update.busy', { count: busy })}
          </p>
        ) : (
          <p className="mt-3 mb-0 text-[0.857rem] text-fg-subtle leading-[18px]">
            {t('update.laterHint')}
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <Button className="h-[30px] px-3" onClick={() => setOpen(false)}>
            {t('update.later')}
          </Button>
          <Button
            variant="primary"
            disabled={busy > 0}
            onClick={() => void kits.app.installUpdate()}
          >
            {t('update.restart')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
