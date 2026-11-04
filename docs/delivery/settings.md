# 交付说明：settings

## 2026-11-04　设置 · 内核与模型，首次引导第 1 步

> 日期：2026-11-04　PR：见本分支 `feat/settings-model`　作者：Claude Code

### 原始需求

[phase1-implementation.md](../plans/phase1-implementation.md) 第 8 节 PR5：设置页 `#model`：网关增删改、测试连接、模型列表、默认模型、内核选择、内核状态和日志目录；首次引导第 1 步。原型：[settings.html#model](../../designs/app/settings.html)、[onboarding.html](../../designs/app/onboarding.html) 第 1 步。

做到什么程度算完：在设置页能把一个 OpenAI 兼容网关配好（测通、拉到模型、选默认模型），密钥只进系统钥匙串；首次引导第 1 步能完成同样的事。

### 怎么验收

1. `pnpm check` 全绿；`pnpm build && pnpm test:e2e` 7 个用例通过，其中 `settings-model.spec.ts` 2 个是本 PR 的。
2. 手动走一遍（用 `.env` 里的测试网关，或者任意 OpenAI 兼容服务）：
   - `KITS_CONFIG_DIR=/tmp/kits-try pnpm dev`，⌘, 进设置，点“内核与模型”。没有网关时有一行虚线框提示。
   - 点“添加网关”，填名称、地址、API Key，点“测试并添加”。key 填错时表单右边出现“鉴权失败（HTTP 401），检查 API Key”，不会添加；填对后表单收起，下面出现网关卡片，绿点、名称、地址。
   - 点卡片标题展开：能改地址和 key（key 框里写“已保存，留空不改”），能删网关；下面是模型列表，第一个模型默认选中、带“默认”标签，点别的模型改默认；每个模型右边的“上下文”数字（单位 K，默认 128）可以改，失焦保存。
   - 点“测试”，卡片标题右边出现“连接正常 · xx ms · n 个模型”；点“刷新列表”按网关当前的模型列表更新，已有模型的上下文设置保留。
   - 关掉网关开关：它下面的模型变灰、不能选默认；如果默认模型在它下面，默认模型自动换成别的启用网关的第一个模型。
   - 打开 `/tmp/kits-try/settings.json`：`gateways` 里有网关（id 从主机名取，比如 `llm-gateway`），`defaultModel` 是 `<网关 id>/<模型 id>`，**没有 API Key**。
   - “Agent 内核”卡片：OpenCode 显示“已安装”和版本号；CodeAgent 本机没有时显示“未安装”且不能选。“内核日志”一行是日志目录，点“打开目录”用系统文件管理器打开（目录不存在会先建）。
3. 首次引导第 1 步：开发者工具里 `location.hash = '#/onboarding'`。填网关地址和 key，点“测试连接”，出现“连接正常 · … · n 个模型”和默认模型的选择；点选一个模型，点“下一步”进入第 2 步（第 2、3 步是占位，有“先到这里，进入首页”按钮）。

### 主要改动

- `packages/core/src/ipc.ts`：新增 `gateway.test`（不传 key 时用已保存的 `gateway:<id>`）、`kernel.status`、`kernel.openLogs`。
- `apps/desktop/src/main/`：
  - `gateway/gateway-client.ts`：`GET {baseUrl}/models` 测连接、量延迟，模型去重排序；401/403、连不上、超时（10 s）、地址不对各给一句能看懂的原因。只认 http(s)。
  - `kernel/kernel-info.ts`：按 `resolveKernelBinary` 找两个内核，`--version` 取版本（5 s 超时），日志目录 `{userData}/kernel/<id>/logs`。
- `apps/desktop/src/renderer/src/`：
  - `pages/settings/model/ModelSection.tsx`：网关卡片（展开、测试、启停、改地址和 key、删除、模型单选默认、上下文窗口）、添加网关表单、内核卡片。
  - `pages/settings/model/useGateways.ts`：网关的增删改，设置页和引导共用；密钥只经 `secrets.set` 进钥匙串。
  - `lib/gateway.ts`：网关 id 推荐（从主机名取、撞了加序号）、刷新模型时合并、默认模型失效时换一个。
  - `pages/onboarding/OnboardingPage.tsx`：三步导航和第 1 步。
  - `ui/Input.tsx`（输入框和带标签的字段）、`ui/Spinner.tsx`。
- 原型没画到、按风格补的：没有网关时的空状态；网关卡片展开后的“删除网关”“保存并测试”和 `id: …` 一行（id 会写进 Agent 文件的 `model:`，要让人看得到）；模型行的“上下文”输入框（方案 3.1 节要求可改，原型只显示）；引导第 2、3 步的占位。
- 原型里网关卡片的“备注”列没有做：网关接口不给，手填的价值不大，等用户提再加。
- 没有数据库 schema 改动。

### 测试

- 单元测试：`main/gateway/gateway-client.test.ts`（模型列表和鉴权头、401、连不上、非 http 地址）；`renderer/src/lib/gateway.test.ts`（id 推荐、模型合并、默认模型修正）；`core/src/ipc.test.ts` 更新通道列表。
- E2E：`settings-model.spec.ts`：设置页添加网关（先错 key 再对 key）、改默认模型、测试连接、确认 `settings.json` 里没有 key 而钥匙串里有；引导第 1 步测通、选默认模型、进第 2 步。E2E 里的假网关在 `e2e/tests/gateway.ts`，只实现 `GET /models`。

### 新增依赖

无。

### 已知问题

- 内核状态现在只有“装没装、版本”，运行状态（启动中 / 运行中 / 出错 / 待重启）随 PR6 的 KernelManager 加进这张卡片。
- “查看生成的配置”（原型“内核联网”一行的链接）在 PR14 做 `agents.preview` 时一起做。
- 首次启动自动进引导、完成后写 `onboardingDone` 在 PR17。

## 2026-11-04　设置 · 通用、权限、数据与隐私；深色主题；首次引导第 2 步和首次启动门控

> 日期：2026-11-04　PR：见本分支 `feat/settings-general`　作者：Claude Code

### 原始需求

phase1-implementation PR17（6.2 节主题、6.3 节 `#general` / `#perm` / `#privacy`、`onboarding.html` 第 2 步）：`#general` 主题（深色先补原型）、界面和代码字号、字体、启动行为、通知开关、快捷键表；`#perm` / `#privacy` 说明页；首次引导第 2 步（`workdir.inspect`）和首次启动门控。

做到什么程度算完：通用设置每一项改了立刻生效并写进 `settings.json`；深色主题在原型里能预览、代码里和原型一致；第一次打开（没配网关）进引导，第 2 步选目录后列出发现了什么，完成或跳过后不再进来。

### 怎么验收

1. 原型：`designs/app/` 任一页加 `?theme=dark`（比如 `session.html?s=permission&theme=dark`），整页变深色；命令、diff 这类代码块比底色更深；设置页“通用”的主题选项也能切。**深色配色请评审**：意见改 `designs/app/theme.js` 的映射表和 `apps/desktop/src/renderer/src/index.css` 的深色令牌（两边值一样）。
2. 设置 → 通用：主题选“深色”整个应用立刻变深，“跟随系统”随系统切；界面字号小 / 标准 / 大（12 / 13 / 14px 基准，间距等比缩放）；侧栏“只留图标”后侧栏收成图标栏（⌘B 还能临时切）；界面字体、代码字体下拉只列本机装了的，下面有预览；代码字号 11～14px；“启动时”选“上次的会话”下次启动直接打开最近的会话；三个通知开关写进 `settings.json`（通知本身在 PR18）；快捷键表。
3. 设置 → 权限：三种默认权限模式（新会话的输入框默认选中它），默认权限表，自动允许的只读命令；底部链到 Agent 页和 MCP 页改细则。
4. 设置 → 数据与隐私：配置、会话数据库、附件、导出、内核数据各在哪（“在文件夹中显示”），记了什么、什么会出这台电脑。
5. 删掉 `~/.kits/settings.json` 再启动：进首次引导。第 2 步没选目录时是一个大的“选择一个代码仓库目录”按钮；选了之后显示路径、Git 分支和工作区状态（不是 Git 仓库也说明），“在这个目录里发现”列出 AGENTS.md、项目技能、项目 Agent、项目记忆、项目类型和猜的测试命令。第 3 步“完成”或“先跳过”回首页，`onboardingDone: true`，之后启动不再进引导。已经配过网关的老用户不会被拉进引导。

### 主要改动

- 原型：`designs/app/theme.js`（深色预览）、各页引入它，设置页主题选项接上；`designs/README.md` 写了用法。
- `apps/desktop/src/renderer/src/`：
  - `pages/settings/general/GeneralSection.tsx`、`perm/PermSection.tsx`、`privacy/PrivacySection.tsx`，路由进 `SettingsPage`。
  - `lib/fonts.ts`：量文字宽度判断本机装了哪些候选字体（浏览器不给字体列表）。
  - `app/use-appearance.ts`：外观（主题、字号、字体）在外壳和首次引导里都生效。
  - `shell/Layout.tsx`：侧栏跟着设置；启动时只做一次的跳转（首次引导 / 打开上次的会话）。
  - `pages/onboarding/OnboardingPage.tsx`：第 2 步 `WorkdirStep`；完成、跳过都记 `onboardingDone`。
  - `ui/Switch.tsx`、`ui/Menu.tsx`、模型页的状态点：写死的浅灰换成令牌，深色下不刺眼；侧栏宽度动画时文字不换行。
  - `index.css`：深色令牌定稿（和原型一致）。
- `apps/desktop/src/main/`：`workdir/inspect.ts`（Git 分支和改动数、AGENTS.md / CLAUDE.md、项目技能、项目 Agent、项目记忆、按构建文件猜项目类型和测试命令；只读）；IPC `workdir.inspect`、`app.permissionDefaults`；`app.info` 多了 `skipOnboarding`（`KITS_SKIP_ONBOARDING=1`，E2E 默认带上）。
- 原型没画到、按风格补的：权限页和数据与隐私页（原型只有一句占位）；字体预览行；引导第 2 步“没发现什么”的提示和非 Git 仓库的说明。

### 测试

- E2E：`settings-general.spec.ts`（3 个）：切深色、大字号、代码字号、通知开关立刻生效并写进 settings.json；权限页改默认模式、数据与隐私页列出位置；首次启动进引导、第 2 步列出目录里发现的东西、跳过后记 onboardingDone。`e2e/tests/app.ts` 默认 `KITS_SKIP_ONBOARDING=1`，原有用例不受门控影响。
- 截图：`e2e/test-results/settings-general-dark.png`、`home-dark.png`、`onboarding-workdir.png`。

### 新增依赖

无。

### 已知问题

- **深色配色没经过人评审**：按方案应先评审原型再写代码，这次两边一起改了，评审有意见两处一起调。
- 界面语言只有中文（英文选项以后加）。
- 字体检测只在候选列表里挑（常见的中英文界面字体和等宽字体），列表外的字体要手改 `settings.json` 的 `uiFont` / `codeFont`。
- 数据与隐私页还没有“导出评测数据（JSONL）”，方案里也没排进第一阶段的 PR。

## 2026-11-05　上下文窗口从网关读，并交给内核

> PR：#45　作者：Claude Code

### 原始需求

会话的“上下文”面板始终显示 128K，测试用的模型是 1M。

原因有两层：连接测试只取模型 id，不看网关报的上下文窗口，新模型一律是默认的 128K；设置里的上下文窗口也没写进内核配置，内核不知道模型上限，“接近上限时自动压缩”实际不会发生。

### 怎么验收

1. 设置 → 内核与模型，展开网关，点“刷新列表”。预期：DeepSeek 这类带 `context_window` 的网关，模型的“上下文”从 128 变成 1049（K）。升级前加的网关要点这一次才会更新。
2. 把某个模型的上下文改成 64，再点“刷新列表”。预期：还是 64，手改的值不被覆盖。
3. 回到会话，右侧“上下文”：`18K / 1.0M`，进度条按 1M 算。
4. 新加一个网关、首次引导加网关：模型直接带网关报的窗口。网关不报时是 128K，可以手改。
5. 改了上下文后新开一个会话，打开 `<用户数据目录>/kernel/opencode/config/opencode.json`：`provider.<网关>.models.<模型>.limit` 是 `{ context, output }`。

### 主要改动

- `apps/desktop/src/main/gateway/gateway-client.ts`：连接测试的结果多了 `contextWindows`，读 `context_window`、`context_length`、`max_context_length`、`max_model_len`。
- `apps/desktop/src/renderer/src/lib/gateway.ts`：`mergeModels` 用网关报的窗口。已有模型只有还是默认值 128K 时才替换，手改过的不动；手改成正好 128K 的会被网关的值替换。
- `packages/kernel/src/generate/opencode-config.ts`：模型写 `limit`。`output` 取 32K 和窗口四分之一里小的那个：内核拿“窗口减 output”当可用上下文，小窗口模型不能让它变成负数。
- `docs/references/codeagent-checklist.md`：第 27 项。

配置文件格式、数据库 schema 没有变化。界面没有变化，不改原型。

### 测试

- 单元测试：`gateway-client.test.ts`（各家字段名）、`lib/gateway.test.ts`（新模型、替换默认值、保留手改值）、`opencode-config.test.ts`（`limit`、小窗口）。
- 契约测试：`opencode-config.contract.test.ts` 从真实 opencode 的 `/config/providers` 读回 `limit`。

### 新增依赖

无。

### 已知问题

- 写了 `limit` 以后内核会自动压缩：128K 窗口约在用到 96K 时触发。网关不报窗口、实际窗口又比 128K 大的模型，要手改，不然压缩来得过早。
- 已有网关不会自动更新，要点一次“刷新列表”。
