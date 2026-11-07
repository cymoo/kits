import type { Gateway, GatewayTestResult } from '@kits/core/ipc'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { fixDefaultModel, mergeModels, newGateway, suggestGatewayId } from '../../../lib/gateway'
import { kits, queryKeys, useSettings, useUpdateSettings } from '../../../lib/kits'
import { gatewaySecretKey } from '../../../lib/secret-keys'

// 网关的增删改，设置页和首次引导共用。密钥只进 secrets，settings.json 里没有。
export function useGateways() {
  const settings = useSettings()
  const update = useUpdateSettings()
  const client = useQueryClient()
  // 存密钥会顺带修好坏掉的密钥表，设置页顶上的读取错误跟着刷新
  const setSecret = async (key: string, value: string) => {
    await kits.secrets.set({ key, value })
    void client.invalidateQueries({ queryKey: [...queryKeys.settings, 'loadError'] })
  }
  const gateways = settings.data?.gateways ?? []
  const defaultModel = settings.data?.defaultModel ?? ''

  // 每次修改都先拿主进程的最新设置，按网关 id 改，不用渲染时的快照：
  // 刷新列表这种要等网络的操作回来时，期间做的停用、删除、改默认模型都还在
  const save = async (change: (current: Gateway[]) => Gateway[], preferDefault?: string) => {
    const latest = await kits.settings.get()
    const next = change(latest.gateways)
    return update.mutateAsync({
      gateways: next,
      defaultModel: fixDefaultModel(next, preferDefault ?? latest.defaultModel),
    })
  }
  const patchOne = (id: string, fn: (g: Gateway) => Gateway) =>
    save((list) => list.map((g) => (g.id === id ? fn(g) : g)))

  const test = useMutation({
    mutationFn: (input: {
      baseUrl: string
      apiKey?: string
      gatewayId?: string
    }): Promise<GatewayTestResult> => kits.gateway.test(input),
  })

  return {
    gateways,
    defaultModel,
    loading: settings.isLoading,
    test,
    async add(input: {
      name: string
      baseUrl: string
      apiKey: string
      models: string[]
      contextWindows: Record<string, number>
      vision: Record<string, boolean>
    }) {
      const latest = await kits.settings.get()
      const id = suggestGatewayId(
        input.baseUrl,
        latest.gateways.map((g) => g.id),
      )
      if (input.apiKey) await setSecret(gatewaySecretKey(id), input.apiKey)
      const gw = newGateway({
        id,
        name: input.name || id,
        baseUrl: input.baseUrl,
        models: input.models,
        contextWindows: input.contextWindows,
        vision: input.vision,
      })
      return save((list) => [...list, gw])
    },
    patch(id: string, patch: Partial<Gateway>) {
      return patchOne(id, (g) => ({ ...g, ...patch }))
    },
    async setKey(id: string, apiKey: string) {
      await setSecret(gatewaySecretKey(id), apiKey)
    },
    // 刷新结果只对发请求时的那个地址有效：期间网关被删、地址被改了就丢掉
    refreshModels(
      id: string,
      listed: string[],
      contextWindows: Record<string, number>,
      vision: Record<string, boolean>,
      baseUrl: string,
    ) {
      return patchOne(id, (g) =>
        g.baseUrl === baseUrl
          ? { ...g, models: mergeModels(g.models, listed, contextWindows, vision) }
          : g,
      )
    },
    // 先把网关从设置里删掉，成功了再删密钥：设置写失败时网关还在，密钥也还能用
    async remove(id: string) {
      const saved = await save((list) => list.filter((g) => g.id !== id))
      await kits.secrets.remove(gatewaySecretKey(id))
      return saved
    },
    setDefault(ref: string) {
      return save((list) => list, ref)
    },
  }
}
