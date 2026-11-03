import type { ReactNode } from 'react'
import { cx } from './cx'

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('text-[0.846rem] text-fg-subtle', className)}>{children}</span>
}
