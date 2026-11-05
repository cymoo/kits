import type { SessionSummary } from '@kits/core/ipc'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Ellipsis, FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useMatch, useNavigate } from 'react-router'
import { t } from '../app/i18n'
import { usePrefs } from '../lib/composer-prefs'
import { errorText } from '../lib/errors'
import { kits } from '../lib/kits'
import { sessionKeys } from '../lib/sessions'
import { isMac } from '../lib/shortcuts'
import { useUi } from '../lib/ui-store'
import { foldedStatus, isBusy, type Workspace } from '../lib/workspaces'
import { Button } from '../ui/Button'
import { cx } from '../ui/cx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/Dialog'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/Menu'
import { InlineRename } from './InlineRename'
import { SessionRow } from './SessionRow'
import { StatusDot } from './StatusDot'

// 侧栏的一个工作区（原型 shell.js）：可折叠，当前会话所在的组强制展开；组标题的 + 在这里开新会话，
// … 或右键打开菜单。移除连同会话一起删，磁盘上的目录不动。

const SHOWN = 5
const MAX_NAME = 60

function RemoveDialog({
  workspace: w,
  open,
  onOpenChange,
}: {
  workspace: Workspace
  open: boolean
  onOpenChange(open: boolean): void
}) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const viewing = useMatch('/s/:id')?.params.id
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const n = w.all.length
  const remove = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await kits.workdir.remove({ path: w.path })
      // 这一组随列表更新卸载，先离开它的页面
      const gone = new Set(w.all.map((s) => s.id))
      if (viewing && gone.has(viewing)) navigate('/')
      client.setQueryData<SessionSummary[]>(sessionKeys.list, (list) =>
        (list ?? []).filter((s) => !gone.has(s.id)),
      )
      const prefs = usePrefs.getState()
      if (prefs.workdir === w.path) prefs.set({ workdir: undefined })
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[420px]! p-5" role="alertdialog">
        <DialogTitle className="m-0 mb-1.5 font-semibold text-[1.143rem]">
          {t('nav.removeWorkspaceTitle', { name: w.name })}
        </DialogTitle>
        <DialogDescription className="m-0 text-fg-muted leading-[1.6] [overflow-wrap:anywhere]">
          {n
            ? t('nav.removeWorkspaceBody', { n, path: w.path })
            : t('nav.removeWorkspaceEmpty', { path: w.path })}
        </DialogDescription>
        {error ? <p className="m-0 mt-2 text-[0.929rem] text-danger">{error}</p> : null}
        <div className="mt-[18px] flex justify-end gap-2">
          <Button className="h-[30px] px-3" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void remove()}>
            {n ? t('nav.removeWorkspaceConfirm', { n }) : t('nav.removeWorkspace')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const action =
  'absolute top-[5px] flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-[6px] text-fg-muted opacity-0 outline-none hover:bg-active hover:text-fg focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/40 group-hover/ws:opacity-100 data-[state=open]:bg-active data-[state=open]:text-fg data-[state=open]:opacity-100'

export function WorkspaceGroup({ workspace: w, now }: { workspace: Workspace; now: number }) {
  const navigate = useNavigate()
  const folded = useUi((u) => u.foldedWorkspaces.includes(w.key))
  const toggleWorkspace = useUi((u) => u.toggleWorkspace)
  const viewing = useMatch('/s/:id')?.params.id
  const hasViewing = w.sessions.some((s) => s.id === viewing)
  const open = !folded || hasViewing
  const [all, setAll] = useState(false)
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [removing, setRemoving] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const busy = w.all.some(isBusy)
  // 当前会话在折起来的部分时也要看得到
  const showAll = all || w.sessions.slice(SHOWN).some((s) => s.id === viewing)
  const shown = showAll ? w.sessions : w.sessions.slice(0, SHOWN)
  const rest = w.sessions.length - shown.length
  const status = open ? undefined : foldedStatus(w)
  return (
    <div className="flex flex-col gap-0.5" data-testid="workspace">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 右键只是快捷方式，键盘走 … 按钮 */}
      <div
        className="group/ws relative"
        onContextMenu={(e) => {
          if (renaming) return
          e.preventDefault()
          setMenu(true)
        }}
      >
        {renaming ? (
          <InlineRename
            value={w.name}
            label={t('nav.workspaceName')}
            maxLength={MAX_NAME}
            input={input}
            save={(label) => kits.workdir.rename({ path: w.path, label })}
            onDone={() => setRenaming(false)}
          />
        ) : (
          <button
            type="button"
            aria-expanded={open}
            title={w.path}
            onClick={() => toggleWorkspace(w.key)}
            className="flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-[8px] pr-2 pl-1.5 text-left font-medium outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/40 group-hover/ws:bg-hover group-hover/ws:pr-[58px] group-has-[button[data-state=open]]/ws:bg-hover group-has-[button[data-state=open]]/ws:pr-[58px]"
          >
            <ChevronDown
              size={13}
              className={cx('shrink-0 text-fg-subtle transition-transform', !open && '-rotate-90')}
            />
            <span className="min-w-0 flex-1 truncate">{w.name}</span>
            {status ? <StatusDot status={status} /> : null}
          </button>
        )}
        <Menu open={menu} onOpenChange={setMenu} modal={false}>
          <MenuTrigger
            aria-label={t('nav.workspaceMore', { name: w.name })}
            title={t('nav.moreShort')}
            className={cx(action, 'right-7', renaming && 'hidden')}
          >
            <Ellipsis size={14} />
          </MenuTrigger>
          <MenuContent
            className="min-w-[188px]"
            align="start"
            onCloseAutoFocus={(e) => {
              // 焦点交给改名输入框或确认框，不回到按钮
              if (renaming || removing) e.preventDefault()
            }}
          >
            <MenuItem onSelect={() => setRenaming(true)}>
              <Pencil size={14} />
              {t('nav.rename')}
            </MenuItem>
            <MenuItem onSelect={() => void kits.app.revealPath(w.path)}>
              <FolderOpen size={14} />
              {t(isMac ? 'nav.revealMac' : 'nav.reveal')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem danger disabled={busy} onSelect={() => setRemoving(true)}>
              <Trash2 size={14} />
              <span className="min-w-0 flex-1">{t('nav.removeWorkspace')}</span>
              {busy ? (
                <span className="text-[0.857rem] text-fg-subtle">{t('nav.removeRunning')}</span>
              ) : null}
            </MenuItem>
          </MenuContent>
        </Menu>
        <button
          type="button"
          aria-label={t('nav.newIn', { name: w.name })}
          title={t('nav.newInShort')}
          onClick={() => {
            usePrefs.getState().set({ workdir: w.path })
            navigate('/')
          }}
          className={cx(action, 'right-1', renaming && 'hidden')}
        >
          <Plus size={14} />
        </button>
      </div>
      {open ? (
        <div className="flex flex-col gap-0.5 pb-1.5">
          {shown.map((s) => (
            <SessionRow key={s.id} session={s} now={now} indent />
          ))}
          {rest > 0 ? (
            <button
              type="button"
              onClick={() => setAll(true)}
              className="h-7 cursor-pointer rounded-[8px] pr-2 pl-[26px] text-left text-[0.929rem] text-fg-label hover:bg-hover hover:text-fg"
            >
              {t('nav.showRest', { n: rest })}
            </button>
          ) : null}
          {w.sessions.length ? null : (
            <p className="m-0 pr-2 pb-1 pl-[26px] text-[0.929rem] text-fg-subtle">
              {t('nav.noSessions')}
            </p>
          )}
        </div>
      ) : null}
      <RemoveDialog workspace={w} open={removing} onOpenChange={setRemoving} />
    </div>
  )
}
