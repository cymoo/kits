---
name: prototype-first
description: 界面改动先改原型再写代码。凡是要新增或修改页面、面板、卡片、设置项等界面元素时使用；保证 designs/app 和代码不脱节。
---

# 原型先行

界面改动先改原型，看过没问题再写页面。不要跳过原型直接改代码，也不要让代码和原型长期不一致。

## 判断

- 改的是现有页面的布局、文案、控件、状态 → 直接改 `designs/app/` 里对应的页面。
- 新页面、新流程、拿不准的交互 → 先在 `designs/explore/<YYYY-MM-DD>-<slug>/` 用 `claude-design` 技能画画板，评审过了再并入 `designs/app/`，探索目录可以删。
- 纯逻辑改动（内核、配置、存储）不涉及界面 → 不用改原型。

## 步骤

1. 打开对应原型页面（`index.html` 首页、`session.html` 会话、`task.html` 测试任务、`settings.html` 设置）。侧栏和输入框只在 `shell.js` 里改。
2. 只画必要的状态：空、加载、正常、出错。不堆功能。
3. 本地预览：`python3 -m http.server 8765 --directory designs/app`，或 Claude Code 的 `app` 预览配置。截图或让人看一眼。
4. 评审结论写回需求（issue 或交付说明的“原始需求”）。
5. 再写代码。原型没画到的细节按原型的风格补，并在交付说明的“主要改动”里写明。

## 规则

- `designs/app/` 只有一份产品原型，不留废弃页面。
- 原型页面统一引 `runtime.js` 和 `shell.js`。
- 原型是给人看的，不是产品代码，不要往里加业务逻辑。
