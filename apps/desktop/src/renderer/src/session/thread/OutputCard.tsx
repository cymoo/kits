import type { OutputView } from '@kits/core/ipc'
import { FileText } from 'lucide-react'
import { t } from '../../app/i18n'
import { Button } from '../../ui/Button'
import { outputCount } from './outputs'

// 对话里的产出卡片：Agent 交了产出才有。查看在右侧打开产出页签，导出直接写文件
export function OutputCard({
  output,
  agent,
  onOpen,
  onExport,
}: {
  output: OutputView
  agent: string
  onOpen(): void
  onExport(): void
}) {
  const n = outputCount(output.edited ?? output.aiDraft)
  return (
    <div
      data-testid="output-card"
      className="flex items-center gap-3 rounded-[12px] border border-line bg-raised px-3 py-2.5"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-accent-bg text-accent-fg">
        <FileText size={16} strokeWidth={1.5} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{t('output.card')}</span>
        <span className="truncate text-[0.857rem] text-fg-label leading-[1.5]">
          {n === undefined ? agent : t('output.cardCount', { agent, n })}
        </span>
      </span>
      <Button className="h-[30px] px-3 text-[0.929rem]" onClick={onOpen}>
        {t('output.open')}
      </Button>
      <Button variant="primary" className="h-[30px] px-3 text-[0.929rem]" onClick={onExport}>
        {t('output.export')}
      </Button>
    </div>
  )
}
