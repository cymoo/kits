# 交付说明：工程骨架

> 日期：2026-11-03　PR：待开　作者：Claude Code（Fable 5.1）

## 原始需求

开发计划第 1 周：“搭工程骨架，空壳应用跑起来”。要求：

- pnpm workspace，Electron + electron-vite + React 19 + Tailwind，Biome、Vitest、Playwright 第一周就能跑。
- 讨论后定下的两处调整：SQLite 用 Node 内置的 `node:sqlite`（不用 better-sqlite3，避免原生依赖）；不上 Turborepo。
- 先接 OpenCode，CodeAgent 后续适配；二进制按平台分发；Windows 同学能用，不需要 Windows arm64。
- 流程技能（`delivery-doc`、`prototype-first`、`unit-test`、`e2e-test`、`commit-and-pr`）随骨架一起加。

做到：空壳应用能开窗口、渲染进程能通过 preload 和主进程通信、本机数据库能建表；内核包能找到并启动 OpenCode；lint、类型检查、单测、E2E 在本机全绿，CI 配好 macOS 和 Windows 矩阵。

## 怎么验收

前提：Node 24、pnpm 12（见 README“环境”）。

1. `pnpm install` — 预期：无报错，`packages/kernel/node_modules/opencode-ai/bin/opencode.exe` 存在（所有平台都叫这个名字，是 opencode-ai 自己的约定）。
2. `pnpm check` — 预期：Biome 无错误；四个包 typecheck 通过；单测 4 个文件 12 个用例全过，其中 `packages/kernel/src/dialects/opencode.test.ts` 会真的启动 `opencode serve` 并请求 `/global/health`。
3. `pnpm dev` — 预期：弹出 kits 窗口，左侧栏、中间“要做什么？”标题和输入框；左下角显示 `darwin · electron 45.2.1`（Windows 上是 `win32 · …`），说明渲染进程经 preload 拿到了主进程的回应。关闭窗口。
4. 用户数据目录下有 `kits.db`（macOS `~/Library/Application Support/kits/kits.db`，Windows `%APPDATA%\kits\kits.db`），用任意 SQLite 工具打开能看到 `sessions` 表。
5. `pnpm build && pnpm test:e2e` — 预期：Playwright 启动打包前的应用，1 个用例通过。
6. `pnpm vendor:kernel` — 预期：`vendor/opencode/mac-arm64/opencode`（或 `win-x64/opencode.exe`）出现，`--version` 输出 `1.19.5`。
7. 推到 GitHub 后 CI 在 macOS 和 Windows 两个 runner 上跑通（这一步本地验不了，见已知问题）。

## 主要改动

- 根目录：`package.json`（workspace 脚本）、`pnpm-workspace.yaml`（含 `allowBuilds`，pnpm 12 默认不跑依赖的安装脚本；pnpm 12 还默认拒绝发布不满一天的包，所以 tailwind 和 vitest 没用最新版，这个策略保留）、`biome.json`、`tsconfig.base.json`（strict + `noUncheckedIndexedAccess`）、`vitest.config.ts`（projects）、`.gitattributes`（统一 LF）、`.node-version`、`.editorconfig`。
- `apps/desktop`：electron-vite 三端。主进程开窗口、打开数据库、回应 `ping`；preload 用 `contextBridge` 暴露 `window.kits`；渲染进程是照首页原型画的空壳。`PlatformBridge` 在 `src/main/platform.ts`。数据库在 `src/main/db/`，schema 只有一张 `sessions` 表，迁移文件在 `drizzle/`，由 `pnpm --filter @kits/desktop db:generate` 生成。`electron-builder.yml` 把 `vendor/opencode/${os}-${arch}` 和 `drizzle/` 放进 `extraResources`。
- `packages/core`：`KernelEvent` 类型；`AgentProfile`、MCP 配置（兼容 `mcpServers` 粘贴）、权限规则的 zod schema 和默认值；`ask_user` / `submit_output` 的 MCP 服务定义（`createKitsToolServer`），`submit_output` 按 JSON Schema 校验。
- `packages/kernel`：`AgentKernel`、`KernelDialect` 接口；`resolveKernelBinary`（环境变量 → resources → npm 包）；OpenCode 方言的 `spawn`：空闲端口、每次启动随机密码走 Basic Auth（`OPENCODE_SERVER_PASSWORD`，用户名 `opencode`）、带超时的健康检查、启动失败杀进程并把日志带进报错、`close()` 等子进程真正退出。`writeConfig` 还没实现，第 2 周做配置转换时补。
- `e2e/`：Playwright 直接 `_electron.launch` 打包前的应用，一个冒烟用例。主进程支持 `KITS_USER_DATA_DIR` 环境变量指定用户数据目录，E2E 每次用临时目录，不碰本机真实的 `kits.db`。
- `evals/`：README、示例 JSONL、脚本骨架。
- `scripts/vendor-kernel.mjs`：把当前平台的 opencode 二进制拷到 `vendor/`。
- `.github/workflows/ci.yml`：macOS + Windows 矩阵。
- `.agents/skills/` 新增五个流程技能，`.agents/agents/` 新增两个 Agent 定义，`.claude/skills/` 加软链接。
- 文档：AGENTS.md（目录结构、技术栈调整、Windows 注意事项、技能列表）、README（环境和命令）、开发计划的技术栈表两行、`.agents/skills/README.md`。
- 原型没动；界面只有照原型画的空壳。

## 测试

- 单测：`pnpm test`。覆盖 MCP 配置解析、`submit_output` 的 schema 校验、内核二进制查找、数据库迁移和读写、OpenCode 启动契约。
- E2E：`pnpm build && pnpm test:e2e`，覆盖开窗口和主进程通信。

## 新增依赖

| 依赖 | 版本 | 用途 | 许可证 |
|---|---|---|---|
| electron | 45.2.1 | 桌面壳，自带 Node 24.22 | MIT |
| electron-vite | 6.0.0 | main / preload / renderer 一份配置 | MIT |
| vite | 8.3.5 | 构建 | MIT |
| react / react-dom | 19.3.1 | 界面 | MIT |
| @vitejs/plugin-react | 6.2.1 | React 插件 | MIT |
| tailwindcss / @tailwindcss/vite | 4.3.3 | 样式 | MIT |
| drizzle-orm / drizzle-kit | 1.0.0-rc.5 | ORM 和迁移；`node:sqlite` 驱动只在 1.0 里有 | Apache-2.0 |
| @modelcontextprotocol/sdk | 1.32.2 | kits 本机 MCP 服务 | MIT |
| zod | 4.6.7 | 配置 schema | MIT |
| @cfworker/json-schema | 4.1.4 | `submit_output` 的 JSON Schema 校验，纯 JS | MIT |
| electron-builder / electron-updater | 26.18.0 / 6.8.11 | 打包、内网更新 | MIT |
| @biomejs/biome | 2.6.4 | lint + format | MIT / Apache-2.0 |
| vitest | 5.0.5 | 单测 | MIT |
| @playwright/test / playwright | 1.64.1 | E2E | Apache-2.0 |
| typescript | 5.9.3 | 类型检查（7.0 刚发布，工具链还没跟上，先不用） | Apache-2.0 |
| opencode-ai（devDependency） | 1.19.5 | 开发时的 OpenCode 二进制，按平台拆包 | MIT |

没有原生依赖；Electron 的二进制由它自己的安装脚本下载。

## 已知问题

- **Drizzle 用的是 1.0.0-rc.5**，不是稳定版：`node:sqlite` 驱动只在 1.0 里。1.0 正式版出来后升一下版本号即可；万一 rc 出问题，换回 better-sqlite3 只改 `apps/desktop/src/main/db/index.ts` 一个文件。
- **Node 必须 22.16 以上**：Drizzle 的 `node:sqlite` 驱动用了 `setReturnArrays`，Node 22.13 跑不了 `apps/desktop` 的数据库测试。Electron 自带 Node 24，运行时没问题，只影响本机跑单测。
- **CI 第一次在 Windows 上跑挂了两处**：测试里写死了 `/` 分隔符（已改用 `path.join`）；OpenCode 启动契约测试 30 秒超时，原因日志里看不出来，已把子进程日志带进报错、超时放宽到 60 秒，看第二次结果。
- Copilot review 的 9 条意见已全部处理：路径分隔符、spawn 错误、实例认证、E2E 独立数据目录、MCP URL 限 http(s)、submit_output 把 schema 放进工具描述、健康检查超时、启动失败回收进程、close 等退出。
- **opencode-ai 装完会把二进制硬链接到 `bin/opencode.exe`**，macOS 上也叫 `.exe`，这是它的约定，查找逻辑按这个写的。
- `opencodeDialect.writeConfig` 未实现，`permissionReplyPath` 的接口路径待按锁定版本实测（phase1 方案 4.3 节标了“待实测”）。
- 渲染进程的生产包 567 kB，没查是什么占的，做会话页时顺手看一下。
- 没有手改 AI 代码的地方。
