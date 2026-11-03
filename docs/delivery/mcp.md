# 交付说明：mcp

## 2026-11-04　设置 · MCP 服务：粘贴识别、测试连接、工具权限；输入框的平台开关；引导第 3 步

> 日期：2026-11-04　PR：见本分支 `feat/mcp-settings`　作者：Claude Code

### 原始需求

phase1-implementation PR12（3.3 节 `mcp.json`、6.3 节 `#mcp`）：需求平台、用例平台、知识库通过 MCP 接进来。设置页能粘贴别的工具里的 `mcpServers` 配置、增删、启停、测试连接、看工具列表并给每个工具设三档权限（允许 / 询问 / 禁止），说明 kits 自带的工具；输入框 `+` 菜单里能决定这次会话用哪些平台；首次引导第 3 步能直接粘贴。原型 `designs/app/settings.html#mcp`、`designs/app/onboarding.html` 第 3 步、`designs/app/shell.js` 的 `+` 浮层。

做到什么程度算完：粘贴时实时显示识别到哪些服务；添加后自动测试连接，列出工具；改权限、启停、移除都写回 `~/.kits/mcp.json` 并让内核按新配置重启；`${VAR}` 凭据可以在设置页填进钥匙串，不写进 `mcp.json`；新会话可以关掉某个平台。

### 怎么验收

1. 设置 → MCP 服务 → “添加服务”，粘贴：

   ```json
   { "mcpServers": { "echo": { "command": "node", "args": ["<仓库>/apps/desktop/src/main/mcp/fixtures/echo-server.mjs"] } } }
   ```

   下面实时显示“识别到 1 个服务：echo（stdio）”。点“添加并测试”：卡片显示“2 个工具”，展开后有 `get_case`（允许）、`create_case`（写入类，默认询问）和“连接正常 · 2 个工具 · N ms”。
2. 把 `create_case` 改成“禁止”：`~/.kits/mcp.json` 的 `permissions` 里出现 `"echo.create_case": "deny"`。关掉开关，卡片显示“已停用”，`enabled` 里写 `echo: false`；再打开。点“移除”，服务和它的权限都从文件里删掉。
3. 粘贴一个 HTTP 服务，请求头里写 `Bearer ${CASE_TOKEN}`：识别结果提示这个变量；添加后测试显示“连接失败 · 还没填凭据：CASE_TOKEN”，凭据一栏是“未填”。在输入框填值点“保存”：变成“已填”，值存进钥匙串（secrets 的 `env:CASE_TOKEN`），`mcp.json` 里没有它。
4. Claude 的 `mcpServers`、OpenCode 的 `mcp`（`local` / `remote`、`command` 是数组）、直接粘一个 `{ "名字": {…} }` 都能识别；JSON 写错、服务名有空格、地址不是 http(s) 都会说清楚哪里不对。
5. 首页输入框 `+`：有“本次会话可用的平台”，列出启用的服务，开关点了不关菜单。关掉 echo 再发任务：这个会话里 echo 的工具一律不能用（会话权限最后加一条 `echo_*` 禁止）。
6. 首次引导（`#/onboarding`）点左边“MCP 服务”：粘贴上面的配置点“添加并测试”，下面显示“echo · stdio · 已连接 · 2 个工具”；“完成，开始使用”回到首页，“先跳过”也一样。
7. 手改坏 `mcp.json`：设置页顶上提示读不了，添加、改权限都拒绝并提示先手动修好，不会把人写的内容盖掉。

### 主要改动

- `packages/core/src/config/mcp-paste.ts`：粘贴识别（三种写法 → kits 的服务配置）、`serverVars`（地址、请求头、命令参数、环境变量里的 `${VAR}`）、`toMcpServersEntry`（写回常见写法）。
- `packages/core/src/mcp-view.ts` + `ipc.ts`：`mcp.overview / parse / add / remove / setEnabled / setPermission / test`。
- `apps/desktop/src/main/mcp/mcp-service.ts`：读写 `mcp.json`（写之前读最新的、文件里别的字段原样保留、坏文件不写），改了调 `kernels.configChanged()`。测试连接用 MCP SDK 的客户端直接连（stdio / Streamable HTTP，`${VAR}` 先查钥匙串再查环境变量，15 秒超时，失败时带上 stdio 服务的 stderr），列出的工具缓存起来给设置页显示，没单独设过权限的写入类工具显示“询问”。
- `apps/desktop/src/main/sessions/session-service.ts`：`CreateSessionInput.mcpOff` 里的服务，在内核里建会话时追加 `<服务>_*` 禁止规则。
- `apps/desktop/src/renderer/src/pages/settings/mcp/McpSection.tsx`：`#mcp` 页面，样子照原型；`McpPaste` 引导里也用。
- `shell/Composer.tsx`、`ui/Menu.tsx`（`MenuSwitchItem`）、`lib/composer-prefs.ts`（`mcpOff`）：`+` 菜单里的平台开关，只在新会话的输入框里出现（会话开始后权限已经定了）。
- `pages/onboarding/OnboardingPage.tsx`：第 3 步 MCP；第 2 步还是占位，按钮改成“下一步”。
- 和方案的出入：方案写“测试连接通过内核 `GET /mcp` 的状态”。这里改成主进程直接连服务：内核没起来、还没配模型时也能测，而且能拿到工具列表和描述来设权限；内核用的是同一份配置。
- 原型没画到、按风格补的：凭据的填写框（原型只有“重新授权”按钮）；没有服务时的空状态；`mcp.json` 读不了的提示；工具列表在测试连接之前是空的（提示“测试连接后会列出”）。

### 测试

- 单元测试：`mcp-paste.test.ts`（6 个：三种写法、报错、变量、写回）；`mcp-service.test.ts`（7 个：添加并通知内核、保留未知字段、坏文件不写、启停 / 权限 / 移除、连真的 stdio 服务列工具和默认权限、缺凭据、服务退出带 stderr）；`session-service.test.ts` 补“关掉的平台在会话权限里禁止”。
- E2E：`settings-mcp.spec.ts`（4 个）：粘贴 stdio 服务 → 工具 → 改权限 → 停用 → 移除；HTTP 服务的凭据进钥匙串不进文件；输入框的平台开关；引导第 3 步。
- 测试用的 MCP 服务：`apps/desktop/src/main/mcp/fixtures/echo-server.mjs`（两个工具）。

### 新增依赖

没有新的三方库。`@modelcontextprotocol/sdk@1.32.2` 原来就在 `packages/core` 里（kits 自带工具的服务端），这次 `apps/desktop` 也直接依赖它（用客户端测试连接），版本相同。

### 已知问题

- “重新授权”（OAuth）没有做：凭据只支持 `${VAR}` 占位 + 钥匙串 / 环境变量。
- 工具列表只在测试连接后才有，应用重启后要再测一次；内核里实际连没连上（`GET /mcp`）还没在设置页显示。
- 原型里的“查看日志”“编辑 JSON”按钮没做：要改 JSON 直接编辑 `~/.kits/mcp.json`，保存后设置页和内核都会用新内容。
- 输入框里关掉的平台只对新会话生效，会话页上不显示这次关了哪些。
