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
