import { DropdownMenu as M } from 'radix-ui'
import type { ReactNode } from 'react'
import { cx } from './cx'

// 下拉菜单：原型里输入框的目录 / Agent / 权限 / 模型浮层都是这个样子（.kp）。
export const Menu = M.Root
export const MenuTrigger = M.Trigger

export function MenuContent({
  children,
  className,
  align = 'start',
}: {
  children: ReactNode
  className?: string
  align?: 'start' | 'end'
}) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        className={cx(
          'z-50 min-w-[240px] max-w-[320px] rounded-[12px] border border-line bg-raised p-1.5 text-fg shadow-pop',
          className,
        )}
      >
        {children}
      </M.Content>
    </M.Portal>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <M.Label className="px-2 pt-1.5 pb-1 font-medium text-[0.885rem] text-fg-label">
      {children}
    </M.Label>
  )
}

export function MenuSeparator() {
  return <M.Separator className="mx-0.5 my-[5px] h-px bg-line-soft" />
}

const item =
  'flex min-h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2 py-[5px] text-left outline-none data-[highlighted]:bg-active'

export function MenuItem({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) {
  return (
    <M.Item className={item} {...(onSelect ? { onSelect } : {})}>
      {children}
    </M.Item>
  )
}

export const MenuRadioGroup = M.RadioGroup

export function MenuRadioItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <M.RadioItem value={value} className={item}>
      <span className="min-w-0 flex-1">{children}</span>
      <M.ItemIndicator className="ml-auto text-fg">✓</M.ItemIndicator>
    </M.RadioItem>
  )
}
