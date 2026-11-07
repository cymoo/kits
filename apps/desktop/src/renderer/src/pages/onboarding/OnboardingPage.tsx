import type { GatewayTestResult } from '@kits/core/ipc'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FolderOpen } from 'lucide-react'
import { RadioGroup } from 'radix-ui'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../../app/i18n'
import { useAppearance } from '../../app/use-appearance'
import {
  kits,
  queryKeys,
  useAppInfo,
  useHomeLabel,
  useSettings,
  useUpdateSettings,
} from '../../lib/kits'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { Field, Input } from '../../ui/Input'
import { Spinner } from '../../ui/Spinner'
import { TestResult, useKeyHint } from '../settings/model/ModelSection'
import { useGateways } from '../settings/model/useGateways'

// 首次引导（原型 onboarding.html）：一页配好模型网关和工作目录，MCP 等到用的时候在设置里配。
// 第一次启动、还没配网关时 Layout 会跳到这里；开始使用或跳过后记 onboardingDone，之后不再进来。

function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function Section({
  title,
  intro,
  children,
}: {
  title: string
  intro: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 font-semibold text-[1rem]">{title}</h2>
        <p className="m-0 text-[0.929rem] text-fg-muted">{intro}</p>
      </div>
      {children}
    </div>
  )
}

function GatewaySection() {
  const { gateways, defaultModel, test, add, setDefault } = useGateways()
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [result, setResult] = useState<GatewayTestResult>()
  // 只认启用且有模型的网关；停用的、空的不算配好了，表单留着
  const added = gateways.find((g) => g.enabled && g.models.length > 0)
  const keyHint = useKeyHint()
  // 离开引导后，还在路上的测试回来也不再保存
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
    if (r.ok && !added) {
      await add({
        name: '',
        baseUrl,
        apiKey,
        models: r.models,
        contextWindows: r.contextWindows,
        vision: r.vision,
      })
    }
  }

  return (
    <Section title={t('onboarding.gatewayTitle')} intro={t('onboarding.gatewayIntro')}>
      {added ? null : (
        <div className="grid grid-cols-2 gap-3">
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
        {added ? (
          <span className="min-w-0 truncate font-mono text-[0.929rem]" title={added.baseUrl}>
            {added.baseUrl}
          </span>
        ) : (
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
          <span className="text-[0.929rem] text-fg-muted">{t('onboarding.testHint')}</span>
        )}
      </div>
      {added ? (
        <div className="flex flex-col gap-2">
          <span className="font-medium">{t('model.defaultModel')}</span>
          <RadioGroup.Root
            value={defaultModel}
            onValueChange={(ref) => void setDefault(ref)}
            aria-label={t('model.defaultModel')}
            className="grid max-h-[200px] grid-cols-2 gap-2 overflow-y-auto"
          >
            {added.models.map((m) => {
              const ref = `${added.id}/${m.id}`
              const on = ref === defaultModel
              return (
                <RadioGroup.Item
                  key={m.id}
                  value={ref}
                  className={cx(
                    'flex h-10 cursor-pointer items-center gap-2 rounded-[12px] border px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    on ? 'border-accent bg-accent-bg/60' : 'border-line hover:border-line-strong',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-mono font-medium text-[0.929rem]">
                    {m.id}
                  </span>
                  {on ? <Check size={14} className="text-accent" /> : null}
                </RadioGroup.Item>
              )
            })}
          </RadioGroup.Root>
        </div>
      ) : null}
    </Section>
  )
}

// 工作目录：选了已有目录就用它，没选就用默认目录，点“开始使用”时才创建
function WorkdirSection({ dir }: { dir?: string }) {
  const info = useAppInfo()
  const homeLabel = useHomeLabel()
  const client = useQueryClient()
  const inspection = useQuery({
    queryKey: ['workdir-inspect', dir ?? ''],
    queryFn: () => kits.workdir.inspect(dir ?? ''),
    enabled: !!dir,
  })
  const pick = async () => {
    const picked = await kits.workdir.pick()
    if (picked) await client.invalidateQueries({ queryKey: queryKeys.settings })
  }
  const shown = dir ?? info.data?.defaultWorkdir ?? ''
  const git = inspection.data?.git
  return (
    <Section title={t('onboarding.workdirTitle')} intro={t('onboarding.workdirIntro')}>
      <div
        className="flex items-center gap-3 rounded-[12px] border border-line px-3.5 py-3"
        data-testid="onboarding-workdir"
      >
        <FolderOpen size={18} className="shrink-0 text-fg-muted" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-medium font-mono" title={shown}>
            {homeLabel(shown)}
          </span>
          <span className="text-[0.929rem] text-fg-muted">
            {!dir
              ? t('onboarding.workdirDefault')
              : inspection.isPending
                ? '…'
                : git
                  ? t(git.changed ? 'onboarding.gitDirty' : 'onboarding.gitClean', {
                      branch: git.branch,
                      n: git.changed,
                    })
                  : t('onboarding.notGit')}
          </span>
        </span>
        <Button onClick={() => void pick()}>
          {t(dir ? 'onboarding.changeDir' : 'onboarding.pickDir')}
        </Button>
      </div>
    </Section>
  )
}

export function OnboardingPage() {
  const navigate = useNavigate()
  const update = useUpdateSettings()
  const client = useQueryClient()
  const { gateways, defaultModel } = useGateways()
  const [error, setError] = useState<string>()
  useAppearance()
  const settings = useSettings()
  const dir = settings.data?.workdirs[0]?.path
  const ready = gateways.some((g) => g.enabled && g.models.length > 0) && !!defaultModel
  // 开始或跳过都算走过引导，之后启动不再进来。没选目录就建默认目录，建不了留在这页，可以换一个
  const finish = async () => {
    setError(undefined)
    try {
      if (!dir) {
        await kits.workdir.createDefault()
        await client.invalidateQueries({ queryKey: queryKeys.settings })
      }
    } catch (e) {
      setError(t('onboarding.workdirError', { error: errorText(e) }))
      return
    }
    update.mutate({ onboardingDone: true })
    navigate('/')
  }
  return (
    <div className="flex min-h-full flex-col bg-bg">
      <header className="flex h-[52px] shrink-0 items-center gap-2.5 px-6 [-webkit-app-region:drag]">
        <span
          aria-hidden="true"
          className="ml-16 flex h-[22px] w-[22px] items-center justify-center rounded-[6px] bg-primary font-bold text-[12px] text-primary-fg"
        >
          k
        </span>
        <span className="font-semibold text-[1.143rem]">kits</span>
      </header>
      <main className="flex flex-1 justify-center px-6 pt-6 pb-12">
        <section
          aria-live="polite"
          className="flex w-full max-w-[560px] flex-col self-start rounded-[16px] border border-line bg-raised shadow-[0_1px_2px_rgba(0,0,0,.03),0_8px_32px_rgba(0,0,0,.04)]"
        >
          <div className="flex flex-col gap-6 px-8 pt-7 pb-6">
            <div className="flex flex-col gap-1">
              <h1 className="m-0 font-semibold text-[1.571rem] tracking-[-0.01em]">
                {t('onboarding.title')}
              </h1>
              <p className="m-0 text-fg-muted">{t('onboarding.intro')}</p>
            </div>
            <GatewaySection />
            <WorkdirSection {...(dir ? { dir } : {})} />
            {error ? (
              <p role="alert" className="m-0 break-all text-[0.929rem] text-danger">
                {error}
              </p>
            ) : null}
          </div>
          <footer className="flex items-center justify-end gap-2.5 border-line-soft border-t px-8 pt-4 pb-5">
            <Button variant="ghost" className="h-9 px-3.5" onClick={() => void finish()}>
              {t('onboarding.skip')}
            </Button>
            <Button
              variant="primary"
              className="h-9 px-[18px]"
              disabled={!ready}
              onClick={() => void finish()}
            >
              {t('onboarding.start')}
            </Button>
          </footer>
        </section>
      </main>
    </div>
  )
}
