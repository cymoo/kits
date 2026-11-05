// 所有页面共用的组件：侧栏 <k-nav>、输入框 <k-composer>、⌘K 面板。
// runtime.js 渲染到这两个标签时，放回同一个缓存的节点，所以页面 setState 重新渲染后，
// 侧栏的折叠状态、输入框里没发出去的文字、打开的菜单都不会丢。只为原型服务。
(function () {
  const FONT = "Inter,'PingFang SC','Noto Sans SC',system-ui,sans-serif"
  const MONO = "'JetBrains Mono',ui-monospace,monospace"
  const CSS = `
.kn{position:relative;height:100vh;flex:0 0 var(--k-nav-w,248px);box-sizing:border-box;background:#F1F0EC;border-right:1px solid #E5E4DF;padding:12px 8px 8px;display:flex;flex-direction:column;gap:6px;overflow:hidden;font-family:${FONT};font-size:14px;line-height:1.5;color:#1B1B1F;transition:flex-basis .18s ease}
.kn *{box-sizing:border-box}
.k-rz{position:relative;z-index:20;flex:0 0 0;width:0}
.k-rz::before{content:'';position:absolute;top:0;bottom:0;left:-4px;width:8px;cursor:col-resize}
.k-rz::after{content:'';position:absolute;top:0;bottom:0;left:-1px;width:2px;pointer-events:none;transition:background .12s}
.k-rz:hover::after{background:rgba(54,89,227,.5)}
.kn>.k-rz{position:absolute;top:0;bottom:0;right:4px}
.kn[data-collapsed="true"]>.k-rz{display:none}
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}
::-webkit-scrollbar-thumb{min-height:32px;border:2px solid transparent;border-radius:8px;background:#C9C8C1 padding-box}
::-webkit-scrollbar-thumb:hover{background-color:#9A9AA1}
.kn-top{display:flex;align-items:center;gap:8px;height:32px;padding:0 8px}
.kn-logo{width:20px;height:20px;border-radius:6px;background:#1B1B1F;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex:0 0 auto}
.kn-brand{font-weight:650;font-size:15px;letter-spacing:-.01em;text-decoration:none;color:#1B1B1F}
.kn-icon{width:26px;height:26px;border:0;border-radius:6px;background:transparent;color:#6E6E76;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto}
.kn-icon:hover{background:#E9E8E3;color:#1B1B1F}
.kn-item{display:flex;align-items:center;gap:10px;height:32px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:#1B1B1F;text-decoration:none;font:inherit;cursor:pointer;text-align:left;width:100%}
.kn-item:hover{background:#E9E8E3}
.kn-item.on{background:#E9E8E3;font-weight:500}
.kn-item svg{flex:0 0 auto}
.kn-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kn-kbd{font-size:12px;color:#9A9AA1}
.kn-list{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:2px;margin-top:6px}
.kn-h{font-size:12.5px;color:#8A8A92;padding:8px 8px 4px;font-weight:500}
.kn-list .kn-item{height:30px;gap:8px}
.kn-st{width:7px;height:7px;border-radius:50%;flex:0 0 auto}
.kn-st.run{background:#3659E3;animation:kn-pulse 1.4s ease-in-out infinite}
.kn-st.wait{background:#B4650A}
.kn-st.err{background:#C8381F}
.kn-tag{font-size:12px;flex:0 0 auto;font-weight:400}
.kn-row{position:relative}
.kn-row:hover .kn-item,.kn-row:has(.kn-pin:focus-visible) .kn-item,.kn-row[data-open="true"] .kn-item{background:#E9E8E3;padding-right:32px}
.kn-pin{position:absolute;top:4px;right:4px;width:22px;height:22px;border:0;border-radius:6px;background:transparent;color:#6E6E76;display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0}
.kn-row:hover .kn-pin,.kn-pin:focus-visible,.kn-row[data-open="true"] .kn-pin{opacity:1}
.kn-pin:hover,.kn-row[data-open="true"] .kn-pin{background:#DEDDD8;color:#1B1B1F}
.kn-rename{display:block;box-sizing:border-box;width:100%;height:30px;padding:0 8px;border:1px solid #3659E3;border-radius:8px;background:#FFFFFF;font:inherit;color:#1B1B1F;outline:none;box-shadow:0 0 0 3px rgba(54,89,227,.15)}
.kn-pop{position:fixed;z-index:60;box-sizing:border-box;width:188px;padding:6px;border:1px solid #E5E4DF;border-radius:12px;background:#FFFFFF;box-shadow:0 2px 4px rgba(0,0,0,.04),0 16px 40px rgba(0,0,0,.12);font-size:14px}
.kn-pop hr{margin:5px 2px;border:0;border-top:1px solid #ECEBE7}
.kn-pop button{display:flex;align-items:center;gap:10px;box-sizing:border-box;width:100%;min-height:34px;padding:5px 8px;border:0;border-radius:8px;background:transparent;font:inherit;color:#1B1B1F;text-align:left;cursor:pointer}
.kn-pop button:hover:not(:disabled){background:#F4F3F0}
.kn-pop button.danger{color:#B42318}
.kn-pop button:disabled{cursor:default;color:#B0B0B6}
.kn-pop button span{flex:1;min-width:0}
.kn-pop button small{flex:0 0 auto;font-size:12px;color:#9A9AA1}
.kn-mask{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;background:rgba(27,27,31,.32)}
.kn-dlg{box-sizing:border-box;width:420px;max-width:calc(100% - 48px);padding:20px;border-radius:14px;background:#FFFFFF;color:#1B1B1F;box-shadow:0 24px 64px rgba(0,0,0,.2);font-size:14px;line-height:1.6}
.kn-dlg h2{margin:0 0 6px;font-size:16px;font-weight:600}
.kn-dlg p{margin:0;color:#4A4A52;overflow-wrap:anywhere}
.kn-dlg div{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
.kn-dlg button{height:32px;padding:0 12px;border:1px solid #E5E4DF;border-radius:8px;background:#FFFFFF;font:inherit;color:#1B1B1F;cursor:pointer}
.kn-dlg button.danger{border-color:#B42318;background:#B42318;color:#FFFFFF;font-weight:500}
@keyframes kn-pulse{0%,100%{opacity:1}50%{opacity:.3}}
.kn-foot{display:flex;flex-direction:column;gap:4px;padding-top:6px;border-top:1px solid #E5E4DF}
.kn[data-collapsed="true"]{flex-basis:56px;padding:12px 8px 8px;align-items:center}
.kn[data-collapsed="true"] .kn-label,.kn[data-collapsed="true"] .kn-kbd,.kn[data-collapsed="true"] .kn-list,.kn[data-collapsed="true"] .kn-brand{display:none}
.kn[data-collapsed="true"] .kn-top{flex-direction:column;height:auto;gap:8px;padding:0}
.kn[data-collapsed="true"] .kn-item{width:32px;justify-content:center;padding:0;gap:0}
.kn[data-collapsed="true"] .kn-foot{margin-top:auto;border:0;width:100%;align-items:center}
.kn[data-collapsed="true"] .kn-main{align-items:center}
@media (max-width:860px){.kn{height:auto;flex:1 1 100%;border-right:0;border-bottom:1px solid #E5E4DF}.kn-list{max-height:200px}}

.kc{position:relative;border:1px solid #E5E4DF;border-radius:14px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.03),0 6px 20px rgba(0,0,0,.05);font-family:${FONT};font-size:14px;line-height:1.5;color:#1B1B1F;transition:border-color .12s,box-shadow .12s}
.kc:focus-within{border-color:#C9C8C1;box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 28px rgba(0,0,0,.08)}
.kc.big{border-radius:16px}
.kc textarea{display:block;width:100%;box-sizing:border-box;border:0;resize:none;padding:12px 14px 4px;font:inherit;font-size:15px;line-height:1.6;color:#1B1B1F;background:transparent;outline:none;max-height:220px}
.kc.big textarea{padding:16px 18px 8px;font-size:16px}
.kc textarea::placeholder{color:#A1A1AA}
.kc-bar{display:flex;align-items:center;gap:2px;padding:4px 8px 8px;flex-wrap:wrap}
.kc.big .kc-bar{padding:6px 10px 10px}
.kc-chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px;border:0;border-radius:8px;background:transparent;font:inherit;font-size:13.5px;color:#6E6E76;cursor:pointer;white-space:nowrap}
.kc-chip:hover,.kc-chip[aria-expanded="true"]{background:#EFEEEA;color:#1B1B1F}
.kc-chip svg{flex:0 0 auto}
.kc-send{width:30px;height:30px;margin-left:auto;border:0;border-radius:9px;background:#1B1B1F;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:opacity .12s;flex:0 0 auto}
.kc-send:disabled{opacity:.25;cursor:default}
.kc-menu{position:absolute;left:12px;right:12px;bottom:calc(100% + 8px);background:#fff;border:1px solid #E5E4DF;border-radius:12px;box-shadow:0 2px 4px rgba(0,0,0,.04),0 16px 40px rgba(0,0,0,.12);padding:6px;display:flex;flex-direction:column;gap:1px;max-height:360px;overflow-y:auto;z-index:40}
.kc-menu[hidden]{display:none}
.kc-menu.down{bottom:auto;top:calc(100% + 8px)}
.kc-mh{font-size:12.5px;font-weight:500;color:#8A8A92;padding:6px 10px 4px}
.kc-mi{display:flex;align-items:center;gap:12px;min-height:38px;padding:5px 10px;border:0;border-radius:8px;background:transparent;font:inherit;color:#1B1B1F;cursor:pointer;text-align:left;width:100%}
.kc-mi:hover,.kc-mi.on{background:#F1F4FF}
.kc-mi .cmd{font-family:${MONO};font-size:13.5px;font-weight:500;flex:0 0 120px}
.kc-mi .desc{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kc-mi small{font-size:12.5px;color:#8A8A92}
.kc-mf{display:flex;align-items:center;gap:12px;padding:8px 10px 4px;border-top:1px solid #F0EFEB;margin-top:4px;font-size:12.5px;color:#8A8A92}
.kc-mf a{margin-left:auto;text-decoration:none;color:#3659E3}

.kp{position:fixed;z-index:50;min-width:240px;max-width:320px;background:#fff;border:1px solid #E5E4DF;border-radius:12px;box-shadow:0 2px 4px rgba(0,0,0,.04),0 16px 40px rgba(0,0,0,.12);padding:6px;font-family:${FONT};font-size:14px;line-height:1.5;color:#1B1B1F;box-sizing:border-box}
.kp *{box-sizing:border-box}
.kp[hidden]{display:none}
.kp-h{font-size:12.5px;color:#8A8A92;padding:6px 8px 4px;font-weight:500}
.kp-sep{height:1px;background:#ECEBE7;margin:5px 2px}
.kp-opt{display:flex;align-items:center;gap:10px;width:100%;min-height:34px;padding:5px 8px;border:0;border-radius:8px;background:transparent;font:inherit;color:#1B1B1F;cursor:pointer;text-align:left;text-decoration:none}
.kp-opt:hover{background:#F4F3F0}
.kp-opt small{display:block;font-size:13px;color:#6E6E76}
.kp-opt svg{flex:0 0 auto;color:#6E6E76}
.kp-tick{width:14px;flex:0 0 auto;color:#1B1B1F;visibility:hidden;margin-left:auto}
.kp-opt[aria-checked="true"] .kp-tick{visibility:visible}
.kp-sw{margin-left:auto;width:26px;height:15px;border-radius:8px;background:#D4D4D8;position:relative;flex:0 0 auto;transition:background .12s}
.kp-sw::after{content:'';position:absolute;top:2px;left:2px;width:11px;height:11px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:left .12s}
.kp-opt[aria-checked="true"] .kp-sw{background:#1B1B1F}
.kp-opt[aria-checked="true"] .kp-sw::after{left:13px}
.kp-st{width:7px;height:7px;border-radius:50%;flex:0 0 auto}
.kp-seg{display:flex;padding:2px;background:#F1F0EC;border-radius:8px;gap:2px;margin:2px 6px 6px}
.kp-seg button{flex:1;height:26px;border:0;border-radius:6px;background:transparent;font:inherit;font-size:13px;color:#6E6E76;cursor:pointer}
.kp-seg button[aria-checked="true"]{background:#fff;color:#1B1B1F;font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08)}

.kk{position:fixed;inset:0;z-index:60;background:rgba(27,27,31,.28);display:flex;justify-content:center;align-items:flex-start;padding-top:120px;font-family:${FONT};font-size:14px;line-height:1.5;color:#1B1B1F}
.kk[hidden]{display:none}
.kk *{box-sizing:border-box}
.kk-box{width:640px;max-width:calc(100% - 48px);background:#fff;border-radius:14px;box-shadow:0 4px 8px rgba(0,0,0,.06),0 24px 64px rgba(0,0,0,.22);display:flex;flex-direction:column;overflow:hidden}
.kk-in{display:flex;align-items:center;gap:10px;height:52px;padding:0 16px;border-bottom:1px solid #ECEBE7}
.kk-in input{flex:1;border:0;outline:none;font:inherit;font-size:16px;color:#1B1B1F;background:transparent}
.kk-esc{height:24px;padding:0 8px;border:1px solid #E5E4DF;border-radius:6px;background:#fff;font:inherit;font-size:12px;color:#6E6E76;cursor:pointer}
.kk-list{display:flex;flex-direction:column;gap:1px;padding:6px;max-height:440px;overflow-y:auto}
.kk-h{font-size:12.5px;font-weight:500;color:#8A8A92;padding:6px 10px 4px}
.kk-it{display:flex;align-items:center;gap:12px;min-height:44px;padding:5px 10px;border:0;border-radius:8px;background:transparent;text-decoration:none;color:#1B1B1F;font:inherit;cursor:pointer;text-align:left;width:100%}
.kk-it:hover,.kk-it.on{background:#F1F4FF}
.kk-it .t{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.kk-it .s{font-size:13px;color:#6E6E76;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kk-it .m{font-size:13px;color:#8A8A92;font-family:${MONO};flex:0 0 auto}
.kk-it mark{background:#FBE7A1;color:inherit;border-radius:2px}
.kk-ft{display:flex;align-items:center;gap:12px;padding:8px 16px;border-top:1px solid #ECEBE7;font-size:12.5px;color:#8A8A92}
.kk-empty{padding:28px 16px;text-align:center;color:#6E6E76}
`

  const icon = {
    plus: '<path d="M8 3v10M3 8h10"/>',
    more: '<path d="M3.5 8h.01M8 8h.01M12.5 8h.01" stroke-width="2.2"/>',
    edit: '<path d="M10.5 3 13 5.5 6 12.5l-3 .5.5-3zM9 4.5 11.5 7"/>',
    trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5M6.8 7v3.5M9.2 7v3.5"/>',
    pin: '<path d="M8 11v3.5"/><path d="M5.5 2.5h5l-.5 4 2 2.5v2H4V9l2-2.5z"/>',
    unpin: '<path d="M8 11v3.5"/><path d="M5.5 2.5h5l-.5 4 2 2.5v2H4V9l2-2.5z"/><path d="m2.5 2.5 11 11"/>',
    history: '<path d="M2.5 8a5.5 5.5 0 1 0 1.7-4L2.5 5.6"/><path d="M2.5 2.5v3.1h3.1"/><path d="M8 5v3.2l2.2 1.3"/>',
    search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>',
    sliders: '<path d="M2 4.5h6.5M13 4.5h1M2 11.5h1M7.5 11.5H14"/><circle cx="10.7" cy="4.5" r="1.7"/><circle cx="5.3" cy="11.5" r="1.7"/>',
    folder: '<path d="M2 4.5h4l1.5 1.5H14v7H2z"/>',
    shield: '<path d="M8 2 3 4v4c0 3 2.2 5.2 5 6 2.8-.8 5-3 5-6V4z"/>',
    side: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M6 3v10"/>',
    down: '<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>',
    clip: '<path d="M10.5 5.5 6 10a1.5 1.5 0 0 1-2-2l5-5a3 3 0 0 1 4 4l-5.5 5.5"/>',
    at: '<circle cx="8" cy="8" r="2.5"/><path d="M10.5 8v1a1.8 1.8 0 0 0 3.5 0V8a6 6 0 1 0-2.4 4.8"/>',
    check: '<path d="m3.5 8.5 3 3 6-7"/>',
    up: '<path d="M8 13V3M4 7l4-4 4 4"/>',
    stop: '<rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none"/>',
    file: '<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/>',
    agent: '<path d="M3 13V4.2l2.6 2.2h4.8L13 4.2V13z"/><circle cx="6.3" cy="9.3" r=".7" fill="currentColor" stroke="none"/><circle cx="9.7" cy="9.3" r=".7" fill="currentColor" stroke="none"/>'
  }
  const svg = (name, size = 16, sw = 1.5) =>
    `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${icon[name]}</svg>`
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

  // ---------- 共用的演示数据 ----------
  // 会话列表。href 里的 ?s= 是 session.html 的演示状态
  const convs = [
    ['置顶', [
      ['梳理会员等级规则', 'session.html?s=context', '', '', '…第 30 天当天不降，第 31 天才会降…', 'member-svc']]],
    ['今天', [
      ['给兑换接口加幂等校验', 'session.html?s=streaming', 'run', '', '…把幂等检查抽成了装饰器 @idempotent，两个接口各加一行…', 'member-svc'],
      ['排查订单退款超时', 'session.html?s=question', 'wait', '有提问', '…网关返回 429，代码没有处理，一直重试到超时…', 'order-svc']]],
    ['昨天', [
      ['生成积分模块接口文档', 'session.html?s=error', 'err', '出错', '…文档已经写了前 6 个接口…', 'member-svc'],
      ['接口文档和实现对不上的地方', 'session.html?s=output', '', '', '…找到 7 处不一致，2 处严重…', 'member-svc'],
      ['优惠券过期任务为什么没跑', 'session.html?s=done', '', '', '…cron 表达式的时区写错了…', 'points-web']]],
    ['本周', [
      ['把 order-svc 的日志改成 JSON', 'session.html?s=done', '', '', '…重试要保证幂等，否则日志里会出现重复的 trace…', 'order-svc'],
      ['会员等级是怎么升降的', 'session.html?s=done', '', '', '…按近 12 个月累计消费计算…', 'member-svc']]]
  ]
  const prefs = {
    dir: '~/repo/member-svc', agent: 'assistant', kernel: 'codeagent', model: 'coder-main', perm: 'ask',
    mcp: { 'req-platform': true, wiki: true, gitlab: true, 'defect-tracker': false }
  }
  const dirDefs = [['~/repo/member-svc', 'main'], ['~/repo/order-svc', 'release/1.8'], ['~/repo/points-web', 'main']]
  const agentDefs = [['assistant', '不限定任务的通用 Agent', '内置'], ['api-reviewer', '对照文档和实现，列出不一致', '项目'], ['doc-writer', '给模块和接口补文档', '个人']]
  const mcpDefs = [['req-platform', '需求平台', 'ok'], ['wiki', '知识库', 'ok'], ['gitlab', 'GitLab', 'err'], ['defect-tracker', '缺陷平台', 'ok']]
  const permDefs = {
    ask: ['执行前确认', '改文件直接进行，执行命令和写外部平台前问你'],
    read: ['只读', '只读代码和平台数据，不改文件也不执行命令'],
    auto: ['全部自动', '工作目录内改文件、执行命令都不再询问']
  }
  const kernelDefs = { codeagent: 'CodeAgent', opencode: 'OpenCode' }
  const gatewayDefs = [['公司网关', ['coder-main', 'coder-fast', 'reasoner-pro']], ['内网自建 vLLM', ['qwen-coder-32b']]]
  const commandDefs = [
    ['test', '跑指定目录的测试，失败的归类并给出原因', '项目技能'],
    ['api-testing', '按接口文档生成接口测试，附带正反用例', '项目技能'],
    ['review', '审查当前分支的改动，列出问题和风险', '内置'],
    ['explain', '解释一段代码或一个模块是怎么工作的', '内置'],
    ['doc', '给模块或接口补文档', '个人技能']
  ]
  const refDefs = [
    ['文件', [['src/points/redeem.py', '86 行'], ['tests/points/test_redeem.py', '140 行'], ['src/points/refund.py', '112 行'], ['docs/api/points.md', '212 行']]],
    ['需求平台 · req-platform', [['R-1024 积分兑换优惠券：同一请求号只处理一次', '评审通过'], ['R-1031 兑换失败时的积分返还', '开发中']]]
  ]

  // ---------- 浮层菜单（侧栏和输入框共用一个） ----------
  const pop = document.createElement('div')
  pop.className = 'kp'
  pop.setAttribute('role', 'menu')
  pop.hidden = true
  let openKind = null
  let anchor = null
  const radio = (on, set, val, body) =>
    `<button type="button" class="kp-opt" role="menuitemradio" aria-checked="${on}" data-set="${set}" data-val="${esc(val)}">${body}<span class="kp-tick">${svg('check', 14, 1.8)}</span></button>`

  function popContent(kind) {
    if (kind === 'add') {
      const color = { ok: '#1E7F43', err: '#C8381F' }
      return `<button type="button" class="kp-opt">${svg('clip', 14)}上传文件<small style="margin-left:auto">Word、PDF、Markdown、图片</small></button>` +
        `<button type="button" class="kp-opt" data-insert="@">${svg('at', 14)}引用文件、需求或用例<small style="margin-left:auto">@</small></button>` +
        `<div class="kp-sep"></div><div class="kp-h">本次会话可用的平台</div>` +
        mcpDefs.map(([k, label, st]) => {
          const on = prefs.mcp[k]
          return `<button type="button" class="kp-opt" role="menuitemcheckbox" aria-checked="${on}" data-set="mcp" data-val="${k}"><span class="kp-st" style="background:${on ? color[st] : '#D4D4D8'}"></span><span>${label}${on && st === 'err' ? '<small style="color:#9A2C1F">令牌已过期，到设置里重新授权</small>' : ''}</span><span class="kp-sw"></span></button>`
        }).join('') +
        `<a class="kp-opt" href="settings.html#mcp" style="color:#6E6E76">${svg('sliders', 14)}管理 MCP 服务</a>`
    }
    if (kind === 'dir') {
      return `<div class="kp-h">工作目录</div>` +
        dirDefs.map(([p, b]) => radio(prefs.dir === p, 'dir', p, `<span><span style="font-family:${MONO};font-size:13px">${p}</span><small>${b}</small></span>`)).join('') +
        `<div class="kp-sep"></div><button type="button" class="kp-opt">${svg('folder', 14)}打开其他目录…</button>`
    }
    if (kind === 'agent') {
      return `<div class="kp-h">Agent</div>` +
        agentDefs.map(([id, desc, tag]) => radio(prefs.agent === id, 'agent', id, `<span><span style="font-family:${MONO};font-size:13px">${id}</span><small>${desc} · ${tag}</small></span>`)).join('') +
        `<div class="kp-sep"></div><a class="kp-opt" href="settings.html#agent" style="color:#6E6E76">${svg('sliders', 14)}管理 Agent</a>`
    }
    if (kind === 'perm') {
      return `<div class="kp-h">Agent 执行操作前</div>` +
        Object.keys(permDefs).map((k) => radio(prefs.perm === k, 'perm', k, `<span><span>${permDefs[k][0]}</span><small>${permDefs[k][1]}</small></span>`)).join('')
    }
    if (kind === 'model') {
      return `<div class="kp-seg" role="radiogroup" aria-label="内核">` +
        Object.keys(kernelDefs).map((k) => `<button type="button" role="radio" aria-checked="${prefs.kernel === k}" data-set="kernel" data-val="${k}">${kernelDefs[k]}</button>`).join('') +
        `</div>` +
        gatewayDefs.map(([g, models]) => `<div class="kp-h">${g}</div>` + models.map((m) => radio(prefs.model === m, 'model', m, `<span style="font-family:${MONO};font-size:13px">${m}</span>`)).join('')).join('') +
        `<div class="kp-sep"></div><a class="kp-opt" href="settings.html#model" style="color:#6E6E76">${svg('sliders', 14)}内核与模型设置</a>`
    }
    return ''
  }

  function place() {
    const r = anchor.getBoundingClientRect()
    const w = pop.offsetWidth
    const h = pop.offsetHeight
    let left = Math.min(r.left, innerWidth - w - 8)
    let top = r.top - h - 6 >= 8 ? r.top - h - 6 : r.bottom + 6
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
    agent: () => prefs.agent,
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
    else prefs[set] = val
    refreshChips()
    if (set === 'mcp' || set === 'kernel') pop.innerHTML = popContent(openKind)
    else close()
  })
  document.addEventListener('mousedown', (e) => {
    if (openKind && !pop.contains(e.target) && !anchor.contains(e.target)) close()
  })
  addEventListener('resize', () => { if (openKind) place() })
  addEventListener('scroll', () => { if (openKind) place() }, true)

  // ---------- ⌘K 面板：搜会话、跳转、切目录 ----------
  const palette = document.createElement('div')
  palette.className = 'kk'
  palette.hidden = true
  palette.innerHTML = `
    <div class="kk-box" role="dialog" aria-label="搜索和跳转">
      <div class="kk-in">${svg('search', 16, 1.6)}<label for="kk-input" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">搜索</label><input id="kk-input" type="text" placeholder="搜会话、跳到设置、切换目录…"><button type="button" class="kk-esc" data-close>Esc</button></div>
      <div class="kk-list"></div>
      <div class="kk-ft"><span>↑↓ 选择</span><span>↵ 打开</span><span style="flex:1"></span><span>搜索只在本机进行</span></div>
    </div>`
  const kkInput = palette.querySelector('input')
  const kkList = palette.querySelector('.kk-list')
  const mark = (text, q) => {
    if (!q) return esc(text)
    const i = text.toLowerCase().indexOf(q.toLowerCase())
    if (i < 0) return esc(text)
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length))
  }
  function renderPalette() {
    const q = kkInput.value.trim()
    const rows = []
    convs.forEach(([when, items]) => items.forEach(([title, href, st, tag, snippet, dir]) => {
      if (!q || title.includes(q) || snippet.includes(q)) rows.push({ title, href, st, snippet, meta: dir + ' · ' + when })
    }))
    let html = ''
    if (rows.length) {
      html += `<div class="kk-h">会话 · ${rows.length} 个${q ? '匹配' : ''}</div>` + rows.slice(0, 6).map((r, i) =>
        `<a class="kk-it${i === 0 ? ' on' : ''}" href="${r.href}"><span class="kn-st ${r.st}" style="${r.st ? '' : 'background:transparent'}"></span><span class="t"><span>${mark(r.title, q)}</span><span class="s">${mark(r.snippet, q)}</span></span><span class="m">${esc(r.meta)}</span></a>`).join('')
    } else {
      html += `<div class="kk-empty">没有匹配“${esc(q)}”的会话</div>`
    }
    html += `<div class="kk-h">动作</div>` +
      `<a class="kk-it" href="index.html" style="min-height:36px">${svg('plus', 14, 1.6)}<span class="t"><span>新会话${q ? '：“' + esc(q) + '”' : ''}</span></span><span class="m">⌘N</span></a>` +
      `<a class="kk-it" href="history.html" style="min-height:36px">${svg('search', 14, 1.6)}<span class="t"><span>全部会话</span></span></a>` +
      `<a class="kk-it" href="settings.html#mcp" style="min-height:36px">${svg('sliders', 14)}<span class="t"><span>设置 · MCP 服务</span></span></a>` +
      `<button type="button" class="kk-it" data-close style="min-height:36px">${svg('folder', 14)}<span class="t"><span>切换工作目录到 <span style="font-family:${MONO};font-size:13px">order-svc</span></span></span></button>`
    kkList.innerHTML = html
  }
  function openPalette(preset) {
    if (!palette.isConnected) document.body.appendChild(palette)
    close()
    palette.hidden = false
    kkInput.value = preset || ''
    renderPalette()
    kkInput.focus()
  }
  function closePalette() { palette.hidden = true }
  kkInput.addEventListener('input', renderPalette)
  palette.addEventListener('mousedown', (e) => { if (e.target === palette) closePalette() })
  palette.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closePalette() })
  kkInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const a = kkList.querySelector('a.on') || kkList.querySelector('a'); if (a) location.href = a.getAttribute('href') }
  })
  window.kitsPalette = { open: openPalette, close: closePalette }

  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey
    if (e.key === 'Escape') {
      if (!palette.hidden) { closePalette(); return }
      if (openKind) { const a = anchor; close(); a.focus(); return }
      document.querySelectorAll('.kc-menu:not([hidden])').forEach((m) => { m.hidden = true })
    }
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); palette.hidden ? openPalette() : closePalette() }
    if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); location.href = 'index.html' }
    if (mod && e.key.toLowerCase() === 'b' && nav) { e.preventDefault(); toggleNav() }
    if (mod && e.key === ',') { e.preventDefault(); location.href = 'settings.html' }
  })

  // ---------- 拖动改栏宽 ----------
  // <div class="k-rz" data-w="panel" data-dir="-1">：宽度写在 --k-*-w 上，页面重新渲染也不丢；双击恢复默认
  const WIDTHS = { nav: [248, 200, 360], panel: [380, 300, 720], chat: [400, 320, 640] }
  document.addEventListener('pointerdown', (e) => {
    const h = e.target.closest && e.target.closest('.k-rz')
    if (!h) return
    e.preventDefault()
    const [init, min, max] = WIDTHS[h.dataset.w]
    const name = '--k-' + h.dataset.w + '-w'
    const root = document.documentElement
    const start = parseFloat(root.style.getPropertyValue(name)) || init
    const x0 = e.clientX
    const move = (ev) => root.style.setProperty(name, Math.min(max, Math.max(min, start + (ev.clientX - x0) * Number(h.dataset.dir || 1))) + 'px')
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up) }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  })
  document.addEventListener('dblclick', (e) => {
    const h = e.target.closest && e.target.closest('.k-rz')
    if (h) document.documentElement.style.removeProperty('--k-' + h.dataset.w + '-w')
  })

  // ---------- 侧栏 ----------
  let nav = null
  let autoCollapsed = false
  function setCollapseTitle() {
    const btn = nav.querySelector('[data-act="collapse"]')
    const label = nav.dataset.collapsed === 'true' ? '展开侧栏' : '折叠侧栏'
    btn.setAttribute('aria-label', label)
    btn.title = label + ' ⌘B'
  }
  function toggleNav() {
    const collapsed = nav.dataset.collapsed !== 'true'
    nav.dataset.collapsed = String(collapsed)
    setCollapseTitle()
    // 设置页、放大工作区时侧栏默认收起：这里按折叠按钮只管当前页，不改记住的状态
    if (autoCollapsed) return
    try { localStorage.setItem('kits.nav.collapsed', collapsed ? '1' : '0') } catch (e) {}
  }
  function buildNav(active, forceCollapsed) {
    nav = document.createElement('nav')
    nav.className = 'kn'
    nav.setAttribute('aria-label', '主导航')
    autoCollapsed = forceCollapsed
    let collapsed = forceCollapsed
    if (!forceCollapsed) { try { collapsed = localStorage.getItem('kits.nav.collapsed') === '1' } catch (e) {} }
    nav.dataset.collapsed = String(!!collapsed)
    const here = location.pathname.split('/').pop() + location.search
    nav.innerHTML = `
      <div class="kn-top">
        <span class="kn-logo" aria-hidden="true">k</span><a class="kn-brand" href="index.html">kits</a>
        <span style="flex:1"></span>
        <button type="button" class="kn-icon" data-act="collapse" aria-label="折叠侧栏" title="折叠侧栏 ⌘B">${svg('side', 14)}</button>
      </div>
      <div class="kn-main" style="display:flex;flex-direction:column;gap:4px">
        <a class="kn-item${active === 'new' ? ' on' : ''}" href="index.html" title="新会话 ⌘N">${svg('plus', 15, 1.6)}<span class="kn-label">新会话</span><span class="kn-kbd">⌘N</span></a>
        <button type="button" class="kn-item${active === 'search' ? ' on' : ''}" data-act="search" title="搜索 ⌘K">${svg('search', 15, 1.6)}<span class="kn-label">搜索</span><span class="kn-kbd">⌘K</span></button>
        <a class="kn-item${active === 'history' ? ' on' : ''}" href="history.html" title="全部会话">${svg('history', 15, 1.6)}<span class="kn-label">全部会话</span></a>
      </div>
      <div class="kn-list">
        ${convs.map(([h, items]) => `<div class="kn-h">${h}</div>` + items.map(([title, href, st, tag]) =>
          `<div class="kn-row"><a class="kn-item${href === here ? ' on' : ''}" href="${href}" title="${esc(title)}">${st ? `<span class="kn-st ${st}"></span>` : ''}<span class="kn-label">${esc(title)}</span>${tag ? `<span class="kn-tag" style="color:${st === 'err' ? '#C8381F' : '#B4650A'}">${tag}</span>` : ''}</a><button type="button" class="kn-pin" data-act="more" data-title="${esc(title)}" data-pinned="${h === '置顶'}" data-busy="${st === 'run'}" aria-haspopup="menu" aria-label="“${esc(title)}”的更多操作" title="更多">${svg('more', 14)}</button></div>`).join('')).join('')}
      </div>
      <div class="kn-foot">
        <a class="kn-item${active === 'settings' ? ' on' : ''}" href="settings.html" title="设置 ⌘,">${svg('sliders', 15)}<span class="kn-label">设置</span><span class="kn-kbd">⌘,</span></a>
      </div>
      <div class="k-rz" data-w="nav" title="拖动改宽度，双击恢复"></div>`
    nav.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]')
      if (!t) return
      if (t.dataset.act === 'collapse') toggleNav()
      if (t.dataset.act === 'search') openPalette()
      if (t.dataset.act === 'more') openRowMenu(t)
    })
    // 右键行和点 … 是同一个菜单
    nav.addEventListener('contextmenu', (e) => {
      const more = e.target.closest('.kn-row')?.querySelector('[data-act="more"]')
      if (!more) return
      e.preventDefault()
      openRowMenu(more)
    })
    setCollapseTitle()
    return nav
  }

  // ---------- 侧栏会话的菜单：置顶、重命名、删除 ----------
  function closeRowMenu() {
    document.querySelector('.kn-pop')?.remove()
    document.querySelector('.kn-row[data-open]')?.removeAttribute('data-open')
  }
  function openRowMenu(more) {
    closeRowMenu()
    const row = more.closest('.kn-row')
    const { title, pinned, busy } = more.dataset
    row.dataset.open = 'true'
    const pop = document.createElement('div')
    pop.className = 'kn-pop'
    pop.setAttribute('role', 'menu')
    pop.innerHTML = `
      <button type="button" role="menuitem" data-do="pin">${svg(pinned === 'true' ? 'unpin' : 'pin', 14)}<span>${pinned === 'true' ? '取消置顶' : '置顶'}</span></button>
      <button type="button" role="menuitem" data-do="rename">${svg('edit', 14)}<span>重命名</span></button>
      <hr>
      <button type="button" role="menuitem" data-do="remove" class="danger"${busy === 'true' ? ' disabled' : ''}>${svg('trash', 14)}<span>删除</span>${busy === 'true' ? '<small>运行中</small>' : ''}</button>`
    const box = more.getBoundingClientRect()
    pop.style.left = box.left + 'px'
    pop.style.top = box.bottom + 6 + 'px'
    document.body.appendChild(pop)
    pop.addEventListener('click', (e) => {
      const act = e.target.closest('[data-do]')?.dataset.do
      if (!act) return
      closeRowMenu()
      if (act === 'rename') renameRow(row, title)
      if (act === 'remove') confirmRemove(row, title)
    })
    setTimeout(() => document.addEventListener('click', closeRowMenu, { once: true }))
  }
  // 就地改：回车或点别处保存，Esc 放弃，空的不保存
  function renameRow(row, title) {
    const link = row.querySelector('.kn-item')
    const input = document.createElement('input')
    input.className = 'kn-rename'
    input.value = title
    input.setAttribute('aria-label', '会话标题')
    link.hidden = true
    link.style.display = 'none'
    row.querySelector('.kn-pin').hidden = true
    row.appendChild(input)
    input.select()
    let finished = false
    const done = (save) => {
      if (finished) return
      finished = true
      const value = input.value.trim()
      if (save && value) {
        link.querySelector('.kn-label').textContent = value
        link.title = value
      }
      input.remove()
      link.style.display = ''
      link.hidden = false
      row.querySelector('.kn-pin').hidden = false
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) done(true)
      if (e.key === 'Escape') done(false)
    })
    input.addEventListener('blur', () => done(true))
  }
  function confirmRemove(row, title) {
    const mask = document.createElement('div')
    mask.className = 'kn-mask'
    mask.innerHTML = `<div class="kn-dlg" role="alertdialog" aria-modal="true" aria-label="删除这个会话？"><h2>删除这个会话？</h2><p>“${esc(title)}”的对话记录和附件都会删掉，不能恢复。工作目录里的文件不受影响。</p><div><button type="button" data-do="cancel">取消</button><button type="button" class="danger" data-do="ok">删除</button></div></div>`
    document.body.appendChild(mask)
    mask.querySelector('[data-do="cancel"]').focus()
    mask.addEventListener('click', (e) => {
      const act = e.target.closest('[data-do]')?.dataset.do
      if (e.target !== mask && !act) return
      if (act === 'ok') row.remove()
      mask.remove()
    })
  }

  // ---------- 输入框 ----------
  // <k-composer key="home" placeholder="…" rows="3" big> ；发送时在 document 上派发 kits-send 事件
  const composers = {}
  function buildComposer(key, placeholder, rows, big) {
    const box = document.createElement('div')
    box.className = 'kc' + (big ? ' big' : '')
    box.innerHTML = `
      <div class="kc-menu" role="listbox" hidden></div>
      <label style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)" for="kc-${key}">给 Agent 发消息</label>
      <textarea id="kc-${key}" rows="${rows}" placeholder="${esc(placeholder)}"></textarea>
      <div class="kc-bar">
        <button type="button" class="kc-chip" data-pop="add" aria-haspopup="menu" aria-expanded="false" aria-label="添加文件、引用和平台" title="上传文件、引用需求，管理可用的平台" style="width:28px;padding:0;justify-content:center">${svg('plus', 15, 1.6)}</button>
        <button type="button" class="kc-chip" data-pop="dir" aria-haspopup="menu" aria-expanded="false" title="工作目录">${svg('folder', 13)}<span data-chip="dir" style="font-family:${MONO};font-size:13px">${chipText.dir()}</span></button>
        <button type="button" class="kc-chip" data-pop="agent" aria-haspopup="menu" aria-expanded="false" title="Agent">${svg('agent', 13)}<span data-chip="agent">${chipText.agent()}</span></button>
        <span style="flex:1"></span>
        <button type="button" class="kc-chip" data-pop="perm" aria-haspopup="menu" aria-expanded="false" title="权限">${svg('shield', 13)}<span data-chip="perm">${chipText.perm()}</span></button>
        <button type="button" class="kc-chip" data-pop="model" aria-haspopup="menu" aria-expanded="false" title="内核与模型"><span data-chip="model" style="font-family:${MONO};font-size:13px">${chipText.model()}</span>${svg('down', 12, 1.6)}</button>
        <button type="button" class="kc-send" aria-label="发送" title="发送 ↵" disabled>${svg('up', 14, 1.8)}</button>
      </div>`
    const ta = box.querySelector('textarea')
    const send = box.querySelector('.kc-send')
    const menu = box.querySelector('.kc-menu')
    // 运行中输入框是空的：这个按钮是停止；有文字时是发送（这一轮结束后送出），停止走快捷键
    let running = false
    const paint = () => {
      const stop = running && !ta.value.trim()
      send.disabled = !stop && !ta.value.trim()
      send.innerHTML = svg(stop ? 'stop' : 'up', 14, 1.8)
      send.setAttribute('aria-label', stop ? '停止' : '发送')
      send.title = stop ? '停止 ⌘.' : '发送 ↵'
    }
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 220) + 'px'; paint() }

    // 向上放得下就向上开，放不下看哪边地方大，不顶出窗口
    function placeMenu() {
      const r = box.getBoundingClientRect()
      const above = r.top - 8 - 12
      const below = innerHeight - r.bottom - 16
      const up = above >= 220 || above >= below
      menu.classList.toggle('down', !up)
      menu.style.maxHeight = Math.min(360, up ? above : below) + 'px'
    }

    // 输入 / 列出命令（技能），输入 @ 列出可引用的文件和需求
    function renderMenu() {
      const v = ta.value
      const before = v.slice(0, ta.selectionStart)
      const slash = /^\/(\S*)$/.exec(v)
      const at = /(^|\s)@(\S*)$/.exec(before)
      if (slash) {
        const q = slash[1].toLowerCase()
        const list = commandDefs.filter(([c, d]) => c.includes(q) || d.toLowerCase().includes(q))
        menu.innerHTML = `<div class="kc-mh">命令${q ? ' · 匹配 “' + esc(q) + '”' : ''}</div>` +
          (list.length ? list.map(([c, d, tag], i) => `<button type="button" class="kc-mi${i === 0 ? ' on' : ''}" role="option" data-cmd="${c}"><span class="cmd">/${c}</span><span class="desc">${d}</span><small>${tag}</small></button>`).join('') : `<div class="kc-mh">没有匹配的命令</div>`) +
          `<div class="kc-mf"><span>↑↓ 选择</span><span>↵ 填入</span><span>Esc 关闭</span><a href="settings.html#skills">管理技能</a></div>`
        menu.hidden = false
      } else if (at) {
        const q = at[2].toLowerCase()
        menu.innerHTML = refDefs.map(([h, items]) => {
          const list = items.filter(([t]) => !q || t.toLowerCase().includes(q))
          return list.length ? `<div class="kc-mh">${h}</div>` + list.map(([t, m]) => `<button type="button" class="kc-mi" role="option" data-ref="${esc(t.split(' ')[0])}" style="min-height:34px">${svg('file', 13)}<span class="desc" style="font-family:${MONO};font-size:13px">${esc(t)}</span><small>${m}</small></button>`).join('') : ''
        }).join('') +
          `<button type="button" class="kc-mi" role="option" style="min-height:34px">${svg('clip', 13)}<span class="desc">上传文件…</span><small>Word、PDF、Markdown、图片</small></button>` +
          `<div class="kc-mf"><span>↑↓ 选择</span><span>↵ 引用</span><span>Esc 关闭</span></div>`
        menu.hidden = false
      } else {
        menu.hidden = true
      }
      if (!menu.hidden) placeMenu()
    }
    menu.addEventListener('click', (e) => {
      const t = e.target.closest('[data-cmd],[data-ref]')
      if (!t) return
      if (t.dataset.cmd) ta.value = '/' + t.dataset.cmd + ' '
      else ta.value = ta.value.slice(0, ta.selectionStart).replace(/@\S*$/, '@' + t.dataset.ref + ' ') + ta.value.slice(ta.selectionStart)
      menu.hidden = true
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
      grow()
    })

    const submit = () => {
      const text = ta.value.trim()
      if (!text) return
      ta.value = ''
      grow()
      menu.hidden = true
      document.dispatchEvent(new CustomEvent('kits-send', { detail: { key, text } }))
    }
    ta.addEventListener('input', () => { grow(); renderMenu() })
    ta.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow')) renderMenu() })
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        const on = menu.hidden ? null : menu.querySelector('.kc-mi.on, .kc-mi')
        if (on) on.click(); else submit()
      }
    })
    send.addEventListener('click', submit)
    box.addEventListener('click', (e) => {
      const t = e.target.closest('[data-pop]')
      if (t) open(t.dataset.pop, t)
    })
    box.setRunning = (on) => { running = on; paint() }
    box.fill = (text) => { ta.value = text; grow(); ta.focus(); ta.setSelectionRange(text.length, text.length); renderMenu() }
    return box
  }

  let styled = false
  const style = () => { if (!styled) { styled = true; document.head.insertAdjacentHTML('beforeend', `<style>${CSS}</style>`) } }

  window.kitsTags = {
    'k-nav': (node) => { style(); return nav || buildNav(node.getAttribute('active'), node.hasAttribute('collapsed')) },
    'k-composer': (node, read) => {
      style()
      const key = node.getAttribute('key') || 'main'
      const box = composers[key] || (composers[key] = buildComposer(key, node.getAttribute('placeholder') || '给 Agent 发消息', node.getAttribute('rows') || 1, node.hasAttribute('big')))
      box.setRunning(node.hasAttribute('running') && read(node.getAttribute('running')) === true)
      return box
    }
  }
  // 页面里的建议按钮用它把文字放进输入框
  window.kitsFill = (key, text) => { if (composers[key]) composers[key].fill(text) }
  window.kitsPrefs = prefs
})()
