import type { SessionDetail } from '@kits/core/ipc'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../app/i18n'
import { errorText } from '../../lib/errors'
import { kits, useHomeLabel } from '../../lib/kits'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../../ui/Dialog'
import { formatTokens, type Usage } from './derive'

// 上下文对话框（原型 session.html）：用量、内核和模型、记忆、允许规则。顶栏 … 菜单和输入框的用量环打开。

interface ContextProps {
  detail: SessionDetail
  rules: string[]
  usage: Usage
  // 当前模型的上下文窗口；不知道时为 0
  contextWindow: number
}

export function ContextDialog({
  open,
  onOpenChange,
  ...props
}: ContextProps & { open: boolean; onOpenChange(open: boolean): void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-96px)] w-[520px]! flex-col">
        <div className="flex shrink-0 items-center gap-2 pt-3.5 pr-3 pb-1.5 pl-5">
          <DialogTitle className="m-0 flex-1 font-semibold text-[1.143rem]">
            {t('panel.context')}
          </DialogTitle>
          <DialogClose
            aria-label={t('common.close')}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[6px] text-fg-muted hover:bg-active hover:text-fg"
          >
            <X size={13} />
          </DialogClose>
        </div>
        <ContextBody {...props} />
      </DialogContent>
    </Dialog>
  )
}

function ContextBody({ detail, usage, contextWindow, rules }: ContextProps) {
  const homeLabel = useHomeLabel()
  const { session } = detail
  const [compactError, setCompactError] = useState<string>()
  const [compacting, setCompacting] = useState(false)
  const busy = compacting || session.status === 'running' || session.status === 'waiting'
  // 这个会话会读到的记忆条数（项目 + 个人）
  const memory = useQuery({
    queryKey: ['memory', 'count', session.workdir],
    queryFn: async () => {
      const [project, personal] = await Promise.all([
        kits.memory.list({ scope: 'project', workdir: session.workdir }),
        kits.memory.list({ scope: 'personal' }),
      ])
      return { project: project.entries.length, personal: personal.entries.length }
    },
  })
  const compact = async () => {
    setCompacting(true)
    setCompactError(undefined)
    try {
      await kits.session.compact(session.id)
    } catch (e) {
      setCompactError(errorText(e))
    } finally {
      setCompacting(false)
    }
  }
  const pct = contextWindow ? Math.min(100, (usage.context / contextWindow) * 100) : 0
  const near = pct >= 80
  // input 已经含缓存读写
  const cachePct = usage.input ? Math.round((usage.cacheRead / usage.input) * 100) : 0
  const model = session.model.slice(session.model.indexOf('/') + 1)
  const rows: [string, string][] = [
    [t('context.agent'), session.agent],
    [
      t('context.kernel'),
      [
        session.kernel === 'opencode' ? 'OpenCode' : 'CodeAgent',
        model,
        contextWindow ? t('context.window', { n: formatTokens(contextWindow) }) : null,
      ]
        .filter(Boolean)
        .join(' · '),
    ],
    [t('context.workdir'), homeLabel(session.workdir)],
  ]
  if (memory.data) {
    rows.push([
      t('context.memory'),
      t('context.memoryValue', { project: memory.data.project, personal: memory.data.personal }),
    ])
  }
  if (usage.input || usage.output) {
    rows.push([
      t('context.tokens'),
      [
        t('context.tokensValue', {
          input: formatTokens(usage.input),
          output: formatTokens(usage.output),
        }),
        usage.cacheRead ? t('context.cache', { pct: cachePct }) : null,
        usage.cost ? `约 ¥${usage.cost.toFixed(2)}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    ])
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4" data-testid="context">
      <div className="flex flex-col gap-2 border-line-soft border-b py-3">
        <div className="flex items-baseline text-[0.929rem]">
          <span className="flex-1 text-fg-muted">{t('context.usage')}</span>
          <span className="font-medium font-mono" data-testid="context-usage">
            {usage.context
              ? `${formatTokens(usage.context)}${contextWindow ? ` / ${formatTokens(contextWindow)}` : ''}`
              : t('context.unknown')}
          </span>
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: 原生 meter 的样式各平台不一样，按原型自绘 */}
        <div
          role="meter"
          aria-label={t('context.usage')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          className="flex h-2 overflow-hidden rounded-[4px] bg-hover"
        >
          <div
            className={cx('h-full transition-[width]', near ? 'bg-warn' : 'bg-accent')}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="text-[0.929rem] text-fg-muted leading-[1.6]">{t('context.note')}</div>
        {session.turns > 0 ? (
          <div className="flex items-start gap-2.5 pt-1">
            <span className="min-w-0 flex-1 text-[0.857rem] text-fg-label leading-[1.6]">
              {compactError ? (
                <span role="alert" className="text-danger">
                  {compactError}
                </span>
              ) : (
                t('context.compactHint')
              )}
            </span>
            <Button className="h-[26px] px-2" disabled={busy} onClick={() => void compact()}>
              {t('context.compact')}
            </Button>
          </div>
        ) : null}
      </div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-3 border-line-soft border-b py-2.5">
          <span className="shrink-0 basis-[60px] text-[0.929rem] text-fg-muted">{k}</span>
          <span className="min-w-0 flex-1 whitespace-pre-line break-all font-mono text-[0.929rem]">
            {v}
          </span>
        </div>
      ))}
      <div className="flex gap-3 border-line-soft border-b py-2.5" data-testid="allow-rules">
        <span className="shrink-0 basis-[60px] text-[0.929rem] text-fg-muted">
          {t('context.rules')}
        </span>
        {rules.length ? (
          <span className="flex min-w-0 flex-1 flex-wrap gap-1.5 text-[0.929rem]">
            {rules.map((r) => (
              <span key={r} className="rounded-[4px] bg-hover px-[5px] font-mono">
                {r}
              </span>
            ))}
          </span>
        ) : (
          <span className="min-w-0 flex-1 text-[0.929rem] text-fg-label">
            {t('context.noRules')}
          </span>
        )}
      </div>
    </div>
  )
}
