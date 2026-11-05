import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cx } from './cx'

// 原型里的三种按钮：primary（深色实底）、secondary（白底描边）、ghost（透明，悬停变灰），加链接样式的 link，
// danger 是不能撤销的操作（确认删除）
type Variant = 'primary' | 'secondary' | 'ghost' | 'link' | 'danger'

const variants: Record<Variant, string> = {
  primary: 'h-[30px] px-3 rounded-[8px] bg-primary text-primary-fg font-medium hover:opacity-90',
  secondary: 'h-7 px-2.5 rounded-[7px] border border-line bg-raised text-fg hover:bg-active',
  ghost: 'h-7 px-2 rounded-[8px] text-fg-muted hover:bg-active hover:text-fg',
  link: 'h-6 px-1.5 rounded-[5px] text-accent hover:text-accent-fg',
  danger: 'h-[30px] px-3 rounded-[8px] bg-danger text-white font-medium hover:opacity-90',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 text-[0.923rem] disabled:cursor-default disabled:opacity-40',
        variants[variant],
        className,
      )}
      {...props}
    />
  )
})
