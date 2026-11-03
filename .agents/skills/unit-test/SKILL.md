---
name: unit-test
description: 用 Vitest 写单元测试的约定：放哪、测什么、怎么命名、怎么跑。写新逻辑、修 bug、或 PR 缺测试时使用。
---

# 单元测试

UT 和代码一起提交。没有测试的 PR 不合。

## 放哪

- 文件放在被测代码旁边：`foo.ts` → `foo.test.ts`。
- 每个包有自己的 `vitest.config.ts`（`defineProject`），根目录的 `vitest.config.ts` 用 `projects` 把它们串起来。
- 根目录跑全部：`pnpm test`；只跑一个包：`pnpm vitest run --project core`。
- `apps/desktop` 里用到 `node:sqlite` 的测试需要 Node 24（`.node-version`）。

## 测什么

重点覆盖纯逻辑，不测界面细节：

- 配置转换：统一配置 → CodeAgent / OpenCode 格式。
- JSON Schema 校验（`submit_output`）。
- SSE 事件映射：内核事件 → `KernelEvent`。
- JUnit XML 解析、产出格式。
- 路径和权限判断（工作目录内外、Windows 路径）。

不测的：React 组件的渲染细节、Electron 的窗口行为（交给 E2E）、真实模型（用 mock 或录制的事件流）。

## 怎么写

- 一个用例只验一件事，名字写成一句话：`maps tool.start to a running tool part`、`rejects a server with neither command nor url`。
- `describe` 用被测函数名或模块名。
- 修 bug 先写能复现的测试，看着它红，再改代码。
- 测试里不调真实模型、不连真实 MCP；内核用 mock 事件流，MCP 用内存 transport。
- 跨平台：不要在断言里写死 `/` 分隔符或 `darwin`，用 `path.join` 和 `process.platform`。

## 契约测试

内核适配器对 OpenCode 跑契约测试：启动真实的 `opencode serve`（`opencode-ai` 开发依赖自带二进制）加 mock 模型，验证公共接口的行为。CodeAgent 行为不一致的地方先记核对清单，再补用例。
