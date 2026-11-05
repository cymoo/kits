import type { SessionSummary } from '@kits/core/ipc'
import {
  Download,
  Ellipsis,
  FolderOpen,
  Gauge,
  Minimize2,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { t } from '../../app/i18n'
import { errorText } from '../../lib/errors'
import { kits } from '../../lib/kits'
import { isMac } from '../../lib/shortcuts'
import { isBusy } from '../../lib/workspaces'
import { RemoveDialog } from '../../shell/SessionRow'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../ui/Menu'

// 顶栏的 … 菜单（原型 session.html）：上下文、导出、这个会话的管理。

export function SessionMenu({
  session,
  contextPct,
  onContext,
  onRename,
  onExported,
  onFailed,
}: {
  session: SessionSummary
  // 上下文用了百分之几；不知道窗口时没有
  contextPct: number | undefined
  onContext(): void
  onRename(): void
  onExported(path: string): void
  onFailed(message: string): void
}) {
  const [removing, setRemoving] = useState(false)
  // 选了改名、上下文、删除：焦点交给输入框或对话框，不回到按钮
  const handedOff = useRef(false)
  const busy = isBusy(session)
  const pinned = session.pinnedAt !== null
  const exportAs = async (format: 'markdown' | 'json') => {
    try {
      const { path } = await kits.session.export({ id: session.id, format })
      onExported(path)
    } catch (e) {
      onFailed(t('session.exportFailed', { error: errorText(e) }))
    }
  }
  const compact = async () => {
    try {
      await kits.session.compact(session.id)
    } catch (e) {
      onFailed(errorText(e))
    }
  }
  return (
    <>
      <Menu modal={false}>
        <MenuTrigger
          aria-label={t('session.more')}
          title={t('session.more')}
          className="relative z-20 flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-[8px] text-fg-muted outline-none hover:bg-active hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40 data-[state=open]:bg-active data-[state=open]:text-fg [-webkit-app-region:no-drag]"
        >
          <Ellipsis size={16} />
        </MenuTrigger>
        <MenuContent
          align="end"
          className="min-w-[224px]"
          onCloseAutoFocus={(e) => {
            if (handedOff.current) e.preventDefault()
            handedOff.current = false
          }}
        >
          <MenuItem
            onSelect={() => {
              handedOff.current = true
              onContext()
            }}
          >
            <Gauge size={14} />
            <span className="min-w-0 flex-1">{t('session.viewContext')}</span>
            {contextPct === undefined ? null : (
              <span className="text-[0.857rem] text-fg-subtle tabular-nums">
                {Math.round(contextPct)}%
              </span>
            )}
          </MenuItem>
          <MenuItem disabled={busy || session.turns === 0} onSelect={() => void compact()}>
            <Minimize2 size={14} />
            {t('context.compact')}
          </MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => void exportAs('markdown')}>
            <Download size={14} />
            {t('session.exportMarkdown')}
          </MenuItem>
          <MenuItem onSelect={() => void exportAs('json')}>
            <Download size={14} />
            {t('session.exportJson')}
          </MenuItem>
          <MenuItem onSelect={() => void kits.app.revealPath(session.workdir)}>
            <FolderOpen size={14} />
            {t(isMac ? 'nav.revealMac' : 'nav.reveal')}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            onSelect={() => {
              handedOff.current = true
              onRename()
            }}
          >
            <Pencil size={14} />
            {t('nav.rename')}
          </MenuItem>
          <MenuItem
            onSelect={() => void kits.session.setPinned({ id: session.id, pinned: !pinned })}
          >
            {pinned ? <PinOff size={14} /> : <Pin size={14} />}
            {t(pinned ? 'nav.unpinShort' : 'nav.pinShort')}
          </MenuItem>
          <MenuItem
            danger
            disabled={busy}
            onSelect={() => {
              handedOff.current = true
              setRemoving(true)
            }}
          >
            <Trash2 size={14} />
            <span className="min-w-0 flex-1">{t('nav.remove')}</span>
            {busy ? (
              <span className="text-[0.857rem] text-fg-subtle">{t('nav.removeRunning')}</span>
            ) : null}
          </MenuItem>
        </MenuContent>
      </Menu>
      <RemoveDialog session={session} open={removing} onOpenChange={setRemoving} />
    </>
  )
}
