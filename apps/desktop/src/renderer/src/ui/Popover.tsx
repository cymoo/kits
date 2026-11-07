import { Popover as P } from 'radix-ui'
import type { ReactNode } from 'react'
import { cx } from './cx'

export const Popover = P.Root
export const PopoverTrigger = P.Trigger
export const PopoverAnchor = P.Anchor

export function PopoverContent({
  children,
  className,
  side = 'top',
  align = 'start',
  label,
}: {
  children: ReactNode
  className?: string
  side?: 'top' | 'bottom' | 'right'
  align?: 'start' | 'end'
  // 内容是一块说明（不是菜单）时给读屏的名字
  label?: string
}) {
  return (
    <P.Portal>
      <P.Content
        side={side}
        align={align}
        sideOffset={8}
        aria-label={label}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cx(
          'z-50 rounded-[12px] border border-line bg-raised p-1.5 text-fg shadow-pop',
          className,
        )}
      >
        {children}
      </P.Content>
    </P.Portal>
  )
}
