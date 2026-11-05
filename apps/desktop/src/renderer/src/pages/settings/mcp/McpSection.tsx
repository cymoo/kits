import type { McpServerView, McpTestResult, PermissionLevel } from '@kits/core/ipc'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '../../../app/i18n'
import { kits } from '../../../lib/kits'
import { Button } from '../../../ui/Button'
import { cx } from '../../../ui/cx'
import { Segmented } from '../../../ui/Segmented'
import { Spinner } from '../../../ui/Spinner'
import { Switch } from '../../../ui/Switch'

// 设置 · MCP 服务（原型 settings.html#mcp）：粘贴识别添加、启停、凭据、测试连接列出工具、每个工具三档权限、移除；
// 下面是 kits 自带的工具说明。改了 mcp.json 主进程会让内核按新配置重启。

export const mcpKeys = { overview: ['mcp', 'overview'] as const }

export function useMcpOverview() {
  return useQuery({ queryKey: mcpKeys.overview, queryFn: () => kits.mcp.overview() })
}

function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

// 粘贴框 + 识别结果。onAdded 拿到加上的服务名（设置页接着逐个测试）
export function McpPaste({
  onAdded,
  onCancel,
  initial = '',
}: {
  onAdded(names: string[]): void
  onCancel?: () => void
  initial?: string
}) {
  const client = useQueryClient()
  const [text, setText] = useState(initial)
  const parsed = useQuery({
    queryKey: ['mcp', 'parse', text],
    queryFn: () => kits.mcp.parse(text),
    enabled: !!text.trim(),
    placeholderData: (prev) => prev,
  })
  const add = useMutation({
    mutationFn: () => kits.mcp.add(text),
    onSuccess: (names) => {
      void client.invalidateQueries({ queryKey: mcpKeys.overview })
      setText('')
      onAdded(names)
    },
  })
  const result = text.trim() ? parsed.data : undefined
  const vars = result?.ok ? [...new Set(result.servers.flatMap((s) => s.vars))] : []
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col">
        <span className="sr-only">{t('mcp.pasteLabel')}</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder={
            '{\n  "mcpServers": {\n    "case-platform": { "url": "https://cases.corp.example/mcp", "headers": { "Authorization": "Bearer ${CASE_TOKEN}" } }\n  }\n}'
          }
          className="resize-y rounded-[8px] border border-line bg-raised px-3 py-2.5 font-mono text-[0.929rem] text-fg leading-[1.6] outline-none placeholder:text-fg-subtle focus:border-accent"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2.5 text-[0.929rem]" role="status">
        {result?.ok ? (
          <>
            <Check size={14} strokeWidth={1.8} className="shrink-0 text-ok" />
            <span className="min-w-0 flex-1">
              {t('mcp.recognized', { n: result.servers.length })}
              {result.servers.map((s, i) => (
                <span key={s.name}>
                  {i ? '、' : ''}
                  <span className="font-mono">{s.name}</span>（
                  {s.type === 'http' ? 'HTTP' : 'stdio'}）{s.exists ? t('mcp.exists') : ''}
                </span>
              ))}
              {vars.length ? (
                <span className="text-fg-muted">
                  {' '}
                  {t('mcp.varsHint', { vars: vars.map((v) => `\${${v}}`).join('、') })}
                </span>
              ) : null}
            </span>
          </>
        ) : result && !result.ok ? (
          <span className="min-w-0 flex-1 text-danger">{result.error}</span>
        ) : (
          <span className="flex-1" />
        )}
        {add.error ? (
          <span role="alert" className="text-danger">
            {errorText(add.error)}
          </span>
        ) : null}
        {onCancel ? (
          <Button className="h-[30px]" onClick={onCancel}>
            {t('mcp.cancel')}
          </Button>
        ) : null}
        <Button
          variant="primary"
          disabled={!result?.ok || add.isPending}
          onClick={() => add.mutate()}
        >
          {add.isPending ? <Spinner /> : null}
          {t('mcp.addAndTest')}
        </Button>
      </div>
    </div>
  )
}

const LEVEL_TONE: Record<PermissionLevel, string> = {
  allow: 'data-[state=checked]:text-ok',
  ask: 'data-[state=checked]:text-warn-strong',
  deny: 'data-[state=checked]:text-danger',
}

function ServerCard({
  server,
  open,
  onToggle,
  test,
  onTest,
}: {
  server: McpServerView
  open: boolean
  onToggle(): void
  test: { pending: boolean; result?: McpTestResult }
  onTest(): void
}) {
  const client = useQueryClient()
  const refresh = () => void client.invalidateQueries({ queryKey: mcpKeys.overview })
  const [values, setValues] = useState<Record<string, string>>({})
  const failed = server.enabled && test.result && !test.result.ok
  const status = !server.enabled
    ? t('mcp.off')
    : failed
      ? t('mcp.failed')
      : server.tools.length
        ? t('mcp.toolCount', { n: server.tools.length })
        : t('mcp.untested')
  const saveVar = async (name: string) => {
    const value = values[name]?.trim()
    if (!value) return
    await kits.secrets.set({ key: `env:${name}`, value })
    setValues((v) => ({ ...v, [name]: '' }))
    refresh()
  }
  return (
    <section
      data-testid={`mcp-${server.name}`}
      className={cx(
        'flex flex-col overflow-hidden rounded-[16px] border bg-raised',
        failed ? 'border-danger-line' : 'border-line',
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
        >
          <ChevronRight
            size={14}
            className={cx('shrink-0 text-fg-subtle transition-transform', open && 'rotate-90')}
          />
          <span
            aria-hidden="true"
            className={cx(
              'h-2 w-2 shrink-0 rounded-full',
              !server.enabled ? 'bg-line-strong' : failed ? 'bg-danger' : 'bg-ok',
            )}
          />
          <span className="font-medium font-mono text-[1rem]">{server.name}</span>
          <span
            className={cx('text-[0.929rem]', failed ? 'font-medium text-danger' : 'text-fg-label')}
          >
            {status}
          </span>
        </button>
        <span className="text-[0.929rem] text-fg-label">
          {server.type === 'http' ? 'HTTP' : 'stdio'}
        </span>
        <Switch
          checked={server.enabled}
          label={t('mcp.enable', { name: server.name })}
          onCheckedChange={(enabled) =>
            void kits.mcp.setEnabled({ name: server.name, enabled }).then(refresh)
          }
        />
      </div>
      {open ? (
        <div className="flex flex-col gap-3.5 border-line-soft border-t px-4 pt-3 pb-4 pl-[42px]">
          <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[0.929rem]">
            <span className="text-fg-label">
              {server.type === 'http' ? t('mcp.address') : t('mcp.command')}
            </span>
            <span className="break-all font-mono">{server.address}</span>
            <span className="text-fg-label">{t('mcp.credentials')}</span>
            <span className="flex flex-col gap-1.5">
              {server.vars.length === 0 ? <span>{t('mcp.noCredentials')}</span> : null}
              {server.vars.map((v) => (
                <span key={v.name} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{`\${${v.name}}`}</span>
                  <span className={v.set ? 'text-ok' : 'text-warn'}>
                    {v.set ? t('mcp.varSet') : t('mcp.varMissing')}
                  </span>
                  <input
                    type="password"
                    aria-label={t('mcp.varPlaceholder', { name: v.name })}
                    placeholder={t('mcp.varPlaceholder', { name: v.name })}
                    value={values[v.name] ?? ''}
                    onChange={(e) => setValues((cur) => ({ ...cur, [v.name]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveVar(v.name)
                    }}
                    className="h-7 min-w-[200px] flex-1 rounded-[8px] border border-line bg-raised px-2 font-mono text-[0.929rem] outline-none focus:border-accent"
                  />
                  <Button
                    className="h-7"
                    disabled={!values[v.name]?.trim()}
                    onClick={() => void saveVar(v.name)}
                  >
                    {t('mcp.save')}
                  </Button>
                </span>
              ))}
            </span>
            {failed && test.result && !test.result.ok ? (
              <>
                <span className="text-fg-label">{t('mcp.lastError')}</span>
                <pre
                  role="alert"
                  className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-[8px] border border-danger-line bg-danger-soft px-2.5 py-2 font-mono text-[0.857rem] text-danger-strong leading-[1.6]"
                >
                  {test.result.error}
                </pre>
              </>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-[0.929rem] text-fg-label">
              <span className="flex-1">{t('mcp.tools')}</span>
              <span>{t('mcp.before')}</span>
            </div>
            {server.tools.length === 0 ? (
              <p className="m-0 text-[0.929rem] text-fg-muted">{t('mcp.noTools')}</p>
            ) : null}
            {server.tools.map((tool) => (
              <div
                key={tool.name}
                data-testid={`tool-${tool.name}`}
                className="flex min-h-9 items-center gap-2.5 rounded-[8px] border border-line-soft px-2.5 py-1"
              >
                <span className="basis-[180px] shrink-0 truncate font-mono text-[0.929rem]">
                  {tool.name}
                </span>
                <span className="min-w-0 flex-1 truncate text-[0.929rem] text-fg-muted">
                  {tool.description}
                </span>
                <Segmented
                  label={`${tool.name} 的权限`}
                  value={tool.level}
                  onChange={(level) =>
                    void kits.mcp
                      .setPermission({ server: server.name, tool: tool.name, level })
                      .then(refresh)
                  }
                  options={(['allow', 'ask', 'deny'] as const).map((level) => ({
                    value: level,
                    label: t(`mcp.${level}`),
                    className: LEVEL_TONE[level],
                  }))}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button disabled={test.pending} onClick={onTest}>
              {test.pending ? <Spinner /> : null}
              {test.pending ? t('mcp.testing') : t('mcp.test')}
            </Button>
            {test.result?.ok ? (
              <span role="status" className="text-[0.929rem] text-ok">
                {t('mcp.ok', { n: test.result.tools, ms: test.result.latencyMs })}
              </span>
            ) : null}
            <span className="flex-1" />
            <Button
              variant="ghost"
              className="text-danger hover:text-danger"
              onClick={() => void kits.mcp.remove(server.name).then(refresh)}
            >
              {t('mcp.remove')}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export function McpSection() {
  const client = useQueryClient()
  const overview = useMcpOverview()
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<string>()
  const [tests, setTests] = useState<Record<string, { pending: boolean; result?: McpTestResult }>>(
    {},
  )
  const runTest = async (name: string) => {
    setTests((cur) => ({ ...cur, [name]: { pending: true } }))
    const result = await kits.mcp.test(name)
    setTests((cur) => ({ ...cur, [name]: { pending: false, result } }))
    void client.invalidateQueries({ queryKey: mcpKeys.overview })
  }
  const servers = overview.data?.servers ?? []
  // 第一次进来展开第一个
  useEffect(() => {
    if (open === undefined && servers[0]) setOpen(servers[0].name)
  }, [open, servers])

  return (
    <div className="flex w-full max-w-[820px] flex-col gap-5">
      <div className="flex items-start gap-4">
        <div className="flex flex-1 flex-col gap-1">
          <h2 className="m-0 font-semibold text-[1.429rem] tracking-[-0.01em]">
            {t('settings.mcp')}
          </h2>
          <p className="m-0 text-fg-muted">{t('mcp.intro')}</p>
        </div>
        <Button
          variant="primary"
          className="h-8 px-3.5"
          aria-expanded={adding}
          onClick={() => setAdding(!adding)}
        >
          {t('mcp.add')}
        </Button>
      </div>
      {overview.data?.error ? (
        <p role="alert" className="m-0 rounded-[12px] bg-danger-bg px-3.5 py-2.5 text-danger">
          {overview.data.error}
        </p>
      ) : null}
      {adding ? (
        <section className="flex flex-col gap-3 rounded-[16px] border border-accent bg-raised p-[18px] shadow-[0_0_0_4px_rgba(54,89,227,.08)]">
          <div className="flex items-center gap-2.5">
            <b className="font-semibold">{t('mcp.addTitle')}</b>
            <small className="text-[0.929rem] text-fg-muted">{t('mcp.addHint')}</small>
          </div>
          <McpPaste
            onCancel={() => setAdding(false)}
            onAdded={(names) => {
              setAdding(false)
              setOpen(names[0])
              for (const n of names) void runTest(n)
            }}
          />
        </section>
      ) : null}
      <div className="flex flex-col gap-2.5">
        {overview.isSuccess && servers.length === 0 && !overview.data?.error ? (
          <p className="m-0 rounded-[16px] border border-line border-dashed px-4 py-6 text-center text-fg-muted">
            {t('mcp.empty')}
          </p>
        ) : null}
        {servers.map((s) => (
          <ServerCard
            key={s.name}
            server={s}
            open={open === s.name}
            onToggle={() => setOpen(open === s.name ? '' : s.name)}
            test={tests[s.name] ?? { pending: false }}
            onTest={() => void runTest(s.name)}
          />
        ))}
      </div>
      <section className="flex flex-col gap-2 rounded-[16px] border border-line bg-raised px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <b className="font-semibold">{t('mcp.builtin')}</b>
          <small className="text-[0.929rem] text-fg-muted">{t('mcp.builtinNote')}</small>
        </div>
        <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[0.929rem]">
          {(['ask_user', 'submit_output', 'remember'] as const).map((name) => (
            <span key={name} className="contents">
              <span className="font-mono">{name}</span>
              <span className="text-fg-muted">{t(`mcp.builtin.${name}`)}</span>
            </span>
          ))}
        </div>
      </section>
    </div>
  )
}
