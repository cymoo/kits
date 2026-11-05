import { Check, ChevronDown, ListTodo, Minus } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../app/i18n'
import { cx } from '../../ui/cx'
import { Spinner } from '../../ui/Spinner'
import { type TodoItem, todoCounts, todoProgress } from './derive'

// 计划（原型 session.html?s=plan）：输入框上方的卡片跟着这一轮走，步骤点开是那一步写下的清单。

function TodoMark({ status, live }: { status: TodoItem['status']; live: boolean }) {
  if (status === 'completed') return <Check size={13} strokeWidth={2.2} className="text-ok" />
  if (status === 'cancelled') return <Minus size={12} strokeWidth={2} />
  if (status === 'pending') {
    return <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-line-strong" />
  }
  return live ? <Spinner size={11} /> : <span className="h-2 w-2 rounded-full bg-accent" />
}

// live：这一轮还在跑，进行中的项转圈；步骤里是快照，只标一个点
export function TodoList({
  items,
  live = false,
  className,
}: {
  items: TodoItem[]
  live?: boolean
  className?: string
}) {
  return (
    <ul
      className={cx(
        'm-0 flex list-none flex-col gap-0.5 p-1.5 text-[0.962rem] leading-5',
        className,
      )}
    >
      {items.map((item, i) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: 模型每次重写整份清单，项目没有 id
          key={i}
          data-testid="todo"
          data-status={item.status}
          className={cx(
            'flex items-start gap-2 rounded-[7px] px-1.5 py-[3px]',
            item.status === 'in_progress'
              ? 'bg-accent-bg font-medium text-accent-fg'
              : 'text-fg-muted',
            item.status === 'cancelled' && 'text-fg-subtle',
          )}
        >
          <span className="flex h-5 w-3.5 shrink-0 items-center justify-center text-fg-subtle">
            <TodoMark status={item.status} live={live} />
          </span>
          <span
            className={cx(
              'min-w-0',
              (item.status === 'completed' || item.status === 'cancelled') && 'line-through',
            )}
          >
            {item.text}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function PlanCard({ items }: { items: TodoItem[] }) {
  const [open, setOpen] = useState(true)
  const doing = items.find((i) => i.status === 'in_progress')
  const { done, total } = todoCounts(items)
  return (
    <div
      data-testid="plan-card"
      className="mb-2 overflow-hidden rounded-[10px] border border-accent/25 bg-raised shadow-[0_2px_8px_rgb(0_0_0/0.04)]"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-[34px] w-full cursor-pointer items-center gap-2 px-2.5 py-[5px] text-left text-[0.962rem] text-fg-muted outline-none hover:bg-active focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset"
      >
        <ListTodo size={14} strokeWidth={1.6} className="shrink-0 text-accent" />
        <span className="shrink-0 font-medium text-fg">{t('plan.title')}</span>
        <span className="shrink-0 tabular-nums">{todoProgress(items)}</span>
        <span className="min-w-0 flex-1 truncate">{open ? '' : doing?.text}</span>
        <ChevronDown
          size={14}
          className={cx('shrink-0 text-fg-subtle transition-transform', open && 'rotate-180')}
        />
      </button>
      {/* biome-ignore lint/a11y/useSemanticElements: 原生 progress 的样式各平台不一样，按原型自绘 */}
      <div
        role="progressbar"
        aria-label={t('plan.title')}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="mx-3 mb-1.5 h-[3px] overflow-hidden rounded-[2px] bg-hover"
      >
        <div
          className="h-full rounded-[2px] bg-accent transition-[width] duration-200"
          style={{ width: `${total ? (done / total) * 100 : 0}%` }}
        />
      </div>
      {open ? <TodoList items={items} live className="max-h-[208px] overflow-y-auto" /> : null}
    </div>
  )
}
