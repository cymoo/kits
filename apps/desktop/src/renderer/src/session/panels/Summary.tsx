import { type ReactNode, useState } from 'react'
import { t } from '../../app/i18n'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { type Command, formatTokens, type Round, type Usage } from './derive'
import type { PanelTab } from './Workbench'

// 会话做完时对话末尾的总结卡片（原型 session.html 的 isSummary）：改动、命令、用量三格，点了跳到右侧对应的页签。
// 原型第三格是“产出”，产出面板在 PR10，先放用量。

export function SummaryCard({
  rounds,
  commands,
  usage,
  answer,
  onOpen,
}: {
  rounds: Round[]
  commands: Command[]
  usage: Usage
  // 最后一段回复正文，“复制回复”用
  answer: string
  onOpen(tab: PanelTab): void
}) {
  const [copied, setCopied] = useState(false)
  const files = new Set(rounds.flatMap((r) => r.files.map((f) => f.path))).size
  const additions = rounds.reduce((n, r) => n + r.additions, 0)
  const deletions = rounds.reduce((n, r) => n + r.deletions, 0)
  const failed = commands.filter((c) => c.state === 'failed').length
  const cells: { tab: PanelTab; label: string; value: string; note: ReactNode }[] = [
    {
      tab: 'changes',
      label: t('summary.changes'),
      value: files ? t('summary.files', { n: files }) : t('summary.noFiles'),
      note: files ? (
        <>
          <span className="text-ok">+{additions}</span>{' '}
          <span className="text-danger">−{deletions}</span> ·{' '}
          {t('summary.rounds', { n: rounds.length })}
        </>
      ) : null,
    },
    {
      tab: 'terminal',
      label: t('summary.commands'),
      value: commands.length
        ? t('summary.commandCount', { n: commands.length })
        : t('summary.noCommands'),
      note: commands.length
        ? failed
          ? t('summary.failed', { n: failed })
          : t('summary.allPassed')
        : null,
    },
    {
      tab: 'context',
      label: t('summary.usage'),
      value: `${formatTokens(usage.input + usage.cacheRead)} / ${formatTokens(usage.output)}`,
      note: usage.cost ? `约 ¥${usage.cost.toFixed(2)}` : t('summary.usageNote'),
    },
  ]
  return (
    <div className="flex flex-col gap-2.5" data-testid="summary">
      <div className="flex flex-col overflow-hidden rounded-[12px] border border-line-soft">
        <div className="border-line-soft border-b bg-panel px-3.5 py-[9px] font-medium text-[0.923rem] text-fg-muted">
          {t('summary.title')}
        </div>
        <div className="grid grid-cols-3">
          {cells.map((c, i) => (
            <button
              key={c.tab}
              type="button"
              onClick={() => onOpen(c.tab)}
              className={cx(
                'flex cursor-pointer flex-col gap-1 px-3.5 py-3 text-left hover:bg-active',
                i < cells.length - 1 && 'border-line-soft border-r',
              )}
            >
              <span className="text-[0.923rem] text-fg-muted">{c.label}</span>
              <span className="font-semibold text-[1.077rem]">{c.value}</span>
              <span className="text-[0.923rem] text-fg-muted">{c.note}</span>
            </button>
          ))}
        </div>
      </div>
      {answer ? (
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            onClick={() =>
              void navigator.clipboard.writeText(answer).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }
          >
            {copied ? t('summary.copied') : t('summary.copy')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
