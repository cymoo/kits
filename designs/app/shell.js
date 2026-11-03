// 所有页面共用的组件：侧栏 <k-nav> 和输入框 <k-composer>。
// runtime.js 渲染到这两个标签时，放回同一个缓存的节点，所以页面 setState 重新渲染后，
// 侧栏的折叠状态、输入框里没发出去的文字、打开的菜单都不会丢。只为原型服务。
(function () {
  const FONT = "Inter,'PingFang SC','Noto Sans SC',system-ui,sans-serif"
  const MONO = "'JetBrains Mono',ui-monospace,monospace"
  const CSS = `
.kn{position:sticky;top:0;height:100vh;flex:0 0 244px;box-sizing:border-box;background:#F4F4F1;border-right:1px solid #E7E7E2;padding:12px 8px 8px;display:flex;flex-direction:column;gap:8px;overflow:hidden;font-family:${FONT};font-size:13px;line-height:1.5;color:#18181B;transition:flex-basis .18s ease}
.kn *{box-sizing:border-box}
.kn-top{display:flex;align-items:center;gap:8px;height:22px;padding:0 6px 0 8px}
.kn-dot{width:12px;height:12px;border-radius:50%}
.kn-brand{display:flex;align-items:center;gap:8px;height:32px;padding:0 8px;margin-top:4px;text-decoration:none;color:#18181B;font-weight:650;font-size:15px;letter-spacing:-.01em}
.kn-logo{width:22px;height:22px;border-radius:6px;background:#18181B;color:#fff;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.kn-icon{width:28px;height:28px;border:0;border-radius:7px;background:transparent;color:#71717A;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto;text-decoration:none}
.kn-icon:hover{background:#E8E8E3;color:#18181B}
.kn-item{display:flex;align-items:center;gap:10px;height:32px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:#27272A;text-decoration:none;font:inherit;cursor:pointer;text-align:left;width:100%}
.kn-item:hover{background:#E8E8E3}
.kn-item.on{background:#E8E8E3;color:#18181B;font-weight:500}
.kn-item svg{flex:0 0 auto;color:#52525B}
.kn-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kn-kbd{font-size:11px;color:#A1A1AA;opacity:0;transition:opacity .1s}
.kn-item:hover .kn-kbd{opacity:1}
.kn-list{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:1px;margin-top:8px}
.kn-h{font-size:11.5px;color:#8A8A92;padding:10px 8px 4px;font-weight:500}
.kn-list .kn-item{height:30px;color:#3F3F46}
.kn-list .kn-item.on{color:#18181B}
.kn-st{width:7px;height:7px;border-radius:50%;flex:0 0 auto}
.kn-st.run{background:#2F54EB;animation:kn-pulse 1.4s ease-in-out infinite}
.kn-st.wait{background:#E39B1A}
@keyframes kn-pulse{0%,100%{opacity:1}50%{opacity:.3}}
.kn-foot{display:flex;flex-direction:column;gap:1px;padding-top:6px;border-top:1px solid #E7E7E2}
.kn-user{flex:1;min-width:0;display:flex;align-items:center;gap:8px;height:36px;padding:0 6px;border:0;border-radius:8px;background:transparent;font:inherit;color:#18181B;cursor:pointer;text-align:left}
.kn-user:hover,.kn-user[aria-expanded="true"]{background:#E8E8E3}
.kn-avatar{width:26px;height:26px;border-radius:50%;background:#4F46E5;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:12px;flex:0 0 auto}
.kn[data-collapsed="true"]{flex-basis:56px}
.kn[data-collapsed="true"] .kn-label,.kn[data-collapsed="true"] .kn-kbd,.kn[data-collapsed="true"] .kn-list,.kn[data-collapsed="true"] .kn-brand span:last-child,.kn[data-collapsed="true"] .kn-dot{display:none}
.kn[data-collapsed="true"] .kn-item,.kn[data-collapsed="true"] .kn-user,.kn[data-collapsed="true"] .kn-brand,.kn[data-collapsed="true"] .kn-top{justify-content:center;padding:0}
.kn[data-collapsed="true"] .kn-foot{margin-top:auto}
@media (max-width:860px){.kn{position:static;height:auto;flex:1 1 100%;border-right:0;border-bottom:1px solid #E7E7E2}.kn-list{max-height:200px}}

.kc{position:relative;border:1px solid #E3E3DE;border-radius:16px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.03),0 6px 24px rgba(0,0,0,.05);font-family:${FONT};font-size:13px;line-height:1.5;color:#18181B;transition:border-color .12s,box-shadow .12s}
.kc:focus-within{border-color:#C9C9C3;box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 28px rgba(0,0,0,.08)}
.kc textarea{display:block;width:100%;box-sizing:border-box;border:0;resize:none;padding:14px 16px 6px;font:inherit;font-size:14.5px;line-height:1.6;color:#18181B;background:transparent;outline:none;max-height:220px}
.kc textarea::placeholder{color:#A1A1AA}
.kc-bar{display:flex;align-items:center;gap:2px;padding:6px 8px 8px}
.kc-chip{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 8px;border:0;border-radius:8px;background:transparent;font:inherit;font-size:12.5px;color:#52525B;cursor:pointer;white-space:nowrap}
.kc-chip:hover,.kc-chip[aria-expanded="true"]{background:#F1F1EE;color:#18181B}
.kc-chip svg{flex:0 0 auto}
.kc-send{width:32px;height:32px;margin-left:4px;border:0;border-radius:10px;background:#18181B;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:opacity .12s}
.kc-send:disabled{opacity:.25;cursor:default}

.kp{position:fixed;z-index:50;min-width:240px;max-width:300px;background:#fff;border:1px solid #E3E3DE;border-radius:12px;box-shadow:0 2px 4px rgba(0,0,0,.04),0 16px 40px rgba(0,0,0,.12);padding:6px;font-family:${FONT};font-size:13px;line-height:1.5;color:#18181B;box-sizing:border-box}
.kp *{box-sizing:border-box}
.kp[hidden]{display:none}
.kp-h{font-size:11.5px;color:#8A8A92;padding:6px 8px 4px;font-weight:500}
.kp-sep{height:1px;background:#ECECE8;margin:5px 2px}
.kp-opt{display:flex;align-items:center;gap:10px;width:100%;min-height:34px;padding:5px 8px;border:0;border-radius:8px;background:transparent;font:inherit;color:#18181B;cursor:pointer;text-align:left;text-decoration:none}
.kp-opt:hover{background:#F4F4F1;color:#18181B}
.kp-opt small{display:block;font-size:12px;color:#71717A}
.kp-opt svg{flex:0 0 auto;color:#52525B}
.kp-tick{width:14px;flex:0 0 auto;color:#18181B;visibility:hidden}
.kp-opt[aria-checked="true"] .kp-tick{visibility:visible}
.kp-sw{margin-left:auto;width:26px;height:15px;border-radius:8px;background:#D4D4D8;position:relative;flex:0 0 auto;transition:background .12s}
.kp-sw::after{content:'';position:absolute;top:2px;left:2px;width:11px;height:11px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:left .12s}
.kp-opt[aria-checked="true"] .kp-sw{background:#18181B}
.kp-opt[aria-checked="true"] .kp-sw::after{left:13px}
.kp-st{width:7px;height:7px;border-radius:50%;flex:0 0 auto}
.kp-seg{display:flex;padding:2px;background:#F1F1EE;border-radius:8px;gap:2px;margin:2px 6px 6px}
.kp-seg button{flex:1;height:26px;border:0;border-radius:6px;background:transparent;font:inherit;font-size:12px;color:#52525B;cursor:pointer}
.kp-seg button[aria-checked="true"]{background:#fff;color:#18181B;font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.kp-id{display:flex;gap:10px;align-items:center;padding:8px 8px 6px}
.kp-id .kn-avatar{width:34px;height:34px;font-size:14px}
`

  const icon = {
    plus: '<path d="M8 3v10M3 8h10"/>',
    edit: '<path d="M10.5 2.8 13.2 5.5 6 12.7H3.3V10z"/>',
    search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>',
    gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6"/>',
    folder: '<path d="M2 4.5h4l1.5 1.5H14v7H2z"/>',
    shield: '<path d="M8 2 3 4v4c0 3 2.2 5.2 5 6 2.8-.8 5-3 5-6V4z"/>',
    side: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M6 3v10"/>',
    down: '<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>',
    out: '<path d="M9.5 3H13v10H9.5M6.5 5 3.5 8l3 3M3.5 8h7"/>',
    clip: '<path d="M10.5 5.5 6 10a1.5 1.5 0 0 1-2-2l5-5a3 3 0 0 1 4 4l-5.5 5.5"/>',
    at: '<circle cx="8" cy="8" r="2.5"/><path d="M10.5 8v1a1.8 1.8 0 0 0 3.5 0V8a6 6 0 1 0-2.4 4.8"/>',
    check: '<path d="m3.5 8.5 3 3 6-7"/>',
    up: '<path d="M8 13V3M4 7l4-4 4 4"/>'
  }
  const svg = (name, size = 16, sw = 1.5) =>
    `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${icon[name]}</svg>`
  const cat = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M3 13V4.2l2.6 2.2h4.8L13 4.2V13z"/><circle cx="6.3" cy="9.3" r=".7" fill="currentColor" stroke="none"/><circle cx="9.7" cy="9.3" r=".7" fill="currentColor" stroke="none"/></svg>'
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

  // 测试任务和普通会话都是和 Agent 的对话，放在同一个列表里
  const convs = [
    ['今天', [
      ['积分兑换优惠券测试', 'task.html?task=points', 'wait', '用例等你审核'],
      ['订单部分退款回归', 'task.html?task=refund', 'run', '执行中'],
      ['给兑换接口加幂等校验', 'session.html', 'wait', '有命令等你确认']]],
    ['昨天', [
      ['积分模块冒烟', 'task.html?task=smoke', '', ''],
      ['排查订单退款超时', 'session.html?id=2', '', '']]],
    ['本周', [
      ['生成积分模块接口文档', 'session.html?id=3', '', ''],
      ['梳理会员等级规则', 'session.html?id=4', '', '']]]
  ]
  const user = { name: '林晓', initial: '林', email: 'lin.xiao@corp.example' }

  const prefs = {
    dir: '~/repo/member-svc', kernel: 'codeagent', model: 'coder-main', perm: 'ask',
    mcp: { 'req-platform': true, 'case-platform': true, wiki: true, gitlab: true, 'defect-tracker': false }
  }
  const dirDefs = [['~/repo/member-svc', 'main'], ['~/repo/order-svc', 'release/1.8'], ['~/repo/points-web', 'main']]
  const mcpDefs = [['req-platform', '需求平台', 'ok'], ['case-platform', '用例平台', 'ok'], ['wiki', '知识库', 'ok'], ['gitlab', 'GitLab', 'err'], ['defect-tracker', '缺陷平台', 'ok']]
  const permDefs = {
    ask: ['执行前确认', '改文件直接进行，执行命令和写外部平台前问你'],
    read: ['只读', '只读代码和平台数据，不改文件也不执行命令'],
    auto: ['全部自动', '工作目录内改文件、执行命令都不再询问']
  }
  const modelDefs = { codeagent: ['CodeAgent', ['coder-main', 'coder-fast', 'reasoner-pro']], opencode: ['OpenCode', ['coder-main', 'qwen-coder-32b']] }

  // ---------- 浮层菜单（侧栏和输入框共用一个） ----------
  const pop = document.createElement('div')
  pop.className = 'kp'
  pop.setAttribute('role', 'menu')
  pop.hidden = true
  let openKind = null
  let anchor = null
  const radio = (on, set, val, body) =>
    `<button type="button" class="kp-opt" role="menuitemradio" aria-checked="${on}" data-set="${set}" data-val="${esc(val)}">${body}<span class="kp-tick" style="margin-left:auto">${svg('check', 14, 1.8)}</span></button>`

  function popContent(kind) {
    if (kind === 'user') {
      return `<div class="kp-id"><span class="kn-avatar">${user.initial}</span><span style="min-width:0"><span style="font-weight:600">${user.name}</span><small style="display:block;font-size:12px;color:#71717A">${user.email}</small></span></div>` +
        `<div style="font-size:12px;color:#71717A;padding:0 8px 6px">通过公司 SSO 登录</div><div class="kp-sep"></div>` +
        `<a class="kp-opt" href="settings.html">${svg('gear', 14)}设置<small style="margin-left:auto">⌘,</small></a>` +
        `<button type="button" class="kp-opt">${svg('out', 14)}退出登录</button>`
    }
    if (kind === 'add') {
      const color = { ok: '#16A34A', err: '#DC2626' }
      return `<button type="button" class="kp-opt">${svg('clip', 14)}上传文件<small style="margin-left:auto">需求文档、截图、日志</small></button>` +
        `<button type="button" class="kp-opt" data-insert="@">${svg('at', 14)}引用需求、用例或文件<small style="margin-left:auto">@</small></button>` +
        `<div class="kp-sep"></div><div class="kp-h">可用的平台</div>` +
        mcpDefs.map(([k, label, st]) => {
          const on = prefs.mcp[k]
          return `<button type="button" class="kp-opt" role="menuitemcheckbox" aria-checked="${on}" data-set="mcp" data-val="${k}"><span class="kp-st" style="background:${on ? color[st] : '#D4D4D8'}"></span><span>${label}${on && st === 'err' ? '<small style="color:#B91C1C">令牌已过期，点设置里重新授权</small>' : ''}</span><span class="kp-sw"></span></button>`
        }).join('') +
        `<a class="kp-opt" href="settings.html#mcp" style="color:#52525B">${svg('gear', 14)}管理平台连接</a>`
    }
    if (kind === 'dir') {
      return `<div class="kp-h">工作目录</div>` +
        dirDefs.map(([p, b]) => radio(prefs.dir === p, 'dir', p, `<span><span style="font-family:${MONO};font-size:12px">${p}</span><small>${b}</small></span>`)).join('') +
        `<div class="kp-sep"></div><button type="button" class="kp-opt">${svg('folder', 14)}打开其他目录…</button>`
    }
    if (kind === 'perm') {
      return `<div class="kp-h">Agent 执行操作前</div>` +
        Object.keys(permDefs).map((k) => radio(prefs.perm === k, 'perm', k, `<span><span>${permDefs[k][0]}</span><small>${permDefs[k][1]}</small></span>`)).join('')
    }
    if (kind === 'model') {
      return `<div class="kp-seg" role="radiogroup" aria-label="内核">` +
        Object.keys(modelDefs).map((k) => `<button type="button" role="radio" aria-checked="${prefs.kernel === k}" data-set="kernel" data-val="${k}">${modelDefs[k][0]}</button>`).join('') +
        `</div>` + modelDefs[prefs.kernel][1].map((m) => radio(prefs.model === m, 'model', m, `<span style="font-family:${MONO};font-size:12px">${m}</span>`)).join('') +
        `<div class="kp-sep"></div><a class="kp-opt" href="settings.html#model" style="color:#52525B">${svg('gear', 14)}内核与模型设置</a>`
    }
    return ''
  }

  function place() {
    const r = anchor.getBoundingClientRect()
    const w = pop.offsetWidth
    const h = pop.offsetHeight
    let left, top
    if (anchor.closest('.kn')) {
      left = anchor.closest('.kn').getBoundingClientRect().right + 8
      top = Math.min(r.top, innerHeight - h - 8)
      if (left + w > innerWidth - 8) { left = Math.max(8, r.left); top = r.top - h - 6 }
    } else {
      left = Math.min(r.left, innerWidth - w - 8)
      top = r.top - h - 6 >= 8 ? r.top - h - 6 : r.bottom + 6
    }
    pop.style.left = Math.max(8, left) + 'px'
    pop.style.top = Math.max(8, top) + 'px'
  }
  function close() {
    if (anchor) anchor.setAttribute('aria-expanded', 'false')
    pop.hidden = true
    openKind = null
    anchor = null
  }
  function open(kind, el) {
    if (anchor === el) return close()
    close()
    if (!pop.isConnected) document.body.appendChild(pop)
    openKind = kind
    anchor = el
    el.setAttribute('aria-expanded', 'true')
    pop.innerHTML = popContent(kind)
    pop.hidden = false
    place()
  }

  const chipText = {
    dir: () => prefs.dir.split('/').pop(),
    perm: () => permDefs[prefs.perm][0],
    model: () => prefs.model
  }
  function refreshChips() {
    document.querySelectorAll('[data-chip]').forEach((el) => { el.textContent = chipText[el.dataset.chip]() })
  }

  pop.addEventListener('click', (e) => {
    const ins = e.target.closest('[data-insert]')
    if (ins) {
      const ta = anchor && anchor.closest('.kc') && anchor.closest('.kc').querySelector('textarea')
      close()
      if (ta) { ta.focus(); ta.setRangeText(ins.dataset.insert, ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')) }
      return
    }
    const t = e.target.closest('[data-set]')
    if (!t) return
    const { set, val } = t.dataset
    if (set === 'mcp') prefs.mcp[val] = !prefs.mcp[val]
    else if (set === 'kernel') { prefs.kernel = val; prefs.model = modelDefs[val][1][0] }
    else prefs[set] = val
    refreshChips()
    if (set === 'mcp' || set === 'kernel') pop.innerHTML = popContent(openKind)
    else close()
  })
  document.addEventListener('mousedown', (e) => {
    if (openKind && !pop.contains(e.target) && !anchor.contains(e.target)) close()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openKind) { const a = anchor; close(); a.focus() }
  })
  addEventListener('resize', () => { if (openKind) place() })
  addEventListener('scroll', () => { if (openKind) place() }, true)

  // ---------- 侧栏 ----------
  let nav = null
  function buildNav(active) {
    nav = document.createElement('nav')
    nav.className = 'kn'
    nav.setAttribute('aria-label', '主导航')
    let collapsed = false
    try { collapsed = localStorage.getItem('kits.nav.collapsed') === '1' } catch (e) {}
    nav.dataset.collapsed = String(collapsed)
    const here = location.pathname.split('/').pop() + location.search
    // 刚从首页发起的测试任务还不在列表里，临时放在最上面
    const fresh = active === 'task' && !new URLSearchParams(location.search).get('task')
    nav.innerHTML = `
      <div class="kn-top">
        <span class="kn-dot" style="background:#FF5F57"></span><span class="kn-dot" style="background:#FEBC2E"></span><span class="kn-dot" style="background:#28C840"></span>
        <span style="flex:1"></span>
        <button type="button" class="kn-icon" data-act="collapse" aria-label="折叠侧栏" title="折叠侧栏 ⌘B">${svg('side', 15)}</button>
      </div>
      <a class="kn-brand" href="index.html"><span class="kn-logo">${cat}</span><span>kits</span></a>
      <div style="display:flex;flex-direction:column;gap:1px">
        <a class="kn-item${active === 'new' ? ' on' : ''}" href="index.html" title="新对话">${svg('edit')}<span class="kn-label">新对话</span><span class="kn-kbd">⌘N</span></a>
        <button type="button" class="kn-item" title="搜索">${svg('search')}<span class="kn-label">搜索</span><span class="kn-kbd">⌘K</span></button>
      </div>
      <div class="kn-list">
        ${convs.map(([group, items], gi) => `
          <div class="kn-h">${group}</div>
          ${gi === 0 && fresh ? `<a class="kn-item on" href="${esc(here)}"><span class="kn-label">${esc(document.title)}</span></a>` : ''}
          ${items.map(([title, href, st, tip]) => `
            <a class="kn-item${!fresh && here === href ? ' on' : ''}" href="${href}"${tip ? ` title="${tip}"` : ''}>
              <span class="kn-label">${esc(title)}</span>${st ? `<span class="kn-st ${st}" aria-label="${tip}"></span>` : ''}
            </a>`).join('')}`).join('')}
      </div>
      <div class="kn-foot">
        <a class="kn-item${active === 'settings' ? ' on' : ''}" href="settings.html" title="设置">${svg('gear')}<span class="kn-label">设置</span><span class="kn-kbd">⌘,</span></a>
        <button type="button" class="kn-user" data-pop="user" aria-haspopup="menu" aria-expanded="false" title="${user.name}">
          <span class="kn-avatar">${user.initial}</span><span class="kn-label">${user.name}</span>
        </button>
      </div>`
    nav.addEventListener('click', (e) => {
      const t = e.target.closest('[data-pop],[data-act]')
      if (!t) return
      if (t.dataset.act === 'collapse') {
        close()
        const v = nav.dataset.collapsed !== 'true'
        nav.dataset.collapsed = String(v)
        try { localStorage.setItem('kits.nav.collapsed', v ? '1' : '0') } catch (err) {}
        return
      }
      open(t.dataset.pop, t)
    })
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); nav.querySelector('[data-act="collapse"]').click() }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); location.href = 'settings.html' }
    })
    return nav
  }

  // ---------- 输入框 ----------
  // <k-composer key="home" placeholder="…" rows="3"> ；发送时在 document 上派发 kits-send 事件
  const composers = {}
  function buildComposer(key, placeholder, rows) {
    const box = document.createElement('div')
    box.className = 'kc'
    box.innerHTML = `
      <label style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)" for="kc-${key}">给 Agent 发消息</label>
      <textarea id="kc-${key}" rows="${rows}" placeholder="${esc(placeholder)}"></textarea>
      <div class="kc-bar">
        <button type="button" class="kc-chip" data-pop="add" aria-haspopup="menu" aria-expanded="false" aria-label="添加内容和平台" title="添加文件、引用需求，管理可用的平台" style="width:30px;padding:0;justify-content:center">${svg('plus', 16)}</button>
        <button type="button" class="kc-chip" data-pop="dir" aria-haspopup="menu" aria-expanded="false" title="工作目录">${svg('folder', 14)}<span data-chip="dir" style="font-family:${MONO};font-size:12px">${chipText.dir()}</span></button>
        <span style="flex:1"></span>
        <button type="button" class="kc-chip" data-pop="perm" aria-haspopup="menu" aria-expanded="false" title="权限">${svg('shield', 14)}<span data-chip="perm">${chipText.perm()}</span></button>
        <button type="button" class="kc-chip" data-pop="model" aria-haspopup="menu" aria-expanded="false" title="内核与模型"><span data-chip="model">${chipText.model()}</span>${svg('down', 12)}</button>
        <button type="button" class="kc-send" aria-label="发送" title="发送 ↵" disabled>${svg('up', 15, 1.8)}</button>
      </div>`
    const ta = box.querySelector('textarea')
    const send = box.querySelector('.kc-send')
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 220) + 'px'; send.disabled = !ta.value.trim() }
    const submit = () => {
      const text = ta.value.trim()
      if (!text) return
      ta.value = ''
      grow()
      document.dispatchEvent(new CustomEvent('kits-send', { detail: { key, text } }))
    }
    ta.addEventListener('input', grow)
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit() }
    })
    send.addEventListener('click', submit)
    box.addEventListener('click', (e) => {
      const t = e.target.closest('[data-pop]')
      if (t) open(t.dataset.pop, t)
    })
    box.fill = (text) => { ta.value = text; grow(); ta.focus(); ta.setSelectionRange(text.length, text.length) }
    return box
  }

  let styled = false
  const style = () => { if (!styled) { styled = true; document.head.insertAdjacentHTML('beforeend', `<style>${CSS}</style>`) } }

  window.kitsTags = {
    'k-nav': (node) => { style(); return nav || buildNav(node.getAttribute('active')) },
    'k-composer': (node) => {
      style()
      const key = node.getAttribute('key') || 'main'
      return composers[key] || (composers[key] = buildComposer(key, node.getAttribute('placeholder') || '给 Agent 发消息', node.getAttribute('rows') || 1))
    }
  }
  // 页面里的建议按钮用它把文字放进输入框
  window.kitsFill = (key, text) => { if (composers[key]) composers[key].fill(text) }
})()
