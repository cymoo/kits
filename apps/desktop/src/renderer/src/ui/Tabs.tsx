import { Tabs as T } from 'radix-ui'
import type { ReactNode } from 'react'
import { cx } from './cx'

export const Tabs = T.Root
export const TabsContent = T.Content

export function TabsList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <T.List aria-label={label} className="flex items-center gap-1 border-line-soft border-b px-3">
      {children}
    </T.List>
  )
}

export function TabsTrigger({
  value,
  children,
  className,
}: {
  value: string
  children: ReactNode
  className?: string
}) {
  return (
    <T.Trigger
      value={value}
      className={cx(
        '-mb-px h-9 cursor-pointer border-transparent border-b-2 px-2 text-fg-muted data-[state=active]:border-fg data-[state=active]:font-medium data-[state=active]:text-fg',
        className,
      )}
    >
      {children}
    </T.Trigger>
  )
}
