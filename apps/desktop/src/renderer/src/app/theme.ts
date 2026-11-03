import type { GeneralSettings } from '@kits/core/ipc'

// 把通用设置里的外观写到 <html> 上：data-theme（system 时跟随系统）、data-scale、代码字号、字体。
// 改了立刻生效，不用重启。

export function resolveTheme(
  theme: GeneralSettings['theme'],
  prefersDark: boolean,
): 'light' | 'dark' {
  if (theme === 'system') return prefersDark ? 'dark' : 'light'
  return theme
}

export function applyAppearance(
  general: GeneralSettings,
  root: HTMLElement = document.documentElement,
) {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = () => {
    root.dataset.theme = resolveTheme(general.theme, media.matches)
  }
  apply()
  root.dataset.scale = general.uiScale
  root.style.setProperty('--k-code-size', `${general.codeFontSize}px`)
  if (general.uiFont) root.style.setProperty('--k-font', `"${general.uiFont}", var(--k-font-base)`)
  else root.style.removeProperty('--k-font')
  if (general.codeFont)
    root.style.setProperty('--k-mono', `"${general.codeFont}", var(--k-mono-base)`)
  else root.style.removeProperty('--k-mono')
  if (general.theme !== 'system') return () => {}
  media.addEventListener('change', apply)
  return () => media.removeEventListener('change', apply)
}
