import { useEffect } from 'react'
import { useSettings } from '../lib/kits'
import { applyAppearance } from './theme'

// 外壳和首次引导都要按设置套外观（引导页不在 Layout 里）
export function useAppearance() {
  const settings = useSettings()
  useEffect(() => {
    if (settings.data) return applyAppearance(settings.data.general)
  }, [settings.data])
}
