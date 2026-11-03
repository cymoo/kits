import type { GatewayTestResult } from '@kits/core/ipc'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../../app/i18n'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { Field, Input } from '../../ui/Input'
import { Spinner } from '../../ui/Spinner'
import { TestResult, useKeyHint } from '../settings/model/ModelSection'
import { useGateways } from '../settings/model/useGateways'

// 首次引导（原型 onboarding.html）：左侧三步导航，右侧当前步骤。
// 第 1 步网关在这里做；第 2 步工作目录和首次启动门控在 PR17，第 3 步 MCP 在 PR12，先放占位。

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
  const added = gateways[0]
  const keyHint = useKeyHint()

  const run = async () => {
    const r = await test.mutateAsync({ baseUrl, ...(apiKey ? { apiKey } : {}) })
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
          <div
            role="radiogroup"
            aria-label={t('model.defaultModel')}
            className="grid grid-cols-2 gap-2"
          >
            {added.models.map((m) => {
              const ref = `${added.id}/${m.id}`
              const on = ref === defaultModel
              return (
                // biome-ignore lint/a11y/useSemanticElements: 和原型一致的卡片单选
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => void setDefault(ref)}
                  className={cx(
                    'flex cursor-pointer items-center gap-2 rounded-[10px] border px-3.5 py-2.5 text-left',
                    on ? 'border-accent bg-accent-bg/60' : 'border-line hover:border-line-strong',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-mono font-medium text-[0.962rem]">
                    {m.id}
                  </span>
                  {on ? <Check size={14} className="text-accent" /> : null}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
      <div className="flex justify-end border-line-soft border-t py-4">
        <Button variant="primary" disabled={!added || !defaultModel} onClick={onNext}>
          {t('onboarding.next')}
        </Button>
      </div>
    </div>
  )
}

function PendingStep({ onDone }: { onDone(): void }) {
  return (
    <div className="flex flex-col gap-4 px-8 py-7">
      <p className="m-0 text-fg-muted">{t('settings.pending')}</p>
      <div className="flex justify-end">
        <Button variant="primary" onClick={onDone}>
          {t('onboarding.finish')}
        </Button>
      </div>
    </div>
  )
}

export function OnboardingPage() {
  const [step, setStep] = useState(0)
  const navigate = useNavigate()
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
                  <span className="text-[0.923rem] text-fg-muted">{s.sub}</span>
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
            ) : (
              <PendingStep onDone={() => navigate('/')} />
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
