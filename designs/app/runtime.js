// 原型的极简运行时：让 <x-dc> 模板（{{hole}}、<sc-if>、<sc-for>、onClick 等）脱离设计工具，直接在浏览器里打开。
// 只为原型服务，不是产品代码。
(function () {
  document.head.insertAdjacentHTML('beforeend', '<style>x-dc{display:none}</style>')

  const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g
  const WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/

  function lookup(path, scope) {
    if (path === 'true') return true
    if (path === 'false') return false
    if (path === 'null') return null
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path)
    let v = scope
    for (const key of path.split('.')) {
      if (v == null) return undefined
      v = v[key]
    }
    return v
  }

  function interpolate(text, scope) {
    return text.replace(HOLE, (_, p) => {
      const v = lookup(p, scope)
      return v == null ? '' : String(v)
    })
  }

  function hole(attr, scope) {
    const m = attr && attr.match(WHOLE)
    return m ? lookup(m[1], scope) : attr
  }

  function child(scope, vars) {
    return Object.assign(Object.create(scope), vars)
  }

  function applyAttrs(el, scope) {
    for (const { name, value } of Array.from(el.attributes)) {
      if (name.startsWith('hint-') || name === 'data-for' || name === 'data-as') {
        el.removeAttribute(name)
        continue
      }
      if (!value.includes('{{')) continue
      const whole = value.match(WHOLE)
      if (!whole) {
        el.setAttribute(name, interpolate(value, scope))
        continue
      }
      const v = lookup(whole[1], scope)
      if (name.startsWith('on')) {
        el.removeAttribute(name)
        if (typeof v === 'function') el.addEventListener(name.slice(2), v)
      } else if (name === 'checked') {
        el.removeAttribute(name)
        el.checked = !!v
      } else if (name.startsWith('aria-')) {
        el.setAttribute(name, String(v))
      } else if (v === false || v == null) {
        el.removeAttribute(name)
      } else {
        el.setAttribute(name, String(v))
      }
    }
  }

  function renderElement(node, scope, out) {
    const el = node.cloneNode(false)
    applyAttrs(el, scope)
    render(node, scope, el)
    out.appendChild(el)
  }

  function render(tpl, scope, out) {
    for (const node of Array.from(tpl.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        out.appendChild(document.createTextNode(interpolate(node.data, scope)))
        continue
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue
      const tag = node.localName
      if (window.kitsTags && window.kitsTags[tag]) {
        // 共用组件（shell.js 里的侧栏、输入框），每次渲染放回同一个节点，里面的状态不会丢
        out.appendChild(window.kitsTags[tag](node))
      } else if (tag === 'sc-if') {
        if (hole(node.getAttribute('value'), scope)) render(node, scope, out)
      } else if (tag === 'sc-for') {
        const as = node.getAttribute('as') || 'item'
        ;(hole(node.getAttribute('list'), scope) || []).forEach((item, i) =>
          render(node, child(scope, { [as]: item, $index: i }), out))
      } else if (node.hasAttribute('data-for')) {
        // 表格里不能直接放 <sc-for>（浏览器会把它移出表格），所以 <tr> 用属性写法循环
        const as = node.getAttribute('data-as') || 'item'
        ;(hole(node.getAttribute('data-for'), scope) || []).forEach((item, i) =>
          renderElement(node, child(scope, { [as]: item, $index: i }), out))
      } else {
        renderElement(node, scope, out)
      }
    }
  }

  class DCLogic {
    constructor(props) {
      this.props = props || {}
      this.state = {}
    }
    setState(patch) {
      this.state = Object.assign({}, this.state, patch)
      this._render()
    }
  }

  function mount() {
    const tpl = document.querySelector('x-dc')
    const script = document.querySelector('script[type="text/x-dc"]')
    if (!tpl || !script) return
    const helmet = tpl.querySelector('helmet')
    if (helmet) {
      Array.from(helmet.children).forEach((n) => document.head.appendChild(n))
      helmet.remove()
    }
    const Component = new Function('DCLogic', script.textContent + '\nreturn Component;')(DCLogic)
    const instance = new Component({})
    const root = document.createElement('div')
    tpl.replaceWith(root)
    instance._render = () => {
      // 带 data-keep-scroll 的滚动区域重新渲染后回到原来的位置
      const scrolls = {}
      root.querySelectorAll('[data-keep-scroll]').forEach((el) => { scrolls[el.dataset.keepScroll] = el.scrollTop })
      root.replaceChildren()
      render(tpl, instance.renderVals(), root)
      root.querySelectorAll('[data-keep-scroll]').forEach((el) => { el.scrollTop = scrolls[el.dataset.keepScroll] || 0 })
    }
    instance._render()
  }

  document.addEventListener('DOMContentLoaded', mount)
})()
