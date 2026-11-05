import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { cx } from '../ui/cx'

// 侧栏里就地改名：回车或点别处保存，Esc 放弃，空的或没变的不保存；保存失败留在输入框里
export function InlineRename({
  value: initial,
  label,
  maxLength,
  input,
  save,
  onDone,
}: {
  value: string
  label: string
  maxLength: number
  input: React.RefObject<HTMLInputElement | null>
  save(value: string): Promise<void>
  onDone(): void
}) {
  const [value, setValue] = useState(initial)
  const [failed, setFailed] = useState(false)
  // Esc 收起时输入框失焦，不能再当保存
  const settled = useRef(false)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [input])
  const commit = async () => {
    if (settled.current) return
    const next = value.trim()
    settled.current = true
    if (!next || next === initial) return onDone()
    try {
      await save(next)
      onDone()
    } catch {
      settled.current = false
      setFailed(true)
    }
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      void commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      settled.current = true
      onDone()
    }
  }
  return (
    <input
      ref={input}
      aria-label={label}
      aria-invalid={failed}
      maxLength={maxLength}
      value={value}
      onChange={(e) => {
        setValue(e.target.value)
        setFailed(false)
      }}
      onKeyDown={onKeyDown}
      onBlur={() => void commit()}
      className={cx(
        'block h-8 w-full rounded-[8px] border bg-raised px-2 text-fg outline-none shadow-[0_0_0_3px_rgb(53_99_224/0.15)]',
        failed ? 'border-danger' : 'border-accent',
      )}
    />
  )
}
