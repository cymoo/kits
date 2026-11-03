# 交付说明：agents

## 2026-11-04　设置 · Agent：三级来源、新建 / 复制、提示词、模型、工具权限、技能、MCP、输出格式、看转换结果

> 日期：2026-11-04　PR：见本分支 `feat/agent-settings`　作者：Claude Code

### 原始需求

phase1-implementation PR14（3.2 节 Agent、6.3 节 `#agent`）：Agent 是一份 Markdown 文件（frontmatter 写模型、工具、权限、技能、MCP、输出格式，正文是提示词），三级来源：内置 → 个人（`~/.kits/agents`）→ 项目（`<工作目录>/.agents/agents`），同名项目的优先。设置页能列出、新建、复制、改提示词和各项配置、看转换结果；输入框的 Agent 浮层用真数据；内置 `assistant.md`。原型 `designs/app/settings.html#agent`。

做到什么程度算完：设置页改完保存，文件写回对应目录，下一个会话按新配置跑；项目 Agent 在对应目录的会话里能选、能用；转换结果能看。

### 怎么验收

1. 在某个仓库建 `.agents/agents/api-reviewer.md`：

   ```markdown
   ---
   name: api-reviewer
   description: 对照文档和实现，列出不一致
   tools: read, grep, glob
   ---
   只读，不改任何文件。
   ```

   用这个仓库建过一次会话（设置里最近目录就是它）。
2. 设置 → Agent：左边有 `assistant`（内置）和 `api-reviewer`（项目）。最近用过好几个仓库时，列表上方能切换看哪个仓库的项目 Agent。
3. 选 `assistant`：文件位置写“内置 · 不能改，可以复制一份改”，提示词只读，权限只显示档位。点“复制一份 → 个人 Agent”：左边多出 `assistant-copy`（带蓝点 = 没保存）。改说明、把 `bash` 设成“禁止”，点“保存”：`~/.kits/agents/assistant-copy.md` 里有 `description` 和 `permissions: { bash: deny }`，内核按新配置重启。
4. 选 `api-reviewer`：`edit`、`bash`、`webfetch`、`task` 显示“禁止”（不在 `tools` 里）。把 `edit` 改成“允许”再保存：`tools` 里补上 `edit`。
5. “技能”“MCP”卡片：默认“全部已启用的…”；点“调整”关掉一个，文件里写成具体的列表；全打开又回到不写（以后新加的也能用）。
6. 输出格式：点“不限定 · 产出就是回复正文”，在 Agent 文件旁边建 `<名字>.schema.json`（一个起步的 Schema）并写进 `output`；“编辑”用系统默认程序打开它。文件改坏了，卡片下面提示读不了。
7. “看转换结果”：个人、内置的显示 `opencode.json` 里这个 agent 的那一段，外加每条消息带的 `system`；项目的显示 `"agent": "kits-_project"`、`system` 和会话权限规则。
8. 在 `api-reviewer` 上点“用它新建会话”：回到首页，输入框的 Agent 是 `api-reviewer`、目录是这个仓库。发一条消息：内核会话用 `kits-_project`，消息带上它的提示词；`edit` 等工具被拒绝。
9. 名字和别的 Agent 重复、模型不在启用的网关里、输出格式文件读不了：保存时报错，文件不变。删除个人 / 项目 Agent 会移到废纸篓。

### 主要改动

- 内核（`packages/kernel`）：
  - **提示词改成随消息带上**：`UserInput.system`，适配器发 `prompt_async` 时带 `system`。生成的 `opencode.json` 里 agent 不再写 `prompt`：OpenCode 的 agent prompt 会顶掉内核自带的系统提示词（里面有怎么用工具、怎么改文件），`system` 是接在后面。三级来源一律这样，行为一致。`agentSystemPrompt()` = 正文 + 输出格式说明。
  - 项目 Agent 不进内核配置（内核配置全局一份，项目 Agent 随工作目录变）：用一个公共底座 `kits-_project`（`PROJECT_BASE_AGENT`，`_` 开头不会和用户的名字撞），权限按会话给，`kernelAgentOf()` 决定用哪个。
  - `agentPermissions` 补上 MCP 允许列表：列表外的服务在会话权限里 `<服务>_*` 禁止（之前只靠内核的 tools 开关隐藏）。
  - `opencodeAgentEntry()` 抽出来给“看转换结果”用。
- `packages/core`：`agent-view.ts`（`AgentView / AgentDraft / AgentOverview / AgentSaveInput`）；IPC `agents.list({workdir})`、`overview / save / remove / preview / createOutput / open`。
- `apps/desktop/src/main`：
  - `kernel/kernel-config.ts`：`listAgents(config, builtinDir, workdir?)` 合并三级来源；资源目录里没有 `assistant` 时用代码里兜底的。
  - `agents/agent-service.ts`：保存（文件里不认识的 frontmatter 字段原样保留、改名删旧文件、重名 / 模型不存在先拦下、写完读回校验不行就恢复）、删除（移到废纸篓）、转换结果、新建输出格式、打开文件。个人的改了通知内核重启，项目的不用。
  - `platform.ts`：`PlatformBridge.trashPath`。
  - `sessions/session-service.ts`：按会话的工作目录找 Agent；项目 Agent 建会话用底座，每条消息带上 `system`。
- `apps/desktop/resources/builtin/agents/assistant.md`：内置通用 Agent，提示词偏测试工作。
- `apps/desktop/src/renderer/src/`：`pages/settings/agent/AgentSection.tsx`；`lib/agent-edit.ts`（工具档位、允许列表、新名字、比较草稿）；输入框 Agent 浮层按当前目录列（换目录后选过的项目 Agent 不在了就退回 `assistant`）。
- 原型没画到、按风格补的：名字和说明的输入框；没保存的蓝点（切到别的 Agent 再回来草稿还在）；删除 / 不要了；新建、复制时选存成个人还是项目；项目目录切换；读不了的 Agent 文件报错。

### 测试

- 单元测试：`agent-service.test.ts`（11 个：个人 / 项目保存、保留未知字段、改名、重名、模型不存在、输出格式读不了时恢复、新建输出格式、删除进废纸篓、内置不能改、项目的转换结果）；`kernel-config.test.ts` 补 `listAgents`（2 个）；`agent-edit.test.ts`（8 个）；`opencode-config.test.ts` 补 MCP 允许列表、底座、提示词不进配置；`opencode-family.test.ts` 补“带 system 发消息”；`session-service.test.ts` 补“项目 Agent 用底座、提示词随 system”；契约测试改成 agent 没有 `prompt`、有 `kits-_project`。
- E2E：`settings-agent.spec.ts`（2 个）：复制内置的存成个人的并改权限、写进文件；项目 Agent 的禁止档位、转换结果、“用它新建会话”后输入框选中它。

### 新增依赖

无。

### 已知问题

- 提示词从“替换内核的系统提示词”改成“接在后面”。之前写过个人 Agent 提示词的，效果会有一点变化（内核自带的工具说明回来了），一般是变好。
- 项目 Agent 的权限在建会话时定下；会话开始后改了项目 Agent 的文件，提示词下一条消息生效，权限要新建会话才生效。
- `tools` 允许列表里 `edit` 以外的细项（`write`、`apply_patch`）在设置页不单独显示，跟着 `edit` 走。
- “权限”页（默认值）还是说明页（PR17），这里的默认档位来自内置的默认权限。
