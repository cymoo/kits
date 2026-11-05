import type { QueuedDraft, QueuedMessage } from '@kits/core/ipc'
import { ChevronDown, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../app/i18n'
import { kits } from '../../lib/kits'
import { interjectLabel } from '../../lib/shortcuts'
import { cx } from '../../ui/cx'

const ROW_ACTION =
  'flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted opacity-0 transition-opacity hover:bg-active hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100'

// 输入框上方的排队消息：这一轮结束后发。多点一下“插话”才在下一步送达（原型 session.html?s=queued）
export function QueuePanel({
  sessionId,
  items,
  canInterject,
  onEdit,
  onInterject,
}: {
  sessionId: string
  items: QueuedMessage[]
  canInterject: boolean
  onEdit(draft: QueuedDraft): void
  onInterject(): void
}) {
  const [open, setOpen] = useState(true)
  const [error, setError] = useState<string>()

  const interject = async (queueId?: string) => {
    setError(undefined)
    try {
      await kits.session.interject({ id: sessionId, ...(queueId ? { queueId } : {}) })
      onInterject()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  const edit = async (queueId: string) => {
    const draft = await kits.session.dequeue({ id: sessionId, queueId })
    if (draft) onEdit(draft)
  }

  return (
    <div
      data-testid="queued"
      className="mx-3.5 -mb-3.5 overflow-hidden rounded-t-xl border border-line border-b-0 bg-panel pb-3.5"
    >
      <div className="flex items-center pr-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 px-3.5 text-left text-[1rem] text-fg-muted outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset"
        >
          <ChevronDown
            size={14}
            className={cx('shrink-0 text-fg-subtle transition-transform', !open && '-rotate-90')}
          />
          <span className="shrink-0 font-medium text-fg">
            {t('queue.count', { n: items.length })}
          </span>
          <span className="truncate">{t('queue.label')}</span>
        </button>
        {canInterject && items.length > 1 ? (
          <button
            type="button"
            title={`${t('queue.interjectAll')} ${interjectLabel}`}
            onClick={() => void interject()}
            className="h-6 shrink-0 cursor-pointer rounded-md px-2 text-[0.929rem] text-fg-muted hover:bg-active hover:text-fg"
          >
            {t('queue.interjectAll')}
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="max-h-[152px] overflow-y-auto">
          {items.map((q) => (
            <div
              key={q.id}
              data-testid="queued-item"
              className="group flex min-h-[38px] items-center gap-0.5 border-line-soft border-t pr-2 pl-3.5 text-[1rem]"
            >
              <span className="min-w-0 flex-1 truncate" title={q.text}>
                {q.text}
              </span>
              {q.attachments.length ? (
                <span className="shrink-0 px-1.5 text-[0.929rem] text-fg-subtle">
                  {t('queue.files', { n: q.attachments.length })}
                </span>
              ) : null}
              <button
                type="button"
                aria-label={t('queue.edit')}
                title={t('queue.edit')}
                onClick={() => void edit(q.id)}
                className={ROW_ACTION}
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                aria-label={t('queue.remove')}
                title={t('queue.remove')}
                onClick={() => void kits.session.dequeue({ id: sessionId, queueId: q.id })}
                className={ROW_ACTION}
              >
                <Trash2 size={13} />
              </button>
              {canInterject ? (
                <button
                  type="button"
                  title={t('queue.interjectTitle')}
                  onClick={() => void interject(q.id)}
                  className="ml-1 h-[26px] shrink-0 cursor-pointer rounded-[8px] bg-active px-2.5 text-[0.929rem] hover:bg-line outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  {t('queue.interject')}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {error ? <p className="border-line-soft border-t px-3.5 py-2 text-danger">{error}</p> : null}
    </div>
  )
}
