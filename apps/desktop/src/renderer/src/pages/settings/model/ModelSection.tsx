import type { Gateway, GatewayTestResult, KernelInfo } from '@kits/core/ipc'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'

import { useEffect, useRef, useState } from 'react'
import { type MessageKey, t } from '../../../app/i18n'

import { kits, useSettings, useUpdateSettings } from '../../../lib/kits'
import { gatewaySecretKey } from '../../../lib/secret-keys'
import { Button } from '../../../ui/Button'
import { cx } from '../../../ui/cx'
import { Field, Input } from '../../../ui/Input'
import { Spinner } from '../../../ui/Spinner'
import { Switch } from '../../../ui/Switch'
import { useGateways } from './useGateways'

// 设置 · 内核与模型（原型 settings.html#model）：网关增删改、测试连接、模型列表、默认模型、内核选择、日志目录。

// 钥匙串不可用时如实说明 key 存成了明文
export function useKeyHint(): string {
  const encrypted = useQuery({
    queryKey: ['secrets', 'encrypted'],
    queryFn: () => kits.secrets.encrypted(),
  })
  return encrypted.data === false ? t('model.keyHintPlain') : t('model.keyHint')
}

export function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function TestResult({ result }: { result: GatewayTestResult | undefined }) {
  if (!result) return null
  return result.ok ? (
    <span className="font-medium text-ok" role="status">
      {t('model.testOk', { ms: result.latencyMs, n: result.models.length })}
    </span>
  ) : (
    <span className="font-medium text-danger" role="status">
      {result.error}
    </span>
  )
}

function AddGatewayForm({ onDone }: { onDone(): void }) {
  const { test, add } = useGateways()
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [result, setResult] = useState<GatewayTestResult>()
  const keyHint = useKeyHint()
  // 点了“取消”或表单收起后，还在路上的测试回来也不再保存
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )
  const submit = async () => {
    const r = await test.mutateAsync({ baseUrl, ...(apiKey ? { apiKey } : {}) })
    if (!alive.current) return
    // 连上了但没有模型：不保存，没有模型的启用网关会让整份内核配置生成失败
    if (r.ok && r.models.length === 0) {
      setResult({ ok: false, latencyMs: r.latencyMs, error: t('onboarding.noModels') })
      return
    }
    setResult(r)
    if (!r.ok) return
    await add({ name, baseUrl, apiKey, models: r.models })
    onDone()
  }
  return (
    <form
      className="flex flex-col gap-3.5 rounded-[14px] border border-accent bg-raised p-[18px] shadow-[0_0_0_4px_rgb(54_89_227/0.08)]"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3.5">
        <Field label={t('model.name')}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('model.namePlaceholder')}
          />
        </Field>
        <Field label={t('model.url')}>
          <Input
            mono
            type="url"
            required
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://…/v1"
          />
        </Field>
      </div>
      <Field label="API Key" hint={keyHint}>
        <Input
          mono
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={t('model.keyPlaceholder')}
        />
      </Field>
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto">
          <TestResult result={result} />
        </span>
        <Button
          onClick={() => {
            alive.current = false
            onDone()
          }}
          className="h-[30px]"
        >
          {t('common.cancel')}
        </Button>
        <Button variant="primary" type="submit" disabled={!baseUrl || test.isPending}>
          {test.isPending ? <Spinner /> : null}
          {t('model.testAndAdd')}
        </Button>
      </div>
    </form>
  )
}

function GatewayCard({ gateway }: { gateway: Gateway }) {
  const { patch, setKey, test, refreshModels, remove, setDefault, defaultModel } = useGateways()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(gateway.baseUrl)
  // 用户没动过地址框时，跟着保存的地址走（settings.json 被手改、别处改了地址）
  const [urlEdited, setUrlEdited] = useState(false)
  useEffect(() => {
    if (!urlEdited) setUrl(gateway.baseUrl)
  }, [gateway.baseUrl, urlEdited])
  const [key, setKeyInput] = useState('')
  const [result, setResult] = useState<GatewayTestResult>()
  const hasKey = useQuery({
    queryKey: ['secrets', gatewaySecretKey(gateway.id)],
    queryFn: () => kits.secrets.has(gatewaySecretKey(gateway.id)),
  })

  // 显式传地址：保存地址后立刻测试时，这一轮渲染里的 gateway.baseUrl 还是旧的
  const runTest = async (baseUrl = gateway.baseUrl) => {
    const r = await test.mutateAsync({ baseUrl, gatewayId: gateway.id })
    setResult(r)
    return r
  }
  const saveConnection = async () => {
    // 先校验地址，再动密钥和设置：地址不对时什么都不写
    if (!isHttpUrl(url)) {
      setResult({ ok: false, latencyMs: 0, error: t('model.badUrl') })
      return
    }
    if (key) {
      await setKey(gateway.id, key)
      setKeyInput('')
      void hasKey.refetch()
    }
    if (url !== gateway.baseUrl) await patch(gateway.id, { baseUrl: url })
    setUrlEdited(false)
    await runTest(url)
  }
  const statusDot = !gateway.enabled ? 'bg-[#D4D4D8]' : result?.ok === false ? 'bg-danger' : 'bg-ok'

  return (
    <div
      className="flex flex-col overflow-hidden rounded-[14px] border border-line bg-raised"
      data-testid={`gateway-${gateway.id}`}
    >
      <div
        className={cx('flex items-center gap-2.5 px-4 py-3', open && 'border-line-soft border-b')}
      >
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
        >
          <ChevronRight
            size={14}
            className={cx('text-fg-subtle transition-transform', open && 'rotate-90')}
          />
          <span
            aria-hidden="true"
            className={cx('h-[7px] w-[7px] shrink-0 rounded-full', statusDot)}
          />
          <b className="font-semibold">{gateway.name || gateway.id}</b>
          <span className="truncate font-mono text-[0.923rem] text-fg-muted">
            {gateway.baseUrl}
          </span>
        </button>
        <TestResult result={result} />
        <Button onClick={() => void runTest()} disabled={test.isPending} className="h-[26px] px-2">
          {t('model.test')}
        </Button>
        <Switch
          checked={gateway.enabled}
          label={t('model.enable')}
          onCheckedChange={(v) => void patch(gateway.id, { enabled: v })}
        />
      </div>
      {open ? (
        <>
          <div className="grid grid-cols-2 gap-3.5 border-line-soft border-b px-4 py-3.5">
            <Field label={t('model.url')}>
              <Input
                mono
                type="url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value)
                  setUrlEdited(true)
                }}
                className="h-8"
              />
            </Field>
            <Field label="API Key">
              <Input
                mono
                type="password"
                value={key}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={hasKey.data ? t('model.keySaved') : t('model.keyPlaceholder')}
                className="h-8"
              />
            </Field>
            <div className="col-span-2 flex items-center gap-2">
              <span className="font-mono text-[0.885rem] text-fg-label">id: {gateway.id}</span>
              <span className="flex-1" />
              <Button
                variant="link"
                onClick={() => void remove(gateway.id)}
                className="text-danger hover:text-danger"
              >
                {t('model.remove')}
              </Button>
              <Button
                onClick={() => void saveConnection()}
                disabled={!key && url === gateway.baseUrl}
              >
                {t('model.saveAndTest')}
              </Button>
            </div>
          </div>
          <div
            role="radiogroup"
            aria-label={t('model.defaultModel')}
            className="flex flex-col pb-1.5"
          >
            <div className="flex items-center gap-2 px-4 pt-2 pb-1 text-[0.923rem] text-fg-label">
              <span className="flex-1">{t('model.modelsNote', { n: gateway.models.length })}</span>
              <Button
                variant="link"
                onClick={async () => {
                  const sent = gateway.baseUrl
                  const r = await runTest(sent)
                  // 网关一个模型都没列出来时不覆盖已有的模型，没有模型的启用网关会让内核配置生成失败
                  if (r.ok && r.models.length === 0) {
                    setResult({
                      ok: false,
                      latencyMs: r.latencyMs,
                      error: t('onboarding.noModels'),
                    })
                    return
                  }
                  if (r.ok) await refreshModels(gateway.id, r.models, sent)
                }}
              >
                {t('model.refresh')}
              </Button>
            </div>
            {gateway.models.map((m) => {
              const ref = `${gateway.id}/${m.id}`
              const on = ref === defaultModel
              return (
                <div
                  key={m.id}
                  className={cx('flex items-center gap-3 px-4 py-1.5', on && 'bg-accent-bg/60')}
                >
                  {/* biome-ignore lint/a11y/useSemanticElements: 和原型一致的自绘单选 */}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={!gateway.enabled}
                    onClick={() => void setDefault(ref)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left disabled:cursor-default disabled:opacity-50"
                  >
                    <span
                      className={cx(
                        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
                        on ? 'border-accent' : 'border-line-strong',
                      )}
                    >
                      {on ? <span className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
                    </span>
                    <span className="basis-[180px] truncate font-mono font-medium text-[0.962rem]">
                      {m.id}
                    </span>
                    {on ? (
                      <span className="rounded-[8px] bg-accent-bg px-[7px] font-medium text-[0.846rem] text-accent-fg">
                        {t('model.default')}
                      </span>
                    ) : null}
                  </button>
                  <label className="flex items-center gap-1 text-[0.923rem] text-fg-label">
                    <span>{t('model.context')}</span>
                    <input
                      type="number"
                      min={1}
                      aria-label={t('model.contextOf', { model: m.id })}
                      defaultValue={Math.round(m.contextWindow / 1000)}
                      onBlur={(e) => {
                        // 只在真的改过数字时保存：131072 显示成 131，光看一眼不能把它改成 131000
                        if (e.target.value === e.target.defaultValue) return
                        const k = Number(e.target.value)
                        if (k > 0 && k * 1000 !== m.contextWindow) {
                          void patch(gateway.id, {
                            models: gateway.models.map((x) =>
                              x.id === m.id ? { ...x, contextWindow: k * 1000 } : x,
                            ),
                          })
                        }
                      }}
                      className="h-6 w-14 rounded-[5px] border border-line bg-raised px-1 text-right font-mono text-fg"
                    />
                    <span>K</span>
                  </label>
                </div>
              )
            })}
          </div>
        </>
      ) : null}
    </div>
  )
}

function KernelState({ info }: { info: KernelInfo }) {
  if (!info.installed) {
    return (
      <span className="rounded-[8px] bg-muted px-[7px] font-medium text-[0.846rem] text-fg-muted">
        {t('model.notInstalled')}
      </span>
    )
  }
  const tone =
    info.state === 'running'
      ? 'bg-ok-bg text-ok'
      : info.state === 'error'
        ? 'bg-danger-bg text-danger'
        : info.state === 'stopped'
          ? 'bg-muted text-fg-muted'
          : 'bg-warn-bg text-warn'
  return (
    <span className={cx('rounded-[8px] px-[7px] font-medium text-[0.846rem]', tone)}>
      {t(`model.state.${info.state}` as MessageKey)}
    </span>
  )
}

const KERNEL_TEXT: Record<KernelInfo['id'], { name: string; note: string }> = {
  opencode: { name: 'OpenCode', note: '开源内核，随应用打包。第一阶段以它为主走通全流程。' },
  codeagent: {
    name: 'CodeAgent',
    note: '公司内部内核，只有 Windows 版；没装时新会话用 OpenCode。',
  },
}

function KernelCard() {
  const settings = useSettings()
  const update = useUpdateSettings()
  const client = useQueryClient()
  const status = useQuery({ queryKey: ['kernel', 'status'], queryFn: () => kits.kernel.status() })
  // 内核状态变化由主进程推过来，直接合进缓存
  useEffect(
    () =>
      kits.on('kernel.status', (runtime) =>
        client.setQueryData<KernelInfo[]>(['kernel', 'status'], (list) =>
          list?.map((k) => (k.id === runtime.id ? { ...k, ...runtime } : k)),
        ),
      ),
    [client],
  )
  const current = settings.data?.kernel ?? 'opencode'
  const currentInfo = status.data?.find((k) => k.id === current)
  const logs = currentInfo?.logsDir
  return (
    <section className="flex flex-col overflow-hidden rounded-[14px] border border-line bg-raised">
      <div className="flex items-center gap-2.5 border-line-soft border-b px-[18px] py-3">
        <b className="font-semibold">{t('model.kernel')}</b>
        <small className="text-[0.923rem] text-fg-muted">{t('model.kernelNote')}</small>
      </div>
      <div
        role="radiogroup"
        aria-label={t('model.kernelDefault')}
        className="grid grid-cols-2 gap-3 p-[18px]"
      >
        {(status.data ?? []).map((k) => {
          const on = k.id === current
          return (
            // biome-ignore lint/a11y/useSemanticElements: 和原型一致的卡片单选
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!k.installed}
              onClick={() => update.mutate({ kernel: k.id })}
              className={cx(
                'flex cursor-pointer flex-col items-start gap-1.5 rounded-[12px] border p-3.5 text-left disabled:cursor-default',
                on ? 'border-accent bg-accent-bg/50' : 'border-line hover:border-line-strong',
              )}
            >
              <span className="flex w-full items-center gap-2">
                <span className="font-semibold text-[1.077rem]">{KERNEL_TEXT[k.id].name}</span>
                <span className="font-mono text-[0.885rem] text-fg-muted">{k.version ?? ''}</span>
                <span className="flex-1" />
                <KernelState info={k} />
              </span>
              <span className="text-[0.962rem] text-fg-muted leading-[1.55]">
                {KERNEL_TEXT[k.id].note}
              </span>
            </button>
          )
        })}
      </div>
      {currentInfo && (currentInfo.state === 'error' || currentInfo.problems.length > 0) ? (
        <div
          role="alert"
          className="mx-[18px] mb-3 flex flex-col gap-1 rounded-[10px] bg-danger-bg px-3.5 py-2.5 text-[0.962rem] text-danger"
        >
          <span className="whitespace-pre-wrap">{currentInfo.error}</span>
          {currentInfo.problems.map((p) => (
            <span key={`${p.section}-${p.target}-${p.message}`}>
              · {p.target}：{p.message}
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex flex-col gap-2 px-[18px] pb-[18px]">
        <div className="flex items-center gap-2.5 rounded-[10px] bg-bg px-3.5 py-2.5 text-[0.962rem]">
          <span className="shrink-0 text-fg-muted">{t('model.process')}</span>
          <span className="flex-1" data-testid="kernel-state">
            {currentInfo ? t(`model.state.${currentInfo.state}` as MessageKey) : ''}
          </span>
          <Button
            variant="link"
            disabled={!currentInfo?.installed}
            onClick={() => void kits.kernel.restart(current)}
          >
            {currentInfo?.state === 'stopped' ? t('model.start') : t('model.restart')}
          </Button>
        </div>
        <div className="flex items-center gap-2.5 rounded-[10px] bg-bg px-3.5 py-2.5 text-[0.962rem]">
          <span className="shrink-0 text-fg-muted">{t('model.network')}</span>
          <span className="flex-1">{t('model.networkNote')}</span>
        </div>
        <div className="flex items-center gap-2.5 rounded-[10px] bg-bg px-3.5 py-2.5 text-[0.962rem]">
          <span className="shrink-0 text-fg-muted">{t('model.logs')}</span>
          <span className="flex-1 truncate font-mono text-[0.923rem]">{logs ?? ''}</span>
          <Button variant="link" onClick={() => void kits.kernel.openLogs(current)}>
            {t('model.openDir')}
          </Button>
        </div>
      </div>
    </section>
  )
}

export function ModelSection() {
  const { gateways } = useGateways()
  const [adding, setAdding] = useState(false)
  return (
    <div className="flex w-full max-w-[760px] flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-semibold text-[1.538rem] tracking-[-0.01em]">
          {t('settings.model')}
        </h2>
        <p className="m-0 text-fg-muted">{t('model.intro')}</p>
      </div>
      <section className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2.5 px-0.5">
          <span className="font-semibold">{t('model.gateways')}</span>
          <small className="text-[0.923rem] text-fg-muted">{t('model.gatewaysNote')}</small>
          <span className="flex-1" />
          <Button variant="primary" aria-expanded={adding} onClick={() => setAdding(!adding)}>
            {t('model.addGateway')}
          </Button>
        </div>
        {adding ? <AddGatewayForm onDone={() => setAdding(false)} /> : null}
        {gateways.length === 0 && !adding ? (
          <p className="m-0 rounded-[14px] border border-line border-dashed px-4 py-6 text-center text-fg-muted">
            {t('model.empty')}
          </p>
        ) : null}
        {gateways.map((g) => (
          <GatewayCard key={g.id} gateway={g} />
        ))}
        <p className="mx-0.5 my-0 text-[0.923rem] text-fg-label">{t('model.footnote')}</p>
      </section>
      <KernelCard />
    </div>
  )
}
