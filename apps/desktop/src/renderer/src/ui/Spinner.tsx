import { cx } from './cx'

export function Spinner({
  tone = 'muted',
  size = 12,
}: {
  tone?: 'accent' | 'warn' | 'muted'
  size?: number
}) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cx(
        'inline-block shrink-0 animate-spin rounded-full border-2',
        tone === 'accent' && 'border-accent-bg border-t-accent',
        tone === 'warn' && 'border-warn-bg border-t-warn',
        tone === 'muted' && 'border-line border-t-accent',
      )}
    />
  )
}
