import { RadioGroup as R } from 'radix-ui'
import { cx } from './cx'

// 分段选择（原型的 .k-seg）：主题、权限三档、内核切换都用它
export function Segmented<V extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: V
  onChange: (v: V) => void
  options: { value: V; label: string; className?: string }[]
  label: string
  className?: string
}) {
  return (
    <R.Root
      value={value}
      onValueChange={(v) => onChange(v as V)}
      aria-label={label}
      orientation="horizontal"
      className={cx('flex shrink-0 gap-0.5 rounded-[7px] bg-muted p-0.5', className)}
    >
      {options.map((o) => (
        <R.Item
          key={o.value}
          value={o.value}
          className={cx(
            'h-6 cursor-pointer rounded-[5px] px-2.5 text-[0.923rem] text-fg-muted data-[state=checked]:bg-raised data-[state=checked]:font-semibold data-[state=checked]:text-fg data-[state=checked]:shadow-[0_1px_2px_rgba(0,0,0,.08)]',
            o.className,
          )}
        >
          {o.label}
        </R.Item>
      ))}
    </R.Root>
  )
}
