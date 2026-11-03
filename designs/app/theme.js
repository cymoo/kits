// 原型的深色预览（phase1-implementation 6.2 节、PR17）：页面带 ?theme=dark（或设置页里选了深色）时，
// 把内联样式、<style> 里的浅色值按用途（背景 / 文字 / 边框）换成深色令牌，和 apps/desktop 的 index.css 一致。
// 原型的颜色都是手写的十六进制，这里集中换掉，不用逐页改。只为原型服务。
(function () {
  const KEY = 'kits.proto.theme'
  const BG = {
    '#F6F5F2': '#161618', '#FFFFFF': '#1F1F22', '#F1F0EC': '#1B1B1E', '#E9E8E3': '#2A2A2E',
    '#EFEEEA': '#26262A', '#ECEBE7': '#26262A', '#F4F3F0': '#1B1B1E', '#FBFBF9': '#1B1B1E',
    '#FCFCFB': '#1B1B1E', '#FAFAF8': '#1B1B1E', '#F0EFEB': '#26262B', '#E8E8E6': '#2A2A2E',
    '#F1F4FF': '#1E2340', '#F7F8FF': '#1A1E33', '#EEF2FF': '#1E2340', '#D5DCF7': '#2A3260',
    '#E3F3E9': '#12291B', '#EEF8F1': '#12291B', '#FBF0D9': '#2D2110', '#FFFBF0': '#2A1F0F',
    '#FDE8E4': '#331614', '#FEF4F2': '#2E1513', '#FDF1EF': '#2E1513', '#1B1B1F': '#ECECEF',
    '#D9D8D2': '#3F3F46', '#D4D4D8': '#3F3F46', '#FBE7A1': '#5C4A12', '#3659E3': '#7B93FF',
    '#C9C8C1': '#3F3F46', '#E9B949': '#6B4F1A', '#8FA3F0': '#4C5FB8', '#9A9AA1': '#52525B',
  }
  const FG = {
    '#1B1B1F': '#ECECEF', '#6E6E76': '#A1A1AA', '#4A4A52': '#C4C4CC', '#8A8A92': '#8A8A92',
    '#9A9AA1': '#71717A', '#B0B0B6': '#5F5F66', '#FFFFFF': '#161618', '#3659E3': '#7B93FF',
    '#2744B8': '#A5B4FF', '#1E7F43': '#4ADE80', '#15613A': '#4ADE80', '#B4650A': '#F0A245',
    '#8A5A00': '#F0A245', '#6B4600': '#F5B76A', '#C8381F': '#F87171', '#9A2C1F': '#F87171',
    '#B42318': '#F87171', '#7A1E12': '#FCA5A5', '#C9C8C1': '#52525B', '#D9D8D2': '#52525B',
  }
  const BD = {
    '#E5E4DF': '#2E2E33', '#ECEBE7': '#26262B', '#F0EFEB': '#26262B', '#F6F5F2': '#26262B',
    '#C9C8C1': '#3F3F46', '#D9D8D2': '#3F3F46', '#E9B949': '#6B4F1A', '#F3D9A4': '#5A4318',
    '#F2B8AE': '#5A2620', '#F8D4CD': '#4A201B', '#D5DCF7': '#34407A', '#8FA3F0': '#4C5FB8',
    '#3659E3': '#7B93FF', '#1B1B1F': '#ECECEF', '#FFFFFF': '#1F1F22', '#9A9AA1': '#71717A',
    '#E9E8E3': '#2E2E33',
  }

  const hex = (r, g, b) => `#${[r, g, b].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
  const table = (prop) => {
    if (prop.includes('background')) return BG
    if (prop.includes('border') || prop.includes('outline') || prop === 'stroke' || prop.includes('shadow')) return BD
    if (prop === 'color' || prop === 'fill' || prop === 'caret-color' || prop.includes('decoration')) return FG
    return null
  }
  // 值里的颜色可能是 #RRGGBB，也可能被浏览器规范成 rgb(r, g, b)
  const mapValue = (prop, value) => {
    const t = table(prop)
    if (!t || !value) return value
    return value
      .replace(/#[0-9a-fA-F]{6}\b/g, (h) => t[h.toUpperCase()] || h)
      .replace(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/g, (all, r, g, b) => t[hex(r, g, b)] || all)
  }
  // 代码块（命令、diff、终端输出）在深色里也是更深的一块，不跟主按钮一起变成浅色
  const isCode = (style) => {
    const color = style.getPropertyValue('color').replace(/\s/g, '')
    return color === 'rgb(232,232,230)' || color.toUpperCase() === '#E8E8E6'
  }
  const mapStyle = (style) => {
    if (isCode(style)) {
      const bg = style.getPropertyValue('background') || style.getPropertyValue('background-color')
      if (/#1B1B1F|rgb\(27,\s*27,\s*31\)/i.test(bg)) style.setProperty('background', '#111113')
      return
    }
    for (let i = 0; i < style.length; i++) {
      const prop = style[i]
      const before = style.getPropertyValue(prop)
      const after = mapValue(prop, before)
      if (after !== before) style.setProperty(prop, after, style.getPropertyPriority(prop))
    }
  }
  const mapRules = (rules) => {
    for (const rule of rules) {
      if (rule.style) mapStyle(rule.style)
      if (rule.cssRules) mapRules(rule.cssRules)
    }
  }
  const mapElement = (el) => {
    // 设置页主题选项里的小预览画的就是浅色 / 深色本身，不换
    if (el.closest && el.closest('[data-theme-keep]')) return
    if (el.style && el.style.length) mapStyle(el.style)
    for (const attr of ['stroke', 'fill']) {
      const v = el.getAttribute && el.getAttribute(attr)
      if (v && v.startsWith('#')) {
        const next = mapValue(attr === 'fill' ? 'fill' : 'stroke', v)
        if (next !== v) el.setAttribute(attr, next)
      }
    }
  }
  const mapTree = (root) => {
    if (root.nodeType !== 1) return
    mapElement(root)
    for (const el of root.querySelectorAll('*')) mapElement(el)
  }
  const done = new WeakSet()
  const mapSheets = () => {
    for (const sheet of document.styleSheets) {
      if (done.has(sheet)) continue
      try {
        mapRules(sheet.cssRules)
        done.add(sheet)
      } catch {
        // 跨域的字体样式表读不了规则，跳过
      }
    }
  }

  let observer
  function start() {
    document.documentElement.dataset.theme = 'dark'
    document.documentElement.style.colorScheme = 'dark'
    mapSheets()
    mapTree(document.body)
    observer = new MutationObserver((records) => {
      mapSheets()
      for (const r of records) {
        if (r.type === 'attributes') mapElement(r.target)
        else for (const n of r.addedNodes) mapTree(n)
      }
    })
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'stroke', 'fill'],
    })
  }

  const query = new URLSearchParams(location.search).get('theme')
  if (query) localStorage.setItem(KEY, query)
  const wanted = query || localStorage.getItem(KEY)
  const dark =
    wanted === 'dark' ||
    (wanted === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  // 设置页的主题选项调用它：切到深色立刻生效；切回浅色要重新载入（浅色是原值）
  window.kitsTheme = {
    set(theme) {
      localStorage.setItem(KEY, theme)
      const nextDark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      if (nextDark && !observer) start()
      else if (!nextDark && observer) location.reload()
    },
  }
  if (!dark) return
  if (document.body) start()
  else document.addEventListener('DOMContentLoaded', start)
})()
