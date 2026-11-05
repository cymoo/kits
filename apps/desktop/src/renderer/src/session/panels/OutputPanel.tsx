import type { OutputView } from '@kits/core/ipc'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../app/i18n'
import { errorText } from '../../lib/errors'
import { kits } from '../../lib/kits'
import { cx } from '../../ui/cx'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../ui/Menu'

// 产出页签（原型 session.html 的 isOutput）：submit_output 交上来的 JSON，能看、复制、导出。
// 对话里的产出卡片打开它，平时不占页签。

export function OutputPanel({
  outputs,
  picked,
  onPick,
  onExported,
}: {
  outputs: OutputView[]
  picked: string | undefined
  onPick(id: string): void
  onExported(path: string): void
}) {
  const current = outputs.find((o) => o.id === picked) ?? outputs.at(-1)
  const [notice, setNotice] = useState<{ copied: true } | { error: string }>()
  if (!current) return null
  const content = current.edited ?? current.aiDraft
  const exportJson = async () => {
    setNotice(undefined)
    try {
      const { path } = await kits.output.export({ id: current.id, format: 'json' })
      onExported(path)
    } catch (e) {
      setNotice({ error: errorText(e) })
    }
  }
  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(content, null, 2))
    setNotice({ copied: true })
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="output">
      <div className="flex shrink-0 items-center gap-1.5 border-line-soft border-b px-2.5 py-2">
        <span className="min-w-0 flex-1 truncate text-[0.929rem] text-fg-muted">
          {t('output.structured')}
        </span>
        {outputs.length > 1 ? (
          <Menu>
            <MenuTrigger className="inline-flex h-[26px] cursor-pointer items-center gap-1 rounded-[8px] px-2 text-[0.929rem] text-fg-muted hover:bg-active">
              {t('output.nth', { n: outputs.indexOf(current) + 1 })}
              <ChevronDown size={11} />
            </MenuTrigger>
            <MenuContent align="end" className="min-w-[140px]">
              {outputs
                .map((o, i) => (
                  <MenuItem key={o.id} onSelect={() => onPick(o.id)}>
                    {t('output.nth', { n: i + 1 })}
                  </MenuItem>
                ))
                .reverse()}
            </MenuContent>
          </Menu>
        ) : null}
        <Menu>
          <MenuTrigger className="inline-flex h-[26px] cursor-pointer items-center gap-1 rounded-[8px] bg-primary px-2.5 font-medium text-[0.929rem] text-primary-fg hover:opacity-90">
            {t('output.export')}
            <ChevronDown size={11} />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem onSelect={() => void exportJson()}>{t('output.exportJson')}</MenuItem>
            <MenuItem onSelect={() => void copy()}>{t('output.copy')}</MenuItem>
          </MenuContent>
        </Menu>
      </div>
      {notice ? (
        <div
          role={'error' in notice ? 'alert' : 'status'}
          className={cx(
            'shrink-0 border-line-soft border-b px-3 py-1.5 text-[0.929rem]',
            'error' in notice ? 'bg-danger-bg/60 text-danger' : 'bg-ok-bg/50 text-ok',
          )}
        >
          {'error' in notice
            ? t('output.exportFailed', { error: notice.error })
            : t('output.copied')}
        </div>
      ) : null}
      <pre className="m-0 min-h-0 flex-1 overflow-auto bg-raised px-4 py-3.5 font-mono text-[0.929rem] text-fg leading-[1.7]">
        {JSON.stringify(content, null, 2)}
      </pre>
    </div>
  )
}
