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

// 菜单里的开关项（输入框 + 菜单的“本次会话可用的平台”）：点了不关菜单
export function MenuSwitchItem({
  checked,
  onCheckedChange,
  children,
}: {
  checked: boolean
  onCheckedChange(v: boolean): void
  children: ReactNode
}) {
  return (
    <M.CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      onSelect={(e) => e.preventDefault()}
      className={item}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <span
        aria-hidden="true"
        className={cx(
          'relative h-[18px] w-8 shrink-0 rounded-[9px] transition-colors',
          checked ? 'bg-primary' : 'bg-line-strong',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-raised shadow-[0_1px_2px_rgba(0,0,0,.2)] transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </span>
    </M.CheckboxItem>
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

// 菜单里的分段选择（输入框“内核与模型”顶上的 OpenCode / CodeAgent）：用菜单自己的单选项，
// 方向键能走到，选了不关菜单
export function MenuSegmented<V extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: V
  onChange: (v: V) => void
  options: { value: V; label: string }[]
  label: string
}) {
  return (
    <M.RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as V)}
      aria-label={label}
      className="mx-1.5 mt-0.5 mb-1.5 flex gap-0.5 rounded-[7px] bg-muted p-0.5"
    >
      {options.map((o) => (
        <M.RadioItem
          key={o.value}
          value={o.value}
          onSelect={(e) => e.preventDefault()}
          className="h-6 flex-1 cursor-pointer rounded-[5px] px-2.5 text-center text-[0.923rem] text-fg-muted leading-6 outline-none data-[highlighted]:ring-2 data-[highlighted]:ring-accent/30 data-[state=checked]:bg-raised data-[state=checked]:font-semibold data-[state=checked]:text-fg data-[state=checked]:shadow-[0_1px_2px_rgba(0,0,0,.08)]"
        >
          {o.label}
        </M.RadioItem>
      ))}
    </M.RadioGroup>
  )
}
