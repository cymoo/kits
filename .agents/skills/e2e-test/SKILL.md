---
name: e2e-test
description: 用 Playwright 写 Electron 端到端测试的约定：覆盖主流程、怎么启动应用、怎么定位元素。改动主流程或新增页面时使用。
---

# E2E 测试

E2E 放在 `e2e/`，用 Playwright 直接启动打包前的 Electron 应用（`apps/desktop/out`）。只覆盖主流程，不测细节。

## 跑

```bash
pnpm build
pnpm test:e2e
```

CI 在 macOS 和 Windows 上各跑一遍。

## 覆盖什么

主流程一条链：配置模型 → 新建会话 → 流式回复 → 确认工具调用 → 查看改动 → 导出产出。测试工作台跑通一条链。

不用 E2E 测：单个组件的状态、样式、边界输入。这些放单测。

## 怎么写

- 一个 spec 一条流程，文件名说清楚：`session-stream.spec.ts`、`settings-mcp.spec.ts`。
- 启动方式照 `e2e/tests/smoke.spec.ts`：`_electron.launch({ args: [main] })`，`app.firstWindow()`。
- 定位元素优先用角色和文案（`getByRole`、`getByText`），需要时加 `data-testid`。
- 不调真实模型：通过环境变量让主进程用 mock 内核或录制的事件流（会话模块做好后在这里补具体变量名）。
- 每个测试自己启动和关闭应用，不共享状态；用户数据目录指向临时目录。
- 等待用 `expect(...).toBeVisible()` 这类自动重试的断言，不用 `waitForTimeout`。

## 排查

失败时 `e2e/test-results/` 里有 trace：`pnpm --filter @kits/e2e exec playwright show-trace <trace.zip>`。
