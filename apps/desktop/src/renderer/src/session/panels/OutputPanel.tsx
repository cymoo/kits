import type { OutputView } from '@kits/core/ipc'
import { ChevronDown, FileText } from 'lucide-react'
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { t } from '../../app/i18n'
import { kits } from '../../lib/kits'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../ui/Menu'
import { countEdits } from './edits'

// 产出页签（原型 session.html 的 isOutput）：没有输出格式的 Agent 是回复正文，可以直接改、自动保存、导出 Markdown；
// 有输出格式的是 submit_output 交上来的 JSON，这一版只能看和导出（逐条审核在后续）。
// AI 原稿和人工修改分开存，导出的是改过的版本。

const SAVE_DELAY = 600

export function OutputPanel({
  outputs,
  running,
  agent,
}: {
  outputs: OutputView[]
  running: boolean
  agent: string
}) {
  const latest = outputs.at(-1)
  const [picked, setPicked] = useState<string>()
  const current = outputs.find((o) => o.id === picked) ?? latest
  const [notice, setNotice] = useState<{ path: string } | { copied: true } | { error: string }>()
  const editor = useRef<EditorHandle>(null)

  if (!current) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-fg-muted">
        <FileText size={22} strokeWidth={1.3} className="text-fg-subtle" />
        <span className="font-medium text-fg">
          {running ? t('output.running') : t('output.empty')}
        </span>
        <span className="max-w-[240px] text-[0.929rem]">
          {running ? t('output.runningNote', { agent }) : t('output.emptyNote')}
        </span>
      </div>
    )
  }

  const content = current.edited ?? current.aiDraft
  // 导出前先把编辑框里还没存的改动存掉，导出的是最新内容
  const exportAs = async (format: 'markdown' | 'json') => {
    try {
      await editor.current?.flush()
      const { path } = await kits.output.export({ id: current.id, format })
      setNotice({ path })
    } catch (e) {
      setNotice({ error: e instanceof Error ? e.message : String(e) })
    }
  }
  const copy = async () => {
    // 回复正文复制编辑框里的最新内容；结构化结果一律按 JSON 复制（结果本身是字符串也要带引号）
    await navigator.clipboard.writeText(
      current.kind === 'text'
        ? (editor.current?.value() ?? current.edited ?? current.aiDraft)
        : JSON.stringify(content, null, 2),
    )
    setNotice({ copied: true })
  }
  // 还原：先撤掉还没发出去的自动保存、等在路上的保存落地，再存 null，旧保存不会把改动写回来
  const revert = async () => {
    await editor.current?.discard()
    await kits.output.save({ id: current.id, edited: null })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="output">
      <div className="flex shrink-0 items-center gap-1.5 border-line-soft border-b px-2.5 py-2">
        <span className="min-w-0 flex-1 truncate text-[0.929rem] text-fg-muted">
          {current.kind === 'text' ? t('output.text') : t('output.structured')}
          {current.edited !== null ? ` · ${t('output.edited')}` : ''}
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
                  <MenuItem key={o.id} onSelect={() => setPicked(o.id)}>
                    {t('output.nth', { n: i + 1 })}
                  </MenuItem>
                ))
                .reverse()}
            </MenuContent>
          </Menu>
        ) : null}
        {current.kind === 'text' && current.edited !== null ? (
          <Button className="h-[26px] px-2 text-[0.929rem]" onClick={() => void revert()}>
            {t('output.revert')}
          </Button>
        ) : null}
        <Menu>
          <MenuTrigger className="inline-flex h-[26px] cursor-pointer items-center gap-1 rounded-[8px] bg-primary px-2.5 font-medium text-[0.929rem] text-primary-fg hover:opacity-90">
            {t('output.export')}
            <ChevronDown size={11} />
          </MenuTrigger>
          <MenuContent align="end">
            {current.kind === 'text' ? (
              <MenuItem onSelect={() => void exportAs('markdown')}>
                {t('output.exportMarkdown')}
              </MenuItem>
            ) : (
              <MenuItem onSelect={() => void exportAs('json')}>{t('output.exportJson')}</MenuItem>
            )}
            <MenuItem onSelect={() => void copy()}>{t('output.copy')}</MenuItem>
          </MenuContent>
        </Menu>
      </div>
      {notice ? (
        <div
          role={'error' in notice ? 'alert' : 'status'}
          className={cx(
            'flex shrink-0 items-center gap-2 border-line-soft border-b px-3 py-1.5 text-[0.929rem]',
            'error' in notice ? 'bg-danger-bg/60 text-danger' : 'bg-ok-bg/50 text-ok',
          )}
        >
          {'error' in notice ? (
            <span className="min-w-0 flex-1">
              {t('output.exportFailed', { error: notice.error })}
            </span>
          ) : 'path' in notice ? (
            <>
              <span className="min-w-0 flex-1 truncate" title={notice.path}>
                {t('output.exported', { path: notice.path.split(/[\\/]/).pop() ?? '' })}
              </span>
              <Button variant="link" onClick={() => void kits.app.revealPath(notice.path)}>
                {t('output.reveal')}
              </Button>
            </>
          ) : (
            <span>{t('output.copied')}</span>
          )}
        </div>
      ) : null}
      {current.kind === 'text' ? (
        // 换了一份产出（另一轮、AI 交了新原稿）就重建编辑框
        <TextEditor
          key={`${current.id}:${current.aiDraft.length}`}
          output={current}
          handle={editor}
        />
      ) : (
        <>
          <pre className="m-0 min-h-0 flex-1 overflow-auto bg-raised px-4 py-3.5 font-mono text-[0.929rem] text-fg leading-[1.7]">
            {JSON.stringify(content, null, 2)}
          </pre>
          <div className="shrink-0 border-line-soft border-t px-3 py-2 text-[0.929rem] text-fg-label">
            {t('output.readOnly')}
          </div>
        </>
      )}
    </div>
  )
}

// 产出面板对编辑框的操作：导出前存掉、复制取最新、还原前丢掉还没存的
interface EditorHandle {
  flush(): Promise<void>
  discard(): Promise<void>
  value(): string
}

function TextEditor({
  output,
  handle,
}: {
  output: Extract<OutputView, { kind: 'text' }>
  handle: Ref<EditorHandle>
}) {
  const [text, setText] = useState(output.edited ?? output.aiDraft)
  const [saving, setSaving] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef(text)
  latest.current = text

  // 推回来的更新：自己还有没存的改动（定时器在等）或保存在路上时，都是自己的回执，不动编辑框，
  // 免得旧回执盖掉刚打的字；空闲时才跟着换（还原为原稿、AI 交了新原稿）
  const inflight = useRef(0)
  useEffect(() => {
    if (timer.current || inflight.current > 0) return
    const incoming = output.edited ?? output.aiDraft
    if (incoming !== latest.current) setText(incoming)
  }, [output.edited, output.aiDraft])

  // 保存一个接一个排队，先发的先落地。保存失败不吞掉：底部说没存上，导出前的 flush 也会失败，下一次输入再重试
  const [saveError, setSaveError] = useState<string>()
  const chain = useRef<Promise<void>>(Promise.resolve())
  const save = (value: string): Promise<void> => {
    inflight.current += 1
    setSaving(true)
    const run = chain.current
      .catch(() => {})
      .then(() => kits.output.save({ id: output.id, edited: value }))
      .then(() => undefined)
    chain.current = run
    run
      .then(
        () => setSaveError(undefined),
        (e) => setSaveError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => {
        inflight.current -= 1
        if (inflight.current === 0) setSaving(false)
      })
    return run
  }
  useImperativeHandle(handle, () => ({
    async flush() {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = undefined
        void save(latest.current)
      }
      // 最后一次保存失败就让导出也失败
      await chain.current
    },
    async discard() {
      if (timer.current) clearTimeout(timer.current)
      timer.current = undefined
      await chain.current.catch(() => {})
    },
    value: () => latest.current,
  }))
  // 离开时没存的先存，也排在保存链后面，不会被前面还没落地的旧保存盖掉
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在换产出、卸载时收尾
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = undefined
        void save(latest.current)
      }
    },
    [output.id],
  )

  const edits = countEdits(output.aiDraft, text)
  return (
    <>
      <label htmlFor={`output-${output.id}`} className="sr-only">
        {t('output.label')}
      </label>
      <textarea
        id={`output-${output.id}`}
        value={text}
        spellCheck={false}
        onChange={(e) => {
          const value = e.target.value
          setText(value)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => {
            timer.current = undefined
            void save(value)
          }, SAVE_DELAY)
        }}
        className="min-h-0 w-full flex-1 resize-none border-0 bg-raised px-4 py-3.5 font-mono text-[0.929rem] text-fg leading-[1.7] outline-none"
      />
      <div className="flex shrink-0 items-center gap-2 border-line-soft border-t px-3 py-2 text-[0.929rem] text-fg-label">
        <span className="min-w-0 flex-1 truncate">
          {edits === 0
            ? t('output.editHint')
            : edits === undefined
              ? t('output.editsUnknown')
              : t('output.edits', { n: edits })}
        </span>
        <span className={cx(saving && 'text-fg-muted', saveError && 'text-danger')}>
          {saveError ? t('output.saveFailed') : saving ? t('output.saving') : t('output.saved')}
        </span>
      </div>
    </>
  )
}
