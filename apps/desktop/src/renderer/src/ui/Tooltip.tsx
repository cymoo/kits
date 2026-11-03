import { Tooltip as T } from 'radix-ui'
import type { ReactNode } from 'react'

export const TooltipProvider = T.Provider

export function Tooltip({
  content,
  children,
  side = 'right',
}: {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-50 rounded-[6px] bg-primary px-2 py-1 text-[0.846rem] text-primary-fg"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}
