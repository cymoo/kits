# 模型 PoC：OpenCode 经 OpenAI 兼容网关调用 DeepSeek 的工具调用稳定性

版本 1 · 2026-11-03 · 状态：已定（第 1 周“在公司网关上试几个模型”的第一份结论）

## 结论

- **可用。** OpenCode 1.19.5 用 `@ai-sdk/openai-compatible` 走公司网关调 `deepseek-v4-pro`，10 次“读目录 + 执行命令”任务 **10/10 成功**，19 次工具调用 0 次失败，12 次权限请求全部收到并回复成功，答案全部正确。
- **工具调用本身稳定**，流式、reasoning、tool_calls、prompt cache 都能经网关正确透传。
- **延迟是主要问题**：网关每一轮 LLM 请求固定要等 **11～15 s 才吐出第一个字节**（直接 curl 网关、只发“回复 ok”也是 11.5 s），一次两三轮工具调用的任务要 26～44 s。10 次里有 1 次网关在 148 s 后主动断开连接（`Connection reset by server`），OpenCode 自动重试后成功，这一次总耗时 191 s。
- 对 kits 的影响：主力模型可以定 `deepseek-v4-pro`；界面必须把“等待模型”和“重试中”两个状态做出来，否则用户会以为卡死。适配器要改的地方见“对 KernelEvent 映射和适配器的启示”。

## 怎么测的

- 内核：`opencode-ai@1.19.5`（`packages/kernel` 锁定的版本，直接用 `node_modules/.pnpm/opencode-darwin-arm64@1.19.5/.../bin/opencode`），命令 `opencode serve --port 4096`，配置目录用 `OPENCODE_CONFIG_DIR` 注入，`XDG_*_HOME` 指到临时目录避免污染本机的 OpenCode 数据。
- 工作目录放两个 ts 文件（3 行、4 行）和一个 README。
- 任务：“列出当前目录里所有的 .ts 文件，然后用 shell 命令（wc -l）统计每个文件的行数，最后用一个表格汇总文件名和行数。不要修改任何文件。”
- 权限：`bash`、`edit` 设为 `ask`，其他 `allow`，保证每次至少触发一次权限请求。
- 驱动脚本（Node 24，不依赖 SDK）：先连 `GET /event?directory=…` 的 SSE，再 `POST /session`、`POST /session/{id}/prompt_async`；收到 `permission.asked` 立刻 `POST /permission/{requestID}/reply` 回 `{"reply":"once"}`；收到本会话的 `session.idle`（或 `session.status` 变 `idle`）判定完成，再读一次 `GET /session/status` 兜底。超时 240 s。
- 一次成功的判定：无 `session.error`、至少一次 `bash` 完成、至少一次权限请求、最终文本里同时出现 `a.ts`/3 和 `b.ts`/4。
- 在批量 10 次之前先跑了 1 次预热（冷启动首次加载插件约 2.5 s，不计入下表）。脚本和 10 次的原始事件日志放在会话共享笔记目录 `side-session-notes/…/model-poc/`。

## 10 次运行数据

首 token = 从 `prompt_async` 返回到第一个 assistant 文本/推理增量；首次工具调用 = 第一个 `tool` part 出现；总耗时 = 到 `session.idle`。输入 token 含 prompt cache 命中部分，是各轮累计。

| # | 结果 | 首 token (s) | 首次工具调用 (s) | 总耗时 (s) | 工具调用序列 | 权限请求 | 重试 | LLM 轮数 | 输入/输出 token（累计） | 出错类型 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ✅ | 14.2 | 14.6 | 40.8 | glob → bash | 1 | 0 | 3 | 32395/159 | - |
| 2 | ✅ | 163.3 | 163.9 | 190.9 | bash → glob → bash | 2 | 1 | 3 | 32529/198 | Connection reset by server |
| 3 | ✅ | 13.6 | 14.0 | 41.2 | glob → bash | 1 | 0 | 3 | 32397/143 | - |
| 4 | ✅ | 13.8 | 14.3 | 37.0 | glob → bash | 1 | 0 | 3 | 32475/193 | - |
| 5 | ✅ | 11.3 | 11.9 | 25.9 | bash | 1 | 0 | 2 | 21411/131 | - |
| 6 | ✅ | 12.4 | 13.0 | 37.1 | glob → bash | 1 | 0 | 3 | 32413/150 | - |
| 7 | ✅ | 13.6 | 14.1 | 44.0 | bash → bash | 2 | 0 | 3 | 32273/203 | - |
| 8 | ✅ | 15.2 | 15.6 | 27.4 | bash | 1 | 0 | 2 | 21393/125 | - |
| 9 | ✅ | 10.8 | 11.3 | 36.7 | glob → bash | 1 | 0 | 3 | 32453/180 | - |
| 10 | ✅ | 12.6 | 13.1 | 41.7 | glob → bash | 1 | 0 | 3 | 32395/142 | - |

- 成功率 10/10；工具调用 19 次，失败 0；权限请求 12 次，从 `permission.asked` 到 `permission.replied` 最长 9 ms。
- 首 token：中位数 13.6 s，最小 10.8 s，最大 163.3 s（含一次重试）。去掉重试那次，范围 10.8～15.2 s。
- 总耗时：中位数 38.9 s，最小 25.9 s（模型一步用 `wc -l *.ts` 做完），最大 190.9 s。
- 每轮 LLM 请求输入约 10.7k token，其中约 2.8k 来自本机 `~/.agents/skills` 和 `~/.claude/skills` 里的约 40 个技能描述（见问题 4）。

## 发现的问题

1. **网关首字节延迟 11～15 s，与 prompt 大小无关。** 直接对网关 `stream: true` 发“回复 ok”：HTTP 头 0.19 s 就到，但第一个 data chunk 在 11.46 s，之后 302 字 reasoning + 2 字正文 3 s 内流完。非流式带一个 tool 的请求 13.5 s。应该是网关或模型侧排队，不是 OpenCode 的开销。一次任务 N 轮 LLM 调用就是 N × 12 s 的硬等待。
2. **网关会在约 148 s 无输出后断开连接。** 10 次里 1 次（第 2 次）：请求发出后 147.9 s 收到 `session.status {type:"retry", attempt:1, message:"Connection reset by server", next:…}`，2 s 后 OpenCode 自动重发并成功。重试没有单独的 `session.next.retried` 事件（本版本未发出），只能从 `session.status` 判断。
3. **模型行为略有随机性但都正确。** 6 次 `glob → bash`，2 次一步 `bash`（`wc -l *.ts`），1 次 `bash → glob → bash`，1 次 `bash → bash`。没有出现并行工具调用、参数 JSON 坏掉、调用不存在的工具等情况。reasoning 经 `reasoning_content` 字段透传，OpenCode 映射成 `reasoning` part，但 `tokens.reasoning` 常为 0 或 15，统计不准，不要拿它做计费。
4. **OpenCode 会加载用户家目录里的技能和 Claude Code 配置。** 日志里出现几十条 `duplicate skill name` 警告，每轮多花约 2.8k 输入 token，也让内核行为依赖本机环境。设置 `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` 和 `OPENCODE_DISABLE_CLAUDE_CODE=1` 后再跑一次：警告 0 条，首轮输入 7.9k token，任务照常成功。剩下的 7.9k 是 OpenCode 自带的系统提示词和工具 schema。
5. **配置里的 `{env:…}` 为空时报错不友好。** 环境变量没传时 `provider.options.baseURL` 解析成空串，模型请求直接 `session.error {name:"UnknownError", data:{message:"Invalid URL"}}`，没有任何提示指向配置。kits 生成配置后应先校验网关地址和 key 非空。
6. **工具的 `completed` 状态与 `step-finish` 同时到达。** 第 1 次运行里 `glob` 的 `running` 在 16.8 s，`completed` 在 24.8 s，和同一轮的 `step-finish` 同一毫秒；工具本身是毫秒级的。原因是 AI SDK 要等模型这一轮流结束才产出 tool-result。界面上“工具执行中”的时长会显得偏长，是正常现象。
7. 启动时 `opencode serve` 会警告 `OPENCODE_SERVER_PASSWORD is not set; server is unsecured`，第一阶段方案说 OpenCode 用 Basic Auth，正式接入时要设 `OPENCODE_SERVER_USERNAME/PASSWORD`。

## 用到的 OpenCode 配置（不含密钥）

`opencode.json`，放在 `OPENCODE_CONFIG_DIR` 指向的目录。模型名不能用占位符，要由 kits 生成时写死：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "gateway": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Company gateway",
      "options": {
        "baseURL": "{env:OPENAI_BASE_URL}",
        "apiKey": "{env:OPENAI_API_KEY}"
      },
      "models": {
        "deepseek-v4-pro": { "name": "deepseek-v4-pro", "tool_call": true }
      }
    }
  },
  "model": "gateway/deepseek-v4-pro",
  "permission": {
    "bash": "ask", "edit": "ask",
    "read": "allow", "glob": "allow", "grep": "allow", "list": "allow"
  },
  "autoupdate": false
}
```

启动环境变量：`OPENCODE_CONFIG_DIR=<配置目录>`、`OPENAI_BASE_URL`、`OPENAI_API_KEY`（从 kits 设置读，不落盘）、`XDG_DATA_HOME/XDG_CACHE_HOME/XDG_CONFIG_HOME/XDG_STATE_HOME=<kits 数据目录>`、`OPENCODE_DISABLE_AUTOUPDATE=1`、`OPENCODE_DISABLE_EXTERNAL_SKILLS=1`、`OPENCODE_DISABLE_CLAUDE_CODE=1`。`@ai-sdk/openai-compatible` 是 OpenCode 内置的，不用额外下载。

本版本的接口（从 `GET /doc` 的 OpenAPI 确认）：

| 用途 | 接口 |
|---|---|
| 健康检查 | `GET /global/health` → `{"healthy":true,"version":"1.19.5"}` |
| 事件流 | `GET /event?directory=<工作目录>`（单实例，事件体就是下面的样本）；`GET /global/event` 是全局流，事件包在 `{directory, payload}` 里 |
| 建会话 | `POST /session` body `{"title": "..."}`，可带 `permission` 覆盖 |
| 发消息 | `POST /session/{id}/prompt_async` body `{"parts":[{"type":"text","text":"..."}]}`，204 立即返回 |
| 回复权限 | `POST /permission/{requestID}/reply` body `{"reply":"once"\|"always"\|"reject"}`（新接口，phase1 的“待实测”已确认）；旧接口 `POST /session/{id}/permissions/{permissionID}` body `{"response": …}` 仍在 |
| 完成判定 | `session.idle` 事件；兜底 `GET /session/status` 返回 `{ [sessionID]: {type:"idle"\|"busy"\|"retry"} }` |

## 对 KernelEvent 映射和适配器的启示

这次没有改 `packages/`，以下是记下来要改的地方：

| KernelEvent | 来源事件 | 说明 |
|---|---|---|
| `text-delta` | `message.part.delta`，`field: "text"`，取 `delta` | 用户消息也会发 `message.part.updated`（text），要按 `messageID` 对应的 `message.updated.info.role` 过滤掉 |
| `reasoning-delta` | `message.part.delta`，`field: "text"`，但 `partID` 对应的 part 是 `reasoning` | 需要先从 `message.part.updated` 记下 partID → part.type；本次抓到的 `part.type === "reasoning"` 的 delta 也走 `field:"text"` |
| `tool-start` | `message.part.updated`，`part.type === "tool"`，`state.status` 从 `pending` 变 `running` | `pending` 阶段 `input` 是空对象、`raw` 是增量 JSON 字串，等 `running` 再取 `state.input`；`callId = part.callID`，`name = part.tool` |
| `tool-end` | 同上，`state.status === "completed"`（`state.output`）或 `"error"`（`state.error`） | 会和 `step-finish` 同时到 |
| `permission-request` | `permission.asked` | `requestId = properties.id`，`tool = properties.permission`，`input = properties.metadata`（bash 是 `{command}`）；`properties.tool.callID` 能关联到工具 part；`always` 数组是“总是允许”的模式，界面可以用 |
| `usage` | `message.updated`，`info.role === "assistant"` 且 `info.time.completed` 存在 | `tokens.input` 不含缓存，输入要算 `input + cache.read + cache.write`；每轮一条，按会话累加 |
| `done` | `session.idle` → `completed`；`session.error` → `error`（带 `error.name/data.message`）；`message.updated.info.finish === "length"` → `max-steps` 待确认 | abort 的情况本次没测 |
| （新增建议）`status` | `session.status`，`status.type: "busy" \| "retry" \| "idle"` | **`KernelEvent` 现在没有地方表达“重试中”**，但网关断连重试是真实发生的，界面要显示 `attempt`、`message` 和 `next`（下次重试时间戳），建议加一个 `{ type: 'retry'; attempt; message; nextAt }` 事件 |

其他：

- `opencodeDialect.spawn` 里 `permissionReplyPath` 返回 `/permission/{requestId}/reply` 是对的，body 字段是 `reply` 不是 `response`。
- `spawn` 应该把 `XDG_*_HOME` 和 `OPENCODE_DISABLE_EXTERNAL_SKILLS`、`OPENCODE_DISABLE_CLAUDE_CODE`、`OPENCODE_DISABLE_AUTOUPDATE` 一起传进去，否则内核会读写用户家目录的 OpenCode 数据并加载本机技能。注意 `XDG_DATA_HOME` 会影响同一进程树里的 fnm 等工具，只对子进程设。
- 一条 SSE 流里会夹着大量 `plugin.added`、`session.diff`、`server.heartbeat`（每 10 s），映射时忽略即可。
- 事件按 `properties.sessionID` 过滤，`/event` 是整个实例共享的。

## SSE 事件样本

均来自第 1 次（预热）运行，路径已替换为 `<workdir>`，时间为相对 `prompt_async` 的毫秒数。

```jsonc
// 51 ms  会话进入忙碌
{"type":"session.status","properties":{"sessionID":"ses_…","status":{"type":"busy"}}}

// 13831 ms  模型这一轮开始吐流（网关首字节）
{"type":"message.part.updated","properties":{"sessionID":"ses_…","part":{"id":"prt_…","messageID":"msg_…","sessionID":"ses_…","type":"step-start"}}}

// 16284 ms  推理 part 建立，随后的 message.part.delta 以 field:"text" 增量填充
{"type":"message.part.updated","properties":{"sessionID":"ses_…","part":{"id":"prt_R","messageID":"msg_…","type":"reasoning","text":"","time":{"start":1793698556748}}}}
{"type":"message.part.delta","properties":{"sessionID":"ses_…","messageID":"msg_…","partID":"prt_R","field":"text","delta":"Let"}}

// 16827 ms  工具调用：pending（参数还在流）→ running（参数齐了）
{"type":"message.part.updated","properties":{"sessionID":"ses_…","part":{"type":"tool","tool":"glob","callID":"call_00_cFfLF7FVwczf3QMm2xbY0453","state":{"status":"pending","input":{},"raw":""}}}}
{"type":"message.part.updated","properties":{"sessionID":"ses_…","part":{"type":"tool","tool":"glob","callID":"call_00_cFfLF7FVwczf3QMm2xbY0453","state":{"status":"running","input":{"pattern":"**/*.ts"},"time":{"start":1793698557289}}}}}

// 24816 ms  工具完成（与 step-finish 同一时刻）
{"type":"message.part.updated","properties":{"sessionID":"ses_…","part":{"type":"tool","tool":"glob","callID":"call_00_cFfLF7FVwczf3QMm2xbY0453","state":{"status":"completed","input":{"pattern":"**/*.ts"},"output":"<workdir>/a.ts\n<workdir>/b.ts","metadata":{"count":2,"truncated":false},"title":"<workdir>","time":{"start":1793698557289,"end":1793698565262}}}}}
{"type":"message.part.updated","properties":{"sessionID":"ses_…","part":{"type":"step-finish","reason":"tool-calls","tokens":{"total":10703,"input":10642,"output":46,"reasoning":15,"cache":{"write":0,"read":0}},"cost":0}}}

// 24816 ms  这一轮 assistant 消息收尾，带 token 用量
{"type":"message.updated","properties":{"sessionID":"ses_…","info":{"id":"msg_…","role":"assistant","agent":"build","modelID":"deepseek-v4-pro","providerID":"gateway","cost":0,"tokens":{"total":10703,"input":10642,"output":46,"reasoning":15,"cache":{"write":0,"read":0}},"time":{"created":1793698540496,"completed":1793698565273},"finish":"tool-calls"}}}

// 37980 ms  权限请求；回复 POST /permission/per_…/reply {"reply":"once"} 后 6 ms 收到 replied
{"type":"permission.asked","properties":{"id":"per_1a0c4400d001TLbXbC96jItDz1","sessionID":"ses_…","permission":"bash","patterns":["wc -l *.ts"],"metadata":{"command":"wc -l *.ts"},"always":["wc *"],"tool":{"messageID":"msg_…","callID":"call_00_ET_5cS8DLE2XpEMDsDQDqdA5929"}}}
{"type":"permission.replied","properties":{"sessionID":"ses_…","requestID":"per_1a0c4400d001TLbXbC96jItDz1","reply":"once"}}

// 51254 ms  完成：先 status idle 再 session.idle
{"type":"session.status","properties":{"sessionID":"ses_…","status":{"type":"idle"}}}
{"type":"session.idle","properties":{"sessionID":"ses_…"}}
```

第 2 次运行里的网关断连重试（相对毫秒）：

```jsonc
// 147863 ms
{"type":"session.status","properties":{"sessionID":"ses_…","status":{"type":"retry","attempt":1,"message":"Connection reset by server","next":1793698818881}}}
// 149965 ms  重发成功，回到 busy
{"type":"session.status","properties":{"sessionID":"ses_…","status":{"type":"busy"}}}
```

环境变量没传时的错误（`baseURL` 解析为空串）：

```jsonc
{"type":"session.error","properties":{"sessionID":"ses_…","error":{"name":"UnknownError","data":{"message":"Invalid URL"}}}}
```

## 下一步

- 同样的脚本再跑网关上的其他候选模型，比较首 token 和成功率后定主力模型；本文档追加一节即可。
- 补测 `abort`、`edit` 工具的权限和 `session.diff`，以及连续多轮对话。
- 把上面“启示”一节的改动做进 `packages/kernel`（`spawn` 的环境变量、`KernelEvent` 加重试状态、usage 计算）。
