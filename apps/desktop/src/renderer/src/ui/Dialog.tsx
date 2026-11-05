import { Dialog as D } from 'radix-ui'
import type { ReactNode } from 'react'
import { cx } from './cx'

// 模态框：遮罩 + 居中卡片。⌘K 面板顶部对齐，其他居中。

export const Dialog = D.Root
export const DialogTrigger = D.Trigger
export const DialogClose = D.Close
export const DialogTitle = D.Title
export const DialogDescription = D.Description

export function DialogContent({
  children,
  className,
  align = 'center',
  label,
  role,
}: {
  children: ReactNode
  className?: string
  align?: 'center' | 'top'
  // 没有可见标题时给读屏用
  label?: string
  // 确认不能撤销的操作时用 alertdialog，正文用 DialogDescription
  role?: 'alertdialog'
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-overlay" />
      <D.Content
        {...(role ? { role } : { 'aria-describedby': undefined })}
        className={cx(
          'fixed left-1/2 z-50 w-[640px] max-w-[calc(100%-48px)] -translate-x-1/2 overflow-hidden rounded-[14px] bg-raised text-fg shadow-dialog outline-none',
          align === 'top' ? 'top-[120px]' : 'top-1/2 -translate-y-1/2',
          className,
        )}
      >
        {label ? <D.Title className="sr-only">{label}</D.Title> : null}
        {children}
      </D.Content>
    </D.Portal>
  )
}
