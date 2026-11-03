import type { Gateway, GatewayTestResult } from '@kits/core/ipc'
import { useMutation } from '@tanstack/react-query'
import { fixDefaultModel, mergeModels, newGateway, suggestGatewayId } from '../../../lib/gateway'
import { kits, useSettings, useUpdateSettings } from '../../../lib/kits'
import { gatewaySecretKey } from '../../../lib/secret-keys'

// 网关的增删改，设置页和首次引导共用。密钥只进 secrets，settings.json 里没有。
export function useGateways() {
  const settings = useSettings()
  const update = useUpdateSettings()
  const gateways = settings.data?.gateways ?? []
  const defaultModel = settings.data?.defaultModel ?? ''

  const save = (next: Gateway[], preferDefault?: string) =>
    update.mutateAsync({
      gateways: next,
      defaultModel: fixDefaultModel(next, preferDefault ?? defaultModel),
    })

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
    async add(input: { name: string; baseUrl: string; apiKey: string; models: string[] }) {
      const id = suggestGatewayId(
        input.baseUrl,
        gateways.map((g) => g.id),
      )
      if (input.apiKey) await kits.secrets.set({ key: gatewaySecretKey(id), value: input.apiKey })
      const gw = newGateway({
        id,
        name: input.name || id,
        baseUrl: input.baseUrl,
        models: input.models,
      })
      return save([...gateways, gw])
    },
    async patch(id: string, patch: Partial<Gateway>) {
      return save(gateways.map((g) => (g.id === id ? { ...g, ...patch } : g)))
    },
    async setKey(id: string, apiKey: string) {
      await kits.secrets.set({ key: gatewaySecretKey(id), value: apiKey })
    },
    async refreshModels(id: string, listed: string[]) {
      return save(
        gateways.map((g) => (g.id === id ? { ...g, models: mergeModels(g.models, listed) } : g)),
      )
    },
    async remove(id: string) {
      await kits.secrets.remove(gatewaySecretKey(id))
      return save(gateways.filter((g) => g.id !== id))
    },
    setDefault(ref: string) {
      return save(gateways, ref)
    },
  }
}
