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
}: {
  children: ReactNode
  className?: string
  side?: 'top' | 'bottom'
  align?: 'start' | 'end'
}) {
  return (
    <P.Portal>
      <P.Content
        side={side}
        align={align}
        sideOffset={8}
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
