import type { UpdateNote } from '@kits/core/ipc'
import { t } from '../app/i18n'
import { cx } from '../ui/cx'

// 这个版本的更新说明（打包时从 CHANGELOG 取的一节）：分类做成小标签，后面一句话
export function UpdateNotes({ notes, className }: { notes: UpdateNote[]; className?: string }) {
  if (!notes.length) return <p className="m-0 text-fg-subtle">{t('update.noNotes')}</p>
  return (
    <ul className={cx('m-0 flex list-none flex-col gap-1.5 p-0', className)}>
      {notes.map((n, i) => (
        // 同一版本里可能有两条一模一样的话，用序号做 key
        // biome-ignore lint/suspicious/noArrayIndexKey: 列表只读，不会重排
        <li key={i} className="flex items-baseline gap-2 text-fg-label">
          {n.kind ? (
            <span className="shrink-0 rounded-[6px] bg-muted px-1.5 text-[0.857rem] text-fg-muted">
              {n.kind}
            </span>
          ) : null}
          <span className="min-w-0">{n.text}</span>
        </li>
      ))}
    </ul>
  )
}
