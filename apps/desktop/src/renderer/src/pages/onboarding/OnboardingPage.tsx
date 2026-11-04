import type { GatewayTestResult, McpTestResult } from '@kits/core/ipc'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FolderOpen } from 'lucide-react'
import { RadioGroup } from 'radix-ui'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../../app/i18n'
import { useAppearance } from '../../app/use-appearance'
import { kits, queryKeys, useHomeLabel, useSettings, useUpdateSettings } from '../../lib/kits'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { Field, Input } from '../../ui/Input'
import { Spinner } from '../../ui/Spinner'
import { McpPaste, useMcpOverview } from '../settings/mcp/McpSection'
import { TestResult, useKeyHint } from '../settings/model/ModelSection'
import { useGateways } from '../settings/model/useGateways'

// 首次引导（原型 onboarding.html）：左侧三步导航，右侧当前步骤。
// 第一次启动、还没配网关时 Layout 会跳到这里；完成或跳过后记 onboardingDone，之后不再进来。

const STEPS = [
  { title: '模型网关', sub: '先配一个，能测通就行' },
  { title: '工作目录', sub: 'Agent 在哪个仓库里干活' },
  { title: 'MCP 服务', sub: '需求、用例平台，可以跳过' },
] as const

function GatewayStep({ onNext }: { onNext(): void }) {
  const { gateways, defaultModel, test, add, setDefault } = useGateways()
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [result, setResult] = useState<GatewayTestResult>()
  // 只认启用且有模型的网关；停用的、空的不算配好了，表单留着
  const added = gateways.find((g) => g.enabled && g.models.length > 0)
  const keyHint = useKeyHint()
  // 换了步骤或离开引导后，还在路上的测试回来也不再保存
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const run = async () => {
    const r = await test.mutateAsync({ baseUrl, ...(apiKey ? { apiKey } : {}) })
    if (!alive.current) return
    // 连上了但一个模型都没有：不保存，留着表单让人改地址再试
    if (r.ok && r.models.length === 0) {
      setResult({ ok: false, latencyMs: r.latencyMs, error: t('onboarding.noModels') })
      return
    }
    setResult(r)
    // 测通了就保存，默认模型先取列表第一个，下面可以改
    if (r.ok && !added) await add({ name: '', baseUrl, apiKey, models: r.models })
  }

  return (
    <div className="flex flex-col gap-[22px] px-8 pt-7 pb-2">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-semibold text-[1.385rem]">{t('onboarding.gatewayTitle')}</h2>
        <p className="m-0 text-fg-muted">{t('onboarding.gatewayIntro')}</p>
      </div>
      {added ? (
        <p className="m-0 font-mono text-[0.962rem]">{added.baseUrl}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('onboarding.gatewayUrl')}>
            <Input
              mono
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://…/v1"
              className="h-9"
            />
          </Field>
          <Field label="API Key" hint={keyHint}>
            <Input
              mono
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="h-9"
            />
          </Field>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {added ? null : (
          <Button
            onClick={() => void run()}
            disabled={!baseUrl || test.isPending}
            className="h-[34px] px-3.5 font-medium"
          >
            {test.isPending ? <Spinner /> : null}
            {t('onboarding.test')}
          </Button>
        )}
        {result ? (
          <TestResult result={result} />
        ) : added ? null : (
          <span className="text-fg-muted">{t('onboarding.testHint')}</span>
        )}
      </div>
      {added ? (
        <div className="flex flex-col gap-2.5 pb-2">
          <div className="flex items-baseline gap-2">
            <span className="font-medium">{t('model.defaultModel')}</span>
            <span className="text-[0.923rem] text-fg-muted">{t('onboarding.defaultHint')}</span>
          </div>
          <RadioGroup.Root
            value={defaultModel}
            onValueChange={(ref) => void setDefault(ref)}
            aria-label={t('model.defaultModel')}
            className="grid grid-cols-2 gap-2"
          >
            {added.models.map((m) => {
              const ref = `${added.id}/${m.id}`
              const on = ref === defaultModel
              return (
                <RadioGroup.Item
                  key={m.id}
                  value={ref}
                  className={cx(
                    'flex cursor-pointer items-center gap-2 rounded-[10px] border px-3.5 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    on ? 'border-accent bg-accent-bg/60' : 'border-line hover:border-line-strong',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-mono font-medium text-[0.962rem]">
                    {m.id}
                  </span>
                  {on ? <Check size={14} className="text-accent" /> : null}
                </RadioGroup.Item>
              )
            })}
          </RadioGroup.Root>
        </div>
      ) : null}
      <div className="flex items-center justify-end border-line-soft border-t py-4">
        <span className="flex-1 text-[0.923rem] text-fg-muted">
          {t('onboarding.stepOf', { n: 1 })}
        </span>
        <Button variant="primary" disabled={!added || !defaultModel} onClick={onNext}>
          {t('onboarding.next')}
        </Button>
      </div>
    </div>
  )
}

// 第 2 步：选一个代码仓库，看一眼里面有什么（AGENTS.md、项目技能、项目类型）
function WorkdirStep({ onBack, onNext }: { onBack(): void; onNext(): void }) {
  const settings = useSettings()
  const homeLabel = useHomeLabel()
  const client = useQueryClient()
  const dir = settings.data?.workdirs[0]?.path
  const inspection = useQuery({
    queryKey: ['workdir-inspect', dir ?? ''],
    queryFn: () => kits.workdir.inspect(dir ?? ''),
    enabled: !!dir,
  })
  const pick = async () => {
    const picked = await kits.workdir.pick()
    if (picked) await client.invalidateQueries({ queryKey: queryKeys.settings })
  }
  const git = inspection.data?.git
  return (
    <>
      <div className="flex flex-col gap-[22px] px-8 pt-7 pb-2" data-testid="onboarding-workdir">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 font-semibold text-[1.385rem]">{t('onboarding.workdirTitle')}</h2>
          <p className="m-0 text-fg-muted">{t('onboarding.workdirIntro')}</p>
        </div>
        {dir ? (
          <div className="flex flex-col gap-3 pb-2">
            <div className="flex items-center gap-3 rounded-[12px] border border-line px-4 py-3.5">
              <FolderOpen size={18} className="shrink-0 text-fg-muted" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium font-mono" title={dir}>
                  {homeLabel(dir)}
                </span>
                <span className="text-[0.923rem] text-fg-muted">
                  {inspection.isPending
                    ? '…'
                    : git
                      ? t(git.changed ? 'onboarding.gitDirty' : 'onboarding.gitClean', {
                          branch: git.branch,
                          n: git.changed,
                        })
                      : t('onboarding.notGit')}
                </span>
              </span>
              <Button onClick={() => void pick()}>{t('onboarding.changeDir')}</Button>
            </div>
            {inspection.data?.found.length ? (
              <div className="flex flex-col gap-2 rounded-[10px] bg-bg px-4 py-3">
                <span className="font-medium text-[0.923rem] text-fg-muted">
                  {t('onboarding.found')}
                </span>
                {inspection.data.found.map((f) => (
                  <div key={f.file} className="flex items-center gap-2">
                    <Check size={14} className="shrink-0 text-ok" />
                    <span>
                      <span className="font-mono text-[0.923rem]">{f.file}</span> · {f.note}
                    </span>
                  </div>
                ))}
              </div>
            ) : inspection.isSuccess ? (
              <p className="m-0 rounded-[10px] bg-bg px-4 py-3 text-[0.923rem] text-fg-muted">
                {t('onboarding.foundNothing')}
              </p>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void pick()}
            className="flex cursor-pointer flex-col items-center gap-2.5 rounded-[12px] border border-line-strong border-dashed bg-bg px-5 py-9 hover:bg-active"
          >
            <FolderOpen size={28} strokeWidth={1.3} className="text-fg-muted" />
            <span className="font-medium">{t('onboarding.pickDir')}</span>
            <span className="text-[0.923rem] text-fg-muted">{t('onboarding.pickDirHint')}</span>
          </button>
        )}
      </div>
      <footer className="mt-2 flex items-center gap-2.5 border-line-soft border-t px-8 pt-4 pb-5">
        <span className="text-[0.923rem] text-fg-muted">{t('onboarding.stepOf', { n: 2 })}</span>
        <span className="flex-1" />
        <Button className="h-9 px-3.5" onClick={onBack}>
          {t('onboarding.back')}
        </Button>
        {dir ? null : (
          <Button variant="ghost" className="h-9 px-3.5" onClick={onNext}>
            {t('onboarding.skip')}
          </Button>
        )}
        <Button variant="primary" className="h-9 px-[18px]" disabled={!dir} onClick={onNext}>
          {t('onboarding.next')}
        </Button>
      </footer>
    </>
  )
}

// 第 3 步：粘贴 mcpServers，加上后逐个测试连接；可以跳过
function McpStep({ onBack, onDone }: { onBack(): void; onDone(): void }) {
  const [tests, setTests] = useState<
    { name: string; type: string; result?: McpTestResult; pending: boolean }[]
  >([])
  const overview = useMcpOverview()
  const run = async (names: string[]) => {
    const servers = (await kits.mcp.overview()).servers
    setTests(
      names.map((name) => ({
        name,
        type: servers.find((s) => s.name === name)?.type ?? '',
        pending: true,
      })),
    )
    await Promise.all(
      names.map(async (name) => {
        const result = await kits.mcp.test(name)
        setTests((cur) => cur.map((x) => (x.name === name ? { ...x, result, pending: false } : x)))
      }),
    )
    void overview.refetch()
  }
  return (
    <>
      <div className="flex flex-col gap-[22px] px-8 pt-7 pb-2">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 font-semibold text-[1.385rem]">{t('onboarding.mcpTitle')}</h2>
          <p className="m-0 text-fg-muted">{t('onboarding.mcpIntro')}</p>
        </div>
        <McpPaste rows={7} onAdded={(names) => void run(names)} />
        {tests.length ? (
          <div className="flex flex-col gap-2 pb-2" data-testid="onboarding-mcp">
            {tests.map((x) => {
              const ok = x.result?.ok
              return (
                <div
                  key={x.name}
                  className="flex items-center gap-2.5 rounded-[10px] border border-line px-3.5 py-2.5"
                >
                  <span
                    aria-hidden="true"
                    className={cx(
                      'h-2 w-2 shrink-0 rounded-full',
                      x.pending ? 'bg-warn' : ok ? 'bg-ok' : 'bg-danger',
                    )}
                  />
                  <span className="font-medium font-mono text-[0.962rem]">{x.name}</span>
                  <span className="min-w-0 flex-1 truncate text-[0.923rem] text-fg-muted">
                    {x.type === 'http' ? 'HTTP' : 'stdio'} ·{' '}
                    {x.pending
                      ? t('mcp.testing')
                      : x.result?.ok
                        ? t('onboarding.mcpOk', { n: x.result.tools })
                        : (x.result?.error.split('\n')[0] ?? '')}
                  </span>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
      <footer className="mt-2 flex items-center gap-2.5 border-line-soft border-t px-8 pt-4 pb-5">
        <span className="text-[0.923rem] text-fg-muted">{t('onboarding.stepOf', { n: 3 })}</span>
        <span className="flex-1" />
        <Button className="h-9 px-3.5" onClick={onBack}>
          {t('onboarding.back')}
        </Button>
        <Button variant="ghost" className="h-9 px-3.5" onClick={onDone}>
          {t('onboarding.skip')}
        </Button>
        <Button variant="primary" className="h-9 px-[18px]" onClick={onDone}>
          {t('onboarding.done')}
        </Button>
      </footer>
    </>
  )
}

export function OnboardingPage() {
  const [step, setStep] = useState(0)
  const navigate = useNavigate()
  const update = useUpdateSettings()
  useAppearance()
  // 左边步骤下面的小字：配好了显示配了什么（原型 onboarding.html），没配显示说明
  const settings = useSettings()
  const homeLabel = useHomeLabel()
  const mcp = useMcpOverview()
  const s = settings.data
  const progress: (string | undefined)[] = [
    s?.defaultModel
      ? t('onboarding.doneGateway', { model: s.defaultModel.split('/').pop() ?? '' })
      : undefined,
    s?.workdirs[0] ? homeLabel(s.workdirs[0].path) : undefined,
    mcp.data?.servers.length ? t('onboarding.doneMcp', { n: mcp.data.servers.length }) : undefined,
  ]
  // 完成或跳过都算走过引导，之后启动不再进来
  const finish = () => {
    update.mutate({ onboardingDone: true })
    navigate('/')
  }
  return (
    <div className="flex min-h-full flex-col bg-bg">
      <header className="flex h-[52px] items-center gap-2.5 px-6 [-webkit-app-region:drag]">
        <span
          aria-hidden="true"
          className="ml-16 flex h-[22px] w-[22px] items-center justify-center rounded-[6px] bg-primary font-bold text-[12px] text-primary-fg"
        >
          k
        </span>
        <span className="font-semibold text-[1.154rem]">kits</span>
        <span className="flex-1" />
        <span className="text-[0.923rem] text-fg-muted">{t('onboarding.tagline')}</span>
      </header>
      <main className="flex flex-1 justify-center px-6 pt-8 pb-12">
        <div className="flex w-full max-w-[980px] flex-wrap items-start gap-8">
          <nav
            aria-label={t('onboarding.steps')}
            className="flex max-w-[280px] flex-[1_1_240px] flex-col gap-1 pt-3"
          >
            <h1 className="mt-0 mb-4 ml-3 font-semibold text-[1.692rem] tracking-[-0.01em]">
              {t('onboarding.title')}
            </h1>
            {STEPS.map((s, i) => (
              <button
                key={s.title}
                type="button"
                aria-current={i === step ? 'step' : undefined}
                onClick={() => setStep(i)}
                className={cx(
                  'flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2.5 text-left hover:bg-active',
                  i === step && 'bg-raised shadow-[0_0_0_1px_var(--k-border)] hover:bg-raised',
                )}
              >
                <span
                  className={cx(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-semibold text-[0.923rem]',
                    i === step ? 'bg-primary text-primary-fg' : 'bg-muted text-fg-muted',
                  )}
                >
                  {i + 1}
                </span>
                <span className="flex min-w-0 flex-col gap-px">
                  <span className="font-medium">{s.title}</span>
                  <span className="truncate text-[0.923rem] text-fg-muted">
                    {progress[i] ?? s.sub}
                  </span>
                </span>
              </button>
            ))}
            <p className="mx-3 mt-5 mb-0 text-[0.923rem] text-fg-muted leading-[1.6]">
              {t('onboarding.footnote')}
            </p>
          </nav>
          <section
            aria-live="polite"
            className="flex min-w-0 flex-[999_1_520px] flex-col rounded-[16px] border border-line bg-raised shadow-[0_1px_2px_rgba(0,0,0,.03),0_8px_32px_rgba(0,0,0,.04)]"
          >
            {step === 0 ? (
              <GatewayStep onNext={() => setStep(1)} />
            ) : step === 1 ? (
              <WorkdirStep onBack={() => setStep(0)} onNext={() => setStep(2)} />
            ) : (
              <McpStep onBack={() => setStep(1)} onDone={finish} />
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
