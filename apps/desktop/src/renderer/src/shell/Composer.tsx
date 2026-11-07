import type { AttachmentInput, PermissionMode, QueuedDraft } from '@kits/core/ipc'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowUp,
  AtSign,
  Bot,
  ChevronDown,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Paperclip,
  Plus,
  Shield,
  SlidersHorizontal,
  Square,
  X,
} from 'lucide-react'
import {
  type KeyboardEvent,
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useLocation, useNavigate } from 'react-router'
import { t } from '../app/i18n'
import { basename, resolvePrefs, usePrefs } from '../lib/composer-prefs'
import { errorText } from '../lib/errors'
import { firstImageModel, supportsImages } from '../lib/gateway'
import { kits, useSettings } from '../lib/kits'
import { isMac, shortcuts } from '../lib/shortcuts'
import { useUi } from '../lib/ui-store'
import { formatTokens } from '../session/panels/derive'
import { cx } from '../ui/cx'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSegmented,
  MenuSeparator,
  MenuSwitchItem,
  MenuTrigger,
} from '../ui/Menu'
import { type AtQuery, atQuery, formatSize, insertAt } from './composer-at'
import { draftAfterSend } from './composer-draft'
import { brokenImage, isImageFile, MAX_IMAGE_BYTES, pastedImages } from './composer-image'
import { MENU_MAX_HEIGHT, type MenuPlacement, placeMenu } from './composer-menu'

// 菜单和输入框的间距；窗口顶部留的地方，macOS 上要避开隐藏标题栏后的拖动区
const MENU_GAP = 8
const MENU_TOP_INSET = isMac ? 40 : 12

// 输入框（原型 shell.js 的 <k-composer>）：文本区自动长高；目录、Agent、权限、内核与模型四个浮层；↵ 发送、⇧↵ 换行。
// 首页（big）发送时新建会话；会话页发送时在当前会话里接着说。
// `+` 上传附件、引用文件；附件也能直接拖进来，截图能直接粘贴；打 @ 弹出工作目录里的文件。`/` 技能菜单在 PR13。
// 当前模型看不了图片时不发，提示换模型或去掉图片。

// 渲染进程这边先挡一下，主进程还会再查
const MAX_BYTES = 20 * 1024 * 1024
const ACCEPT =
  '.docx,.pdf,.md,.markdown,.txt,.log,.csv,.tsv,.json,.jsonl,.yaml,.yml,.xml,.html,.sql,.py,.js,.ts,.tsx,.java,.go,.kt,.rs,.sh,.png,.jpg,.jpeg,.webp,.gif'

// “每次确认”收在设置页，这里只在当前就是它的时候列出来，不然菜单里没有选中项
const PERMS = ['smart', 'read', 'auto'] as const satisfies readonly PermissionMode[]

export interface ComposerSubmit {
  text: string
  workdir: string
  agent: string
  permissionMode: PermissionMode
  kernel: 'opencode' | 'codeagent'
  model: string
  attachments: AttachmentInput[]
  mcpOff: string[]
}

const chip =
  'inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[8px] px-2 text-[0.929rem] text-fg-muted outline-none hover:bg-active hover:text-fg data-[state=open]:bg-active data-[state=open]:text-fg'

const sendButton =
  'ml-auto flex h-[30px] w-[30px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-fg transition-opacity disabled:cursor-default disabled:opacity-25'

// 上下文用量环：八成以上变色，和输入框上方的提示同一个阈值；输入框窄时只留环
function ContextRing({ used, window, onOpen }: { used: number; window: number; onOpen(): void }) {
  const pct = window ? Math.min(100, (used / window) * 100) : 0
  const near = pct >= 80
  const circle = 2 * Math.PI * 6
  const label = window
    ? t('composer.context', { used: formatTokens(used), window: formatTokens(window) })
    : t('session.viewContext')
  return (
    <button
      type="button"
      data-testid="context-ring"
      aria-label={label}
      title={label}
      onClick={onOpen}
      className={cx(chip, 'tabular-nums', near && 'text-warn hover:text-warn')}
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" className="-rotate-90">
        <circle cx="8" cy="8" r="6" fill="none" strokeWidth="2.4" className="stroke-line" />
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * circle} ${circle}`}
          className={near ? 'stroke-warn' : 'stroke-fg-muted'}
        />
      </svg>
      {window ? <span className="@max-[420px]:hidden">{Math.round(pct)}%</span> : null}
    </button>
  )
}

// 附件上的图片缩略图。CSP 不放行 blob:，读成 data URL
function ImageThumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    const reader = new FileReader()
    reader.onload = () => setUrl(reader.result as string)
    reader.readAsDataURL(file)
    return () => reader.abort()
  }, [file])
  return url ? (
    <img src={url} alt="" className="h-5 w-5 shrink-0 rounded-[4px] object-cover" />
  ) : (
    <span className="h-5 w-5 shrink-0 rounded-[4px] bg-active" />
  )
}

export interface ComposerHandle {
  // 排队的消息退回来：接在已有的草稿后面，不覆盖
  restore(draft: QueuedDraft): void
}

export function Composer({
  big = false,
  placeholder,
  disabled = false,
  // 会话页：目录、Agent、内核跟着会话走，不显示也不能改；权限和模型能改，走 onPermission、onModel
  locked = false,
  lockedAs,
  onPermission,
  onModel,
  context,
  onSubmit,
  onStop,
  onInterject,
  ref,
}: {
  lockedAs?: {
    workdir: string
    agent: string
    model: string
    permissionMode: PermissionMode
  }
  onPermission?: (mode: PermissionMode) => Promise<void> | void
  onModel?: (model: string) => Promise<void> | void
  // 会话页的上下文用量环，上下文只从这里打开；window 不知道时是 0
  context?: { used: number; window: number; onOpen(): void }
  big?: boolean
  placeholder: string
  disabled?: boolean
  locked?: boolean
  onSubmit(input: ComposerSubmit): Promise<void> | void
  // Agent 在跑时传：输入框是空的，发送键就是停止键；有内容时还是发送（这一轮结束后送出）
  onStop?: () => void
  // 内核支持插话时传：⌘↵ 有内容就插话这一条，没内容就把排队的全部插话
  onInterject?: (input: ComposerSubmit) => Promise<void> | void
  ref?: Ref<ComposerHandle>
}) {
  const navigate = useNavigate()
  const settings = useSettings()
  const prefs = usePrefs()
  // 项目 Agent 随工作目录变：按当前目录列
  const agentDir = locked ? lockedAs?.workdir : (prefs.workdir ?? settings.data?.workdirs[0]?.path)
  const agents = useQuery({
    queryKey: ['agents', agentDir ?? ''],
    queryFn: () => kits.agents.list(agentDir ? { workdir: agentDir } : {}),
  })
  // 换了目录、选过的项目 Agent 在新目录里没有：退回 assistant
  const agentName =
    agents.data && !agents.data.some((a) => a.name === prefs.agent) ? 'assistant' : prefs.agent
  const agentModel = agents.data?.find((a) => a.name === agentName)?.model
  const resolved = { ...resolvePrefs(prefs, settings.data, agentModel), agent: agentName }
  const [text, setText] = useState('')
  // 首页建议、⌘K 的“新会话：…”：填进首页的输入框，光标放到末尾
  const homeDraft = useUi((s) => s.homeDraft)
  useEffect(() => {
    if (!big || !homeDraft) return
    setText(homeDraft.text)
    // 填一次就清掉：下次回到首页不再填
    useUi.setState({ homeDraft: undefined })
    requestAnimationFrame(() => {
      const el = area.current
      if (!el) return
      el.focus()
      el.setSelectionRange(homeDraft.text.length, homeDraft.text.length)
    })
  }, [big, homeDraft])
  const [sending, setSending] = useState(false)
  // 发送失败的原因（比如工作目录被删了）；草稿留着，改了再发
  const [error, setError] = useState<string>()
  const area = useRef<HTMLTextAreaElement>(null)
  // 进首页就能打字：点“新会话”、⌘N、工作区的 +，已经在首页时再点一次也算
  const { key: locationKey } = useLocation()
  // biome-ignore lint/correctness/useExhaustiveDependencies: 每次导航聚焦一次
  useEffect(() => {
    if (big) area.current?.focus()
  }, [big, locationKey])
  const box = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const inputId = big ? 'composer-home' : 'composer-session'
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  // @ 菜单：光标前面的 @ 查询，选中的那一项，按了 Esc 的那个 @ 不再弹
  const [at, setAt] = useState<AtQuery>()
  const [atIndex, setAtIndex] = useState(0)
  const [atDismissed, setAtDismissed] = useState<number>()
  const workdir = locked ? lockedAs?.workdir : resolved.workdir
  // 设置里启用的 MCP 服务，+ 菜单里可以这次关掉
  const mcp = useQuery({
    queryKey: ['mcp', 'overview'],
    queryFn: () => kits.mcp.overview(),
    enabled: !locked,
  })
  const platforms = (mcp.data?.servers ?? []).filter((s) => s.enabled)
  const atOpen = !!at && at.start !== atDismissed
  const matches = useQuery({
    queryKey: ['files', workdir, at?.query ?? ''],
    queryFn: () => kits.files.search({ workdir: workdir ?? '', query: at?.query ?? '' }),
    enabled: atOpen && !!workdir,
    placeholderData: (prev) => prev,
  })
  const found = atOpen ? (matches.data ?? []) : []
  // / 菜单：输入框开头打 /，列出这个工作目录下启用的技能
  const [slash, setSlash] = useState<string>()
  const [slashDismissed, setSlashDismissed] = useState(false)
  const slashOpen = slash !== undefined && !slashDismissed
  const skills = useQuery({
    queryKey: ['skills', workdir ?? ''],
    queryFn: () => kits.skills.list(workdir ? { workdir } : {}),
    enabled: slashOpen,
  })
  const skillItems = slashOpen
    ? (skills.data?.skills ?? []).filter(
        (s) => s.enabled && (s.name.includes(slash.toLowerCase()) || s.description.includes(slash)),
      )
    : []

  const addFiles = (list: FileList | File[]) => {
    const next = [...list]
    const tooBig = (f: File) => f.size > (isImageFile(f) ? MAX_IMAGE_BYTES : MAX_BYTES)
    const big = next.find(tooBig)
    if (big) {
      setError(t(isImageFile(big) ? 'composer.imageTooBig' : 'composer.tooBig', { name: big.name }))
    }
    setFiles((cur) => [...cur, ...next.filter((f) => !tooBig(f))])
  }
  const updateAt = (value: string, caret: number) => {
    const q = atQuery(value, caret)
    setAt(q)
    setAtIndex(0)
    if (!q) setAtDismissed(undefined)
    const s = /^\/([\w-]*)$/.exec(value.slice(0, caret))
    setSlash(s ? (s[1] ?? '') : undefined)
    if (!s) setSlashDismissed(false)
  }
  const pickSkill = (name: string) => {
    const el = area.current
    if (!el) return
    const rest = text.slice(el.selectionStart).replace(/^ /, '')
    const value = `/${name} ${rest}`
    setText(value)
    setSlash(undefined)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(name.length + 2, name.length + 2)
    })
  }
  const pick = (path: string) => {
    const el = area.current
    if (!el || !at) return
    const next = insertAt(text, at, el.selectionStart, path)
    setText(next.text)
    setAt(undefined)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(next.caret, next.caret)
    })
  }
  // + 菜单的“引用文件”：在光标处插一个 @，弹出文件菜单
  const startReference = () => {
    const el = area.current
    if (!el) return
    const caret = el.selectionStart ?? text.length
    const pad = caret > 0 && !/\s/.test(text[caret - 1] ?? '') ? ' ' : ''
    const value = `${text.slice(0, caret)}${pad}@${text.slice(caret)}`
    setText(value)
    const pos = caret + pad.length + 1
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(pos, pos)
      updateAt(value, pos)
    })
  }

  // 自动长高，最多 220px
  // biome-ignore lint/correctness/useExhaustiveDependencies: 文本变了才需要重算高度
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [text])

  // / 和 @ 菜单：按输入框上下还有多少地方决定往哪边开；窗口变了、输入框长高了都要重算
  const [place, setPlace] = useState<MenuPlacement>({ side: 'up', maxHeight: MENU_MAX_HEIGHT })
  const menuOpen = slashOpen || atOpen
  // biome-ignore lint/correctness/useExhaustiveDependencies: 文本变了输入框的位置可能跟着变
  useLayoutEffect(() => {
    if (!menuOpen) return
    const measure = () => {
      const rect = box.current?.getBoundingClientRect()
      if (!rect) return
      setPlace(
        placeMenu(rect.top - MENU_GAP - MENU_TOP_INSET, innerHeight - rect.bottom - MENU_GAP * 2),
      )
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [menuOpen, text])
  const menuClass = cx(
    'absolute right-3 left-3 z-40 flex flex-col overflow-hidden rounded-[12px] border border-line bg-raised p-1.5 shadow-pop',
    place.side === 'up' ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]',
  )

  const missing = locked
    ? undefined
    : !resolved.workdir
      ? 'workdir'
      : !resolved.model
        ? 'model'
        : undefined
  const gatewayList = settings.data?.gateways ?? []
  const model = lockedAs?.model ?? resolved.model
  // 附件里有图片、模型又看不了：发了也是白发，先挡住
  const blockedImages =
    files.some(isImageFile) && !!settings.data && !supportsImages(gatewayList, model ?? '')
  const imageModel = blockedImages ? firstImageModel(gatewayList) : undefined
  const canSend = !!text.trim() && !missing && !disabled && !sending && !blockedImages
  // 运行中发的消息排到这一轮结束
  const sendLabel = t(onStop ? 'composer.queue' : 'composer.send')

  useImperativeHandle(ref, () => ({
    restore({ text: restored, attachments }) {
      setText((cur) => (cur.trim() ? `${cur.trimEnd()}\n\n${restored}` : restored))
      setFiles((cur) => [
        ...cur,
        ...attachments.map((a) => new File([new Uint8Array(a.data)], a.name, { type: a.mime })),
      ])
      area.current?.focus()
    },
  }))

  const submit = async (send: typeof onSubmit = onSubmit) => {
    if (!canSend) return
    setSending(true)
    setError(undefined)
    try {
      // 等待期间又加的附件不在这次发送里，发完只去掉这次发出去的
      const sending = files
      const broken = await brokenImage(sending)
      if (broken) {
        setError(t('composer.badImage', { name: broken.name }))
        return
      }
      const attachments = await Promise.all(
        sending.map(async (f) => ({
          name: f.name,
          mime: f.type,
          data: new Uint8Array(await f.arrayBuffer()),
        })),
      )
      const sent = text.trim()
      await send({
        ...resolved,
        workdir: resolved.workdir ?? '',
        text: sent,
        attachments,
      })
      setText((cur) => draftAfterSend(cur, sent))
      setFiles((cur) => cur.filter((f) => !sending.includes(f)))
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && !e.nativeEvent.isComposing) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = Math.max(skillItems.length, 1)
        setAtIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
        return
      }
      // 技能列表还没回来：回车 / Tab 先别把一个光秃秃的 / 发出去
      if ((e.key === 'Enter' || e.key === 'Tab') && !skills.isFetched) {
        e.preventDefault()
        return
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && skillItems[atIndex]) {
        e.preventDefault()
        pickSkill(skillItems[atIndex].name)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlashDismissed(true)
        return
      }
    }
    if (atOpen && !e.nativeEvent.isComposing) {
      // 这次查询的结果还没回来：回车 / Tab 先别发送，也别选到上一次查询的结果
      if (
        (e.key === 'Enter' || e.key === 'Tab') &&
        (matches.isFetching || matches.isPlaceholderData)
      ) {
        e.preventDefault()
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = Math.max(found.length, 1)
        setAtIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
        return
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && found[atIndex]) {
        e.preventDefault()
        pick(found[atIndex] as string)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setAtDismissed(at?.start)
        return
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onInterject) {
      e.preventDefault()
      if (text.trim()) void submit(onInterject)
      else
        void onInterject({
          ...resolved,
          workdir: resolved.workdir ?? '',
          text: '',
          attachments: [],
        })
    } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  const pickDir = async () => {
    const dir = await kits.workdir.pick()
    if (dir) prefs.set({ workdir: dir })
  }

  // 侧栏改过名字的工作区这里也用改过的
  const workdirName = (dir: string) =>
    settings.data?.workdirs.find((w) => w.path === dir)?.label ?? basename(dir)
  const gateways = gatewayList.filter((g) => g.enabled && g.models.length > 0)
  const shortName = (ref: string) => ref.slice(ref.indexOf('/') + 1)
  const modelLabel = model ? shortName(model) : t('composer.noModel')
  const permission = lockedAs?.permissionMode ?? resolved.permissionMode
  const change = (task: Promise<void> | void) => {
    void Promise.resolve(task).catch((e) => setError(errorText(e)))
  }
  const pickModel = (ref: string) => {
    if (locked) change(onModel?.(ref))
    else prefs.set({ model: ref })
  }
  const permissionMenu = (
    <Menu>
      <MenuTrigger className={chip} title={t('composer.permission')}>
        <Shield size={13} />
        <span>{t(`perm.${permission}`)}</span>
        {locked ? <ChevronDown size={12} className="@max-[420px]:hidden" /> : null}
      </MenuTrigger>
      <MenuContent align={locked ? 'start' : 'end'} className="max-w-none!">
        <MenuLabel>{t(locked ? 'composer.permissionNow' : 'composer.permissionTitle')}</MenuLabel>
        <MenuRadioGroup
          value={permission}
          onValueChange={(v) => {
            const mode = v as PermissionMode
            if (locked) change(onPermission?.(mode))
            else prefs.set({ permissionMode: mode })
          }}
        >
          {[...PERMS, ...(permission === 'ask' ? (['ask'] as const) : [])].map((p) => (
            <MenuRadioItem key={p} value={p}>
              <span className="block">{t(`perm.${p}`)}</span>
              <small className="block whitespace-nowrap text-[0.929rem] text-fg-muted">
                {t(`perm.${p}.note`)}
              </small>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 拖文件进来的落点，键盘用户走 + 菜单
    <div
      ref={box}
      data-testid="composer"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setDragging(false)
        addFiles(e.dataTransfer.files)
      }}
      className={cx(
        '@container relative border border-line bg-raised shadow-[0_1px_2px_rgba(0,0,0,.03),0_6px_20px_rgba(0,0,0,.05)] transition-[border-color,box-shadow] focus-within:border-line-strong focus-within:shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_28px_rgba(0,0,0,.08)]',
        'rounded-[20px]',
        dragging && 'border-accent',
      )}
    >
      {dragging ? (
        <div className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-[12px] border-2 border-accent/40 border-dashed bg-accent-bg/80 font-medium text-accent-fg">
          {t('composer.drop')}
        </div>
      ) : null}
      {slashOpen ? (
        <div
          id={`${inputId}-slash`}
          role="listbox"
          aria-label={t('composer.skillsTitle')}
          data-testid="slash-menu"
          className={menuClass}
          style={{ maxHeight: place.maxHeight }}
        >
          <div className="shrink-0 px-2.5 pt-1.5 pb-1 font-medium text-[0.857rem] text-fg-label">
            {t('composer.skillsTitle')}
          </div>
          {skills.isFetched && skillItems.length === 0 ? (
            <div className="px-2.5 py-2 text-fg-muted">{t('composer.skillsEmpty')}</div>
          ) : null}
          {/* 名字一列按最长的算，太长就截断，不折行 */}
          <div className="grid min-h-0 flex-auto grid-cols-[fit-content(45%)_minmax(0,1fr)] content-start gap-y-px overflow-y-auto">
            {skillItems.map((s, i) => (
              <button
                key={s.name}
                id={`${inputId}-slash-${i}`}
                type="button"
                role="option"
                aria-selected={i === atIndex}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickSkill(s.name)}
                onPointerMove={() => setAtIndex(i)}
                ref={i === atIndex ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                className={cx(
                  'col-span-full grid min-h-[38px] cursor-pointer grid-cols-subgrid items-center gap-x-3 rounded-[8px] px-2.5 py-1 text-left',
                  i === atIndex && 'bg-accent-bg',
                )}
              >
                <span
                  className="truncate font-medium font-mono text-[0.929rem]"
                  title={`/${s.name}`}
                >
                  /{s.name}
                </span>
                <span className="truncate text-fg-muted">{s.description}</span>
              </button>
            ))}
          </div>
          <div className="mt-1 flex shrink-0 items-center gap-3 border-line-soft border-t px-2.5 pt-2 pb-1 text-[0.857rem] text-fg-label">
            <span>{t('composer.atHint.pick')}</span>
            <span>{t('composer.slashHint')}</span>
            <span>{t('composer.atHint.close')}</span>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => navigate('/settings/skills')}
              className="ml-auto cursor-pointer text-accent"
            >
              {t('composer.skillsManage')}
            </button>
          </div>
        </div>
      ) : null}
      {atOpen ? (
        <div
          id={`${inputId}-at`}
          role="listbox"
          aria-label={t('composer.atTitle')}
          data-testid="at-menu"
          className={menuClass}
          style={{ maxHeight: place.maxHeight }}
        >
          <div className="shrink-0 px-2.5 pt-1.5 pb-1 font-medium text-[0.857rem] text-fg-label">
            {t('composer.atTitle')}
          </div>
          {!workdir ? (
            <div className="px-2.5 py-2 text-fg-muted">{t('composer.atNoDir')}</div>
          ) : found.length === 0 && matches.isFetched ? (
            <div className="px-2.5 py-2 text-fg-muted">{t('composer.atEmpty')}</div>
          ) : null}
          <div className="flex min-h-0 flex-auto flex-col gap-px overflow-y-auto">
            {found.map((f, i) => (
              <button
                key={f}
                id={`${inputId}-at-${i}`}
                type="button"
                role="option"
                aria-selected={i === atIndex}
                // 不抢输入框的焦点
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(f)}
                onPointerMove={() => setAtIndex(i)}
                ref={i === atIndex ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                className={cx(
                  'flex min-h-[34px] w-full shrink-0 cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-1 text-left',
                  i === atIndex && 'bg-accent-bg',
                )}
              >
                <FileText size={13} className="shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1 truncate font-mono text-[0.929rem]">{f}</span>
              </button>
            ))}
          </div>
          <div className="mt-1 flex shrink-0 items-center gap-3 border-line-soft border-t px-2.5 pt-2 pb-1 text-[0.857rem] text-fg-label">
            <span>{t('composer.atHint.pick')}</span>
            <span>{t('composer.atHint.insert')}</span>
            <span>{t('composer.atHint.close')}</span>
          </div>
        </div>
      ) : null}
      {files.length ? (
        <div
          className={cx('flex flex-wrap gap-1.5', big ? 'px-[18px] pt-3.5' : 'px-3 pt-2.5')}
          data-testid="attachments"
        >
          {files.map((f, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: 同名文件可以加两次，按位置
              key={`${f.name}:${i}`}
              className={cx(
                'inline-flex h-7 max-w-[260px] items-center gap-1.5 rounded-[8px] border border-line bg-bg pr-1 text-[0.929rem]',
                isImageFile(f) ? 'pl-1' : 'pl-2',
              )}
            >
              {isImageFile(f) ? (
                <ImageThumb file={f} />
              ) : (
                <Paperclip size={12} className="shrink-0 text-fg-muted" />
              )}
              <span className="min-w-0 truncate" title={f.name}>
                {f.name}
              </span>
              <span className="shrink-0 text-fg-subtle">{formatSize(f.size)}</span>
              <button
                type="button"
                aria-label={t('composer.removeFile', { name: f.name })}
                onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-fg-subtle hover:bg-active hover:text-fg"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {blockedImages ? (
        <div
          role="status"
          data-testid="image-warning"
          className={cx(
            'mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[8px] bg-warn-bg px-2.5 py-1.5 text-[0.929rem] text-warn',
            big ? 'mx-[18px]' : 'mx-3',
          )}
        >
          <span>
            {imageModel ? t('composer.noVision', { model: modelLabel }) : t('composer.noVisionAny')}
          </span>
          {imageModel ? (
            <button
              type="button"
              onClick={() => pickModel(imageModel)}
              className="cursor-pointer text-accent"
            >
              {t('composer.switchModel', { model: shortName(imageModel) })}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/settings/model')}
              className="cursor-pointer text-accent"
            >
              {t('composer.openModelSettings')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setFiles((cur) => cur.filter((f) => !isImageFile(f)))}
            className="cursor-pointer text-accent"
          >
            {t('composer.dropImages')}
          </button>
        </div>
      ) : null}
      <input
        ref={picker}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <label htmlFor={big ? 'composer-home' : 'composer-session'} className="sr-only">
        {t('composer.label')}
      </label>
      <textarea
        ref={area}
        id={big ? 'composer-home' : 'composer-session'}
        rows={big ? 3 : 1}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          updateAt(e.target.value, e.target.selectionStart)
        }}
        onSelect={(e) => updateAt(e.currentTarget.value, e.currentTarget.selectionStart)}
        onBlur={() => {
          setAt(undefined)
          setSlash(undefined)
        }}
        // @ 菜单打开时焦点还在输入框里：用组合框的写法告诉读屏当前选中的是哪个文件
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={atOpen || slashOpen}
        aria-controls={atOpen ? `${inputId}-at` : slashOpen ? `${inputId}-slash` : undefined}
        aria-activedescendant={
          atOpen && found[atIndex]
            ? `${inputId}-at-${atIndex}`
            : slashOpen && skillItems[atIndex]
              ? `${inputId}-slash-${atIndex}`
              : undefined
        }
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          const images = pastedImages(e.clipboardData)
          if (!images.length) return
          e.preventDefault()
          addFiles(images)
        }}
        placeholder={placeholder}
        className={cx(
          'block max-h-[220px] w-full resize-none border-0 bg-transparent text-[1rem] text-fg leading-[1.571] outline-none placeholder:text-fg-subtle',
          big ? 'px-[18px] pt-4 pb-2' : 'px-4 pt-3.5 pb-1',
        )}
      />
      {error ? (
        <p
          role="alert"
          className={cx('m-0 text-[0.929rem] text-danger', big ? 'px-[18px]' : 'px-3.5')}
        >
          {error}
        </p>
      ) : null}
      <div
        className={cx(
          'flex items-center gap-0.5',
          !locked && 'flex-wrap',
          big ? 'px-2.5 pt-1.5 pb-2.5' : 'px-2.5 pt-1 pb-2.5',
        )}
      >
        <Menu>
          <MenuTrigger
            aria-label={t('composer.add')}
            title={t('composer.add')}
            className={cx(chip, 'w-7 justify-center px-0')}
          >
            <Plus size={15} strokeWidth={1.6} />
          </MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => picker.current?.click()}>
              <Paperclip size={14} className="text-fg-muted" />
              <span className="flex-1">{t('composer.upload')}</span>
              <small className="text-[0.857rem] text-fg-label">{t('composer.uploadNote')}</small>
            </MenuItem>
            <MenuItem onSelect={() => setTimeout(startReference, 0)}>
              <AtSign size={14} className="text-fg-muted" />
              <span className="flex-1">{t('composer.reference')}</span>
              <small className="text-[0.857rem] text-fg-label">@</small>
            </MenuItem>
            {/* 会话开始后权限已经定了，只有新会话能选这次用哪些平台 */}
            {!locked && platforms.length ? (
              <>
                <MenuSeparator />
                <MenuLabel>{t('composer.platforms')}</MenuLabel>
                {platforms.map((p) => (
                  <MenuSwitchItem
                    key={p.name}
                    checked={!prefs.mcpOff.includes(p.name)}
                    onCheckedChange={(on) =>
                      prefs.set({
                        mcpOff: on
                          ? prefs.mcpOff.filter((n) => n !== p.name)
                          : [...prefs.mcpOff, p.name],
                      })
                    }
                  >
                    <span className="font-mono text-[0.929rem]">{p.name}</span>
                  </MenuSwitchItem>
                ))}
                <MenuItem onSelect={() => navigate('/settings/mcp')}>
                  <SlidersHorizontal size={14} className="text-fg-muted" />
                  <span className="text-fg-muted">{t('composer.manageMcp')}</span>
                </MenuItem>
              </>
            ) : null}
          </MenuContent>
        </Menu>
        {locked ? (
          permissionMenu
        ) : (
          <>
            <Menu>
              <MenuTrigger
                className={cx(chip, missing === 'workdir' && 'text-accent')}
                title={t('composer.workdir')}
              >
                {resolved.workdir ? <Folder size={13} /> : <FolderOpen size={13} />}
                <span className="font-mono text-[0.929rem]">
                  {resolved.workdir ? workdirName(resolved.workdir) : t('composer.pickWorkdir')}
                </span>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>{t('composer.workdir')}</MenuLabel>
                <MenuRadioGroup
                  value={resolved.workdir ?? ''}
                  onValueChange={(v) => prefs.set({ workdir: v })}
                >
                  {(settings.data?.workdirs ?? []).map((w) => (
                    <MenuRadioItem key={w.path} value={w.path}>
                      <span className="block font-mono text-[0.929rem]">{workdirName(w.path)}</span>
                      <small className="block truncate text-[0.929rem] text-fg-muted">
                        {w.path}
                      </small>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
                {settings.data?.workdirs.length ? <MenuSeparator /> : null}
                <MenuItem onSelect={() => void pickDir()}>
                  <FolderOpen size={14} className="text-fg-muted" />
                  {t('composer.openDir')}
                </MenuItem>
              </MenuContent>
            </Menu>
            <Menu>
              <MenuTrigger className={chip} title="Agent">
                <Bot size={13} />
                <span>{resolved.agent}</span>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Agent</MenuLabel>
                <MenuRadioGroup
                  value={resolved.agent}
                  onValueChange={(v) => prefs.set({ agent: v })}
                >
                  {(
                    agents.data ?? [
                      { name: 'assistant', description: '', source: 'builtin' as const },
                    ]
                  ).map((a) => (
                    <MenuRadioItem key={a.name} value={a.name}>
                      <span className="block font-mono text-[0.929rem]">{a.name}</span>
                      <small className="block text-[0.929rem] text-fg-muted">
                        {[a.description, t(`source.${a.source}`)].filter(Boolean).join(' · ')}
                      </small>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
                <MenuSeparator />
                <MenuItem onSelect={() => navigate('/settings/agent')}>
                  <SlidersHorizontal size={14} className="text-fg-muted" />
                  {t('composer.manageAgents')}
                </MenuItem>
              </MenuContent>
            </Menu>
          </>
        )}
        <span className="flex-1" />
        {locked ? null : permissionMenu}
        {context ? <ContextRing {...context} /> : null}
        <Menu>
          <MenuTrigger
            className={cx(chip, 'min-w-0 shrink!', missing === 'model' && 'text-accent')}
            title={locked ? t('composer.modelNext') : t('composer.model')}
          >
            <span className="min-w-0 truncate font-mono text-[0.929rem]">{modelLabel}</span>
            <ChevronDown size={12} className="shrink-0" />
          </MenuTrigger>
          <MenuContent align="end">
            {locked ? (
              <MenuLabel>{t('composer.modelNext')}</MenuLabel>
            ) : (
              <MenuSegmented
                label={t('composer.kernel')}
                value={resolved.kernel}
                onChange={(v) => prefs.set({ kernel: v })}
                options={[
                  { value: 'opencode', label: 'OpenCode' },
                  { value: 'codeagent', label: 'CodeAgent' },
                ]}
              />
            )}
            {gateways.length === 0 ? (
              <p className="m-0 px-2 py-2 text-fg-muted">{t('composer.noGateway')}</p>
            ) : null}
            {gateways.map((g) => (
              <MenuRadioGroup key={g.id} value={model} onValueChange={pickModel}>
                <MenuLabel>{g.name || g.id}</MenuLabel>
                {g.models.map((m) => (
                  <MenuRadioItem key={m.id} value={`${g.id}/${m.id}`}>
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-[0.929rem]">{m.id}</span>
                      {m.vision ? (
                        <ImageIcon
                          size={12}
                          className="shrink-0 text-fg-subtle"
                          role="img"
                          aria-label={t('composer.visionTag')}
                        />
                      ) : null}
                    </span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            ))}
            <MenuSeparator />
            <MenuItem onSelect={() => navigate('/settings/model')}>
              <SlidersHorizontal size={14} className="text-fg-muted" />
              {t('composer.modelSettings')}
            </MenuItem>
          </MenuContent>
        </Menu>
        {onStop && !text.trim() && files.length === 0 ? (
          <button
            type="button"
            aria-label={t('session.stop')}
            title={`${t('session.stop')} ${shortcuts.stop.label}`}
            onClick={onStop}
            className={sendButton}
          >
            <Square size={11} fill="currentColor" strokeWidth={0} />
          </button>
        ) : (
          <button
            type="button"
            aria-label={sendLabel}
            title={
              missing
                ? t(`composer.missing.${missing}`)
                : blockedImages
                  ? t('composer.noVision', { model: modelLabel })
                  : `${sendLabel} ↵`
            }
            disabled={!canSend}
            onClick={() => void submit()}
            className={sendButton}
          >
            <ArrowUp size={14} strokeWidth={2.2} />
          </button>
        )}
      </div>
    </div>
  )
}
