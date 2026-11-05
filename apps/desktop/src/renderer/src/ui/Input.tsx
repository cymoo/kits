import { forwardRef, type InputHTMLAttributes } from 'react'
import { cx } from './cx'

// 原型的 .k-input：34px 高，聚焦蓝边 + 浅蓝光圈
export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }
>(function Input({ className, mono, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cx(
        'h-[34px] w-full rounded-[8px] border border-line bg-raised px-3 text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:shadow-[0_0_0_3px_rgb(54_89_227/0.15)]',
        mono && 'font-mono text-[0.929rem]',
        className,
      )}
      {...props}
    />
  )
})

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: 控件由 children 传入
    <label className="flex flex-col gap-1.5">
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-[0.929rem] text-fg-muted">{hint}</span> : null}
    </label>
  )
}
