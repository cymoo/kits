import type { KitsApi } from './index'

declare global {
  interface Window {
    kits: KitsApi
  }
}
