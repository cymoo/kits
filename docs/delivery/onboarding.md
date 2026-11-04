# 交付说明：onboarding

## 2026-11-04　首次引导改成一页，不选目录就用默认工作目录

> 日期：2026-11-04　PR：见本分支 `feat/onboarding-single-page`　作者：Claude Code

### 原始需求

用户走查时提的：初始引导有点复杂，更好的体验是只有一页，配模型信息和目录；目录也可以不指定，这时在合适的位置创建一个，比如 `kits-workspace`。

原型：[designs/app/onboarding.html](../../designs/app/onboarding.html)。

### 怎么验收

用干净的配置启动（`KITS_CONFIG_DIR`、`KITS_USER_DATA_DIR`、`KITS_WORKSPACE_DIR` 指到临时目录）。

1. 进入引导，只有一页：模型网关、工作目录，底部“先跳过”和“开始使用”。没有步骤导航，没有 MCP。
2. 工作目录显示 `~/kits-workspace`（或 `KITS_WORKSPACE_DIR` 的路径），下面写着“开始时自动创建”。此时磁盘上还没有这个目录。
3. “开始使用”是灰的。填网关地址和 API Key，点“测试连接”，出现模型列表，选一个默认模型，按钮变可用。
4. 点“开始使用”，进入首页，副标题写着 `kits-workspace`，磁盘上有了这个目录，`settings.json` 的 `workdirs` 第一项是它。
5. 重来一次，点“选择已有目录”选一个仓库：显示路径和 Git 状态（分支、工作区是否干净，或“不是 Git 仓库”），按钮变成“换一个”。点“开始使用”后不创建 `kits-workspace`。
6. 重来一次，什么都不填点“先跳过”：同样创建默认目录并进首页，之后启动不再进引导。
7. 网关没有列出模型时，表单留着，“开始使用”不可用。
8. 让 `~/kits-workspace` 的路径上已有一个同名文件（或 `KITS_WORKSPACE_DIR` 指到不可写的位置）：点“开始使用”后留在这页，显示错误，可以改选已有目录。

### 主要改动

- `pages/onboarding/OnboardingPage.tsx`：重写成一页，网关和工作目录两块；去掉步骤导航和 MCP 步骤。
- 默认工作目录：`config/paths.ts` 的 `resolveWorkspaceDir`，默认 `~/kits-workspace`，`KITS_WORKSPACE_DIR` 可以覆盖。不用家目录本身，因为 Agent 会在工作目录里读写文件。到点“开始使用”或“先跳过”时才创建，不提前在家目录建文件夹。
- IPC：新增 `workdir.createDefault`，`AppInfo` 新增 `defaultWorkdir`。
- `workdir/inspect.ts`：只留 Git 状态。原来扫描 AGENTS.md、项目技能、项目类型的逻辑只给引导第 2 步用，页面去掉后一起删了，`WorkdirInspection.found` 也删了。
- `McpPaste` 去掉只有引导在用的 `rows`。MCP 在“设置 · MCP 服务”配，能力不变。
- 配置项、数据库 schema 都没变。

### 测试

- 单元测试：`resolveWorkspaceDir` 的默认值和环境变量；IPC 契约清单加上 `createDefault`。
- E2E：`settings-general.spec.ts` 首次启动显示已选目录的 Git 状态、不选目录时创建默认目录、已选目录不创建；`settings-model.spec.ts` 配网关后开始使用、没有模型时按钮不可用；删掉 `settings-mcp.spec.ts` 里引导第 3 步的用例，设置页的 MCP 用例不变。

### 新增依赖

无。

### 已知问题

- 验收第 8 步的出错路径没有 E2E，开发时手动核对过（路径上有同名文件时留在本页并提示）。
