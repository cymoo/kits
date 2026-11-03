import { Switch as S } from 'radix-ui'

// 原型里的开关（.k-sw）：32×18，开是深色
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <S.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      {...(disabled ? { disabled } : {})}
      className="relative h-[18px] w-8 shrink-0 cursor-pointer rounded-[9px] bg-line-strong p-0 data-[state=checked]:bg-primary disabled:opacity-40"
    >
      <S.Thumb className="block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-raised shadow-[0_1px_2px_rgba(0,0,0,.2)] transition-transform data-[state=checked]:translate-x-4" />
    </S.Root>
  )
}
