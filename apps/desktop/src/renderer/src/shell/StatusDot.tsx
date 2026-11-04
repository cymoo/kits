import type { SessionSummary } from '@kits/core/ipc'
import { cx } from '../ui/cx'

// 运行中蓝点闪，等处理黄点，出错红点
export function StatusDot({ status }: { status: SessionSummary['status'] }) {
  if (status !== 'running' && status !== 'waiting' && status !== 'error') return null
  return (
    <span
      aria-hidden="true"
      className={cx(
        'h-[7px] w-[7px] shrink-0 rounded-full',
        status === 'running' && 'animate-[k-pulse_1.4s_ease-in-out_infinite] bg-accent',
        status === 'waiting' && 'bg-warn',
        status === 'error' && 'bg-danger',
      )}
    />
  )
}
