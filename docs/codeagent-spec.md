# CodeAgent SDK 规格说明

> 本文档描述 CodeAgent 的 TypeScript/JavaScript 与 Python SDK，以及其背后的 HTTP + SSE 接口。
> 示例中的导入名以 `@codeagent3/sdk`（TS/JS）与 `codeagent_sdk`（Python）为主；Launcher 相关示例沿用历史作用域 `@codeagent/sdk`，原文即两种并存。
> 文中提到的“附录 A / 附录 B”均指本文档内的同名章节。

## 目录

1. [SDK使用指导](#ch1)
2. [Global 全局管理](#ch2)
3. [Global.Config 全局配置](#ch3)
4. [Session 会话管理](#ch4)
5. [Workspaces 工作区管理](#ch5)
6. [Find 查找 (项目级别)](#ch6)
7. [Event 事件订阅](#ch7)
8. [Permission 权限管理](#ch8)
9. [Question 问题管理](#ch9)
10. [Provider 模型提供商](#ch10)
11. [Config 配置管理 (项目级别)](#ch11)
12. [MCP 服务器管理](#ch12)
13. [Skill 技能管理](#ch13)
14. [Skills 技能安装管理](#ch14)
15. [Instance 实例管理](#ch15)
16. [App 应用管理](#ch16)
17. [Command 命令管理](#ch17)
18. [Launcher 服务器启动与管理](#ch18)
19. [Server 服务器管理](#ch19)
20. [附录 A: 公共类型](#ch20)
21. [附录 B: Event 类型](#ch21)
22. [Python SDK 流式对话示例](#ch22)
23. [TypeScript SDK 流式对话示例](#ch23)
24. [SDK 权限配置指导](#ch24)

---

<a id="ch1"></a>

# SDK使用指导

> 通过 Python 或 TypeScript SDK 将 CodeAgent CLI 的 Agent 能力以编程方式集成到自动化测试、CI/CD 与自定义工作流中。

## 一、概述

### 1.1 什么是 SDK

CodeAgent CLI SDK 提供 Python 与 TypeScript/JavaScript 两种语言的分发包，将 CLI 的 Agent 能力封装为可编程接口。SDK 基于 serve 端的 HTTP+SSE API 构建，包含会话管理、消息流、工具执行、权限交互等完整能力。

### 1.2 何时使用 SDK

- **自动化测试**：在测试用例中驱动 Agent 执行代码修改、文件操作，验证端到端行为
- **CI/CD 集成**：在流水线中调用 Agent 完成代码审查、批量修复、文档生成
- **自定义工作流**：将 Agent 嵌入业务系统，实现定制化 AI 编码场景
- **批量任务处理**：通过脚本调度多个 Agent 会话并行处理任务

### 1.3 何时不用 SDK 及替代方案

- **交互式编码辅助**：直接使用 `codeagent` 命令行或 IDE 插件，无需编写代码
- **单一命令执行**：使用 `codeagent -p "提示词"` 非交互模式即可

## 二、前置准备

### 2.1 下载安装 CodeAgent

- 已安装 CodeAgent CLI
- Node.js 18 及以上（TypeScript SDK）
- Python 3.10 及以上（Python SDK，建议 3.11+）

### 2.2 安装 SDK

SDK 以私有包形式分发，安装方式随部署环境而定，此处从略。下文示例统一使用以下导入名：

- TypeScript/JavaScript：`@codeagent3/sdk`
- Python：`codeagent_sdk`

### 2.3 完整接口文档

可执行 `codeagent generate <your-file-name>.json` 生成openapi.json

```bash
codeagent generate codeagent3-api.json
```

## 三、服务启动

CodeAgent CLI 从架构上进行了前后端的隔离，用户使用 SDK 调用时只需要启动 serve 端即可。

### serve 命令参数

| 参数 | 说明 |
| --- | --- |
| `--host <addr>` | 绑定地址 (默认 127.0.0.1) |
| `--port <number>` | 端口号 (默认 0，随机分配) |
| `--token <token>` | Bearer 认证令牌 |
| `--config-dir <path>` | 配置目录路径 |
| `--allow-non-loopback` | 允许非回环地址访问 (需 TLS + oauth/mtls) |
| `--tls-cert <path>` | TLS 证书路径 |
| `--tls-key <path>` | TLS 私钥路径 |
| `--auth <mode>` | 认证模式: bearer, oauth, mtls (默认 bearer) |
| `--allow-origin <origin>` | 允许的浏览器来源 (可重复) |

### 方式一：通过安装包启动（推荐）

打开命令行窗口执行：

```bash
codeagent serve
```

可使用--port 指定端口：

```bash
codeagent serve --port 3000
```

### 方式二：通过 SDK 内嵌二进制启动（暂不支持linux）

使用 SDK `dist/bin/` 目录下内嵌的 `codeagentcli` ：

```bash
dist\bin\codeagentcli.exe serve --port 3000
```

### 方式三：通过 SDK API 自启动（推荐用于自动化测试）

SDK 提供 `createCodeAgent` API，可自动启动 server 并返回 client，无需手动起serve手动管理进程。

**TypeScript:**

```typescript
import { createCodeAgent } from '@codeagent3/sdk';
import { homedir } from 'os';
import { join } from 'path';

const { client, server } = await createCodeAgent({
  cwd: process.cwd(),
  configDir: join(homedir(), '.cac'),
});
// 上面client是标准客户端，返回{ data, error, request?, response? }
// 若想直接返回data，使用Data-first客户端 const client = server.dataClient()
```

**Python:**

```python
from os.path import join
from pathlib import Path
from codeagent_sdk import create_code_agent

app = create_code_agent(
    cwd=Path.cwd(),
    config_dir=join(Path.home(), ".cac"),
)
client = app.client   # AuthenticatedClient
server = app.server   # CodeAgentServer
# Python 的 sync()/asyncio() 天然就是 data-first（直接返回 data），无需额外 dataClient()

# 使用完毕后关闭 server
server.close()
```

**对比：**

**手动启动（方式一/二）**：适用于交互式开发，需手动管理进程、配置端口和认证，适合调试和日志查看。

**自启动（方式三）**：适用于自动化测试和 CI/CD，SDK 自动管理进程生命周期、端口分配和认证，无需手动干预。

**推荐**：交互式开发使用方式一，自动化测试使用方式三。

### 启动成功标识

无论哪种方式，启动成功后 stdout 会输出一行 JSON：

```json
{ "type": "codeagent.server.ready", "base_url": "http://127.0.0.1:50773", "auth": { "token": "<YOUR_TOKEN>" }, "version": "..." }
```

> **手动启动方式**：记录 `base_url` 和 `auth.token`，后续步骤需要使用。
>
> **自启动方式无需手动记录**：`createCodeAgent` 返回的 `server.baseUrl` 和 `client` 已内置认证信息。

可通过health验证服务状态：

```bash
# 方式1：通过 URL 参数
curl http://localhost:3000/api/v1/global/health?access_token=YOUR_TOKEN

# 方式2：通过 Authorization header
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/api/v1/global/health
```

## 关闭服务

**手动启动方式**

手动启动的 server 需手动关闭终止 `codeagent serve` 进程。

**自启动方式**

使用 `createCodeAgent` 或 `createCodeAgentServer` 启动的 server，通过 API 关闭：

**TypeScript:**

```typescript
await server.close();
```

**Python:**

```python
server.close()
```

SDK 会自动清理临时配置目录并终止 server 进程。建议在 `finally` 块中调用以确保异常情况下也能清理。

## 四、第一个示例：创建会话并发送 Prompt

**TypeScript:**

```typescript
// examples/quickstart.ts
import { createCodeAgent } from '@codeagent3/sdk';
import { homedir } from 'os';
import { join } from 'path';

// 自启动 server，configDir 为必填参数
const { client, server } = await createCodeAgent({
  cwd: process.cwd(),
  configDir: join(homedir(), '.cac'),
});

try {
  // 创建会话
  const session = await client.session.create({
    directory: process.cwd(),
    title: 'Quickstart session',
  });

  // 发送异步 Prompt（promptAsync 接收 parts 数组，不是 prompt 字符串）
  await client.session.promptAsync({
    sessionID: session.id,
    parts: [{ type: 'text', text: '列出当前目录下的文件' }],
  });

  // 注意：本示例仅演示"创建会话 + 发送 Prompt"两步。
  // Prompt 执行结果通过 SSE 事件流推送，需订阅事件才能拿到响应内容。
  // 完整的"订阅事件 + 接收响应"示例见 子wiki TypeScript流式对话示例
} finally {
  // 使用完毕后关闭 server
  await server.close();
}
```

**Python:**

```python
# examples/quickstart.py
from os.path import join
from pathlib import Path
from codeagent_sdk import create_code_agent
from codeagent_sdk.api.session import session_create
from codeagent_sdk.api.prompt import session_prompt_async
from codeagent_sdk.models import SessionCreateRequest, PromptAsyncRequest
from codeagent_sdk.models.prompt_async_request_parts_item_type_0 import PromptAsyncRequestPartsItemType0

# 自启动 server
app = create_code_agent(
    cwd=Path.cwd(),
    config_dir=join(Path.home(), ".cac"),
)
client = app.client  # AuthenticatedClient
server = app.server  # CodeAgentServer

try:
    # 创建会话：Python SDK 使用模块级函数，第一个参数是 client
    create_response = session_create.sync_detailed(
        client=client,
        directory=str(Path.cwd()),
        body=SessionCreateRequest(title="Quickstart session"),
    )

    # 发送异步 Prompt：parts 数组每项需带 type='text' 字段
    session_prompt_async.sync_detailed(
        session_id=create_response.parsed.id,
        client=client,
        body=PromptAsyncRequest(
            parts=[PromptAsyncRequestPartsItemType0(type_="text", text="你好")],
        ),
    )
    print(f"sessionId={create_response.parsed.id}")
    print(f"create_response={create_response.content}")
    # 注意：本示例仅演示"创建会话 + 发送 Prompt"两步。
    # 完整的"订阅事件 + 接收响应"示例见 子Wiki python流式对话示例。
finally:
    # 使用完毕后关闭 server
    server.close()
```

## 五、事件驱动系统介绍

Serve 端内部的所有事件都会通过 SSE 连接返回给调用方，使用 SDK 订阅 `/global/event` 建立 SSE 长连接即可监听所有事件。

### 5.1 会话创建流程

1. 创建 Session：调用 `session.create` 接口
2. 订阅事件：通过 `event.subscribe` 建立 SSE 连接
3. 发送 Prompt：调用 `session.promptAsync` 发送消息
4. 接收事件：监听 SSE 事件流获取响应
5. 清理资源：关闭 Session 和 SSE 连接

### 5.2 消息流

消息流事件通过 `message.part.delta` 事件推送，包含以下字段：

- `type`: 消息类型，`'text'` 或 `'reasoning'`
- `partId`: 部分 ID，用于区分不同消息块
- `delta`: 增量内容

### 5.3 权限请求流程：由服务器主动推送

当 AI 需要执行敏感操作（如文件写入、命令执行）时，会通过 `permission.asked` 事件请求用户授权。

### 5.4 事件介绍

SDK 的接入本质可以分为两部分，一部分是请求接口，另一部分则是对 SSE 响应中的事件的处理。
核心事件类型定义：

```typescript
const EVENT_TYPES = [
  'session.created',
  'session.updated',
  'session.error',
  'prompt.accepted',
  'prompt.completed',
  'prompt.failed',
  'message.created',
  'message.delta',
  'message.part.delta',
  'message.completed',
  'permission.requested',
  'permission.replied',
  'permission.cancelled',
  'server.heartbeat',
] as const;
```

### Event 类型 (SSE 事件联合类型)

### 服务器生命周期事件

| 事件名称 | 事件类型 | 触发HTTP请求 | 功能说明 |
| --- | --- | --- | --- |
| server.connected | 全局事件 | `GET /global/event`（订阅SSE时自动发送） | 连接确认事件，客户端订阅SSE流时立即收到，表示连接已建立 |
| server.heartbeat | 全局事件 | 无（每10秒自动发送） | 心跳事件，保持SSE连接活跃，防止超时断开。携带`intervalMs`属性 |
| server.instance.disposed | 全局事件 | `POST /instance/dispose` | 实例销毁事件，携带`directory`属性，触发后SSE流关闭 |
| global.disposed | 全局事件 | `POST /global/dispose` | 全局销毁事件，触发后SSE流关闭 |

### 会话生命周期事件

| 事件名称 | 事件类型 | 触发HTTP请求 | 功能说明 |
| --- | --- | --- | --- |
| session.created | 会话事件 | `POST /session` | 会话创建事件，携带`sessionID`和完整的`info`对象 |
| session.updated | 会话事件 | `PATCH /session/{sessionID}` 或 Prompt执行过程中自动发送 | 会话更新事件，携带`sessionID`和最新的`info`对象 |
| session.deleted | 会话事件 | `DELETE /session/{sessionID}` | 会话删除事件，携带`sessionID`和被删除的`info`对象 |
| session.status | 会话事件 | Prompt执行开始/结束时自动发送 | 会话状态事件，携带`status: {type: 'idle'               \| 'busy'}` |
| session.idle | 会话事件 | Prompt执行结束（成功/失败/中止）时自动发送 | 会话空闲事件，表示会话进入空闲状态，可以处理新的Prompt |
| session.error | 会话事件 | Prompt执行出错时自动发送 | 会话错误事件，携带`error`对象（含`name`和`data`） |
| session.diff | 会话事件 | `GET /session/{sessionID}/diff`（查询后触发） | 会话差异事件，携带`diff`数组 |
| session.compacted | 会话事件 | `POST /session/{sessionID}/summarize` | 会话压缩事件，表示历史消息已被压缩 |
| session.state_changed | 会话事件 | 内部状态机变化时自动发送 | 状态变更事件，携带`state: 'idle'                       \| 'running' \| 'requires_action'` |

### Prompt生命周期事件

| 事件名称 | 事件类型 | 触发HTTP请求 | 功能说明 |
| --- | --- | --- | --- |
| prompt.accepted | 会话事件 | `POST /session/{sessionID}/prompt_async` | Prompt接受事件，携带`prompt_id`，表示请求已进入执行队列 |
| prompt.completed | 会话事件 | Prompt执行成功完成时自动发送 | Prompt完成事件，携带`status: 'completed'`和`result_message_id` |
| prompt.failed | 会话事件 | Prompt执行失败或 `POST /session/{sessionID}/abort` 中止时发送 | Prompt失败事件，携带`status: 'failed'`和`error`对象 |

### 消息事件

| 事件名称 | 事件类型 | 触发HTTP请求 | 功能说明 |
| --- | --- | --- | --- |
| message.created | 会话事件 | `POST /session/{sessionID}/prompt_async`（创建user/assistant消息时） | 消息创建事件，携带`sessionID`和消息内容 |
| message.updated | 会话事件 | 消息状态变化时自动发送（如assistant消息生成中） | 消息更新事件，携带`sessionID`和最新的`info`对象 |
| message.delta | 会话事件 | LLM流式输出时自动发送 | 消息增量事件，携带`delta_type`和增量内容，用于流式输出 |
| message.completed | 会话事件 | LLM响应完成时自动发送 | 消息完成事件，携带`message_id`和`status` |
| message.removed | 会话事件 | `DELETE /session/{sessionID}/message/{messageID}` | 消息删除事件，携带`sessionID`和`messageID` |
| message.part.updated | 会话事件 | Part状态变化时自动发送 | Part更新事件，携带`part`对象 |
| message.part.delta | 会话事件 | Part增量变化时自动发送 | Part增量事件，携带`field`和`delta`内容(与session.next.*重复) |
| message.part.removed | 会话事件 | Part删除时自动发送 | Part删除事件，携带`messageID`和`partID` |

### 工具执行事件（session.next.*）

这些事件在Prompt执行过程中自动发送，无需显式HTTP请求触发。

| 事件名称 | 事件类型 | 触发场景 | 功能说明 |
| --- | --- | --- | --- |
| session.next.step.started | 会话事件 | Prompt执行开始时 | 步骤开始事件，携带`agent`、`model`、`assistantMessageID` |
| session.next.step.ended | 会话事件 | Prompt执行完成时 | 步骤结束事件，携带`finish`、`cost`、`tokens`统计 |
| session.next.step.failed | 会话事件 | Prompt执行失败时 | 步骤失败事件，携带`error`对象 |
| session.next.text.started | 会话事件 | 文本生成开始时 | 文本开始事件，携带`textID` |
| session.next.text.delta | 会话事件 | 文本流式生成时 | 文本增量事件，携带`textID`和`delta`内容 |
| session.next.text.ended | 会话事件 | 文本生成结束时 | 文本结束事件，携带完整`text`内容 |
| session.next.reasoning.started | 会话事件 | 推理开始时 | 推理开始事件，携带`reasoningID` |
| session.next.reasoning.delta | 会话事件 | 推理流式输出时 | 推理增量事件，携带`delta`内容 |
| session.next.reasoning.ended | 会话事件 | 推理结束时 | 推理结束事件，携带完整推理文本 |
| session.next.tool.input.started | 会话事件 | 工具输入参数开始生成时 | 工具输入开始事件，携带`callID`和`name` |
| session.next.tool.input.delta | 会话事件 | 工具输入流式生成时 | 工具输入增量事件，携带增量参数 |
| session.next.tool.input.ended | 会话事件 | 工具输入生成完成时 | 工具输入结束事件，携带完整输入 |
| session.next.tool.called | 会话事件 | 工具开始执行时 | 工具调用事件，携带`tool`、`input`、`provider`信息 |
| session.next.tool.progress | 会话事件 | 工具执行过程中 | 工具进度事件，携带`structured`和`content` |
| session.next.tool.success | 会话事件 | 工具执行成功时 | 工具成功事件，携带`result`、`outputPaths` |
| session.next.tool.failed | 会话事件 | 工具执行失败时 | 工具失败事件，携带`error`对象 |
| session.next.retried | 会话事件 | API调用重试时 | 重试事件，携带`attempt`和`error` |
| session.next.compaction.started | 会话事件 | 上下文压缩开始时 | 压缩开始事件，携带`reason: 'auto'                        \| 'manual'` |
| session.next.compaction.delta | 会话事件 | 上下文压缩过程中 | 压缩增量事件，携带压缩文本 |
| session.next.compaction.ended | 会话事件 | 上下文压缩完成时 | 压缩结束事件，携带压缩摘要 |

### 会话控制事件（session.next.*）

| 事件名称 | 事件类型 | 触发场景 | 功能说明 |
| --- | --- | --- | --- |
| session.next.agent.switched | 会话事件 | Agent切换时 | Agent切换事件，携带新`agent`名称 |
| session.next.model.switched | 会话事件 | 模型切换时 | 模型切换事件，携带新`model`信息 |
| session.next.moved | 会话事件 | 工作目录切换时 | 目录切换事件，携带新`location` |
| session.next.prompted | 会话事件 | 新Prompt请求时 | Prompt请求事件，携带`prompt`和`delivery` |
| session.next.prompt.admitted | 会话事件 | Prompt进入队列时 | Prompt入队事件 |
| session.next.prompt.promoted | 会话事件 | Prompt提升时 | Prompt提升事件 |
| session.next.interrupt.requested | 会话事件 | 中断请求时 | 中断请求事件 |
| session.next.context.updated | 会话事件 | 上下文更新时 | 上下文更新事件 |
| session.next.synthetic | 会话事件 | 合成消息注入时 | 合成消息事件 |
| session.next.shell.started | 会话事件 | Shell命令开始时 | Shell开始事件，携带`command` |
| session.next.shell.ended | 会话事件 | Shell命令结束时 | Shell结束事件，携带`output` |

### 权限事件

| 事件名称 | 事件类型 | 触发HTTP请求 | 功能说明 |
| --- | --- | --- | --- |
| permission.requested | 会话事件 | 工具执行需要权限确认时自动发送 | 权限请求事件（别名：permission.asked），携带`permission`、`patterns`、`metadata` |
| permission.asked | 会话事件 | 同permission.requested | permission.requested的别名，兼容旧版API |
| permission.replied | 会话事件 | `POST /permission/{requestID}/reply` | 权限回复事件，携带`reply`和`effective_reply`（当降级时两者不同） |
| permission.cancelled | 会话事件 | `POST /session/{sessionID}/abort`（中止时取消待处理权限） | 权限取消事件，携带`reason` |
| permission.v2.asked | 会话事件 | V2权限请求发起时自动发送 | V2权限请求事件，携带`action`、`resources`、`save` |
| permission.v2.replied | 会话事件 | V2权限回复时自动发送 | V2权限回复事件，携带`requestID`和`reply` |

### 问题询问事件

| 事件名称 | 事件类型 | 触发HTTP请求 | 功能说明 |
| --- | --- | --- | --- |
| question.asked | 会话事件 | AskUserQuestion工具执行时自动发送 | 问题询问事件，携带`questions`数组 |
| question.replied | 会话事件 | `POST /question/{requestID}/reply` | 问题回复事件，携带`answers` |
| question.rejected | 会话事件 | `POST /question/{requestID}/reject` | 问题拒绝事件，携带`reason` |
| question.v2.asked | 会话事件 | V2问题询问时自动发送 | V2问题询问事件 |
| question.v2.replied | 会话事件 | V2问题回复时自动发送 | V2问题回复事件 |
| question.v2.rejected | 会话事件 | V2问题拒绝时自动发送 | V2问题拒绝事件 |

### 文件事件

| 事件名称 | 事件类型 | 触发场景 | 功能说明 |
| --- | --- | --- | --- |
| file.edited | 全局事件 | 文件编辑工具执行时 | 文件编辑事件，携带`file`路径 |
| file.watcher.updated | 全局事件 | 文件系统监听检测到变更时 | 文件监听事件，携带`file`和`event: 'add' \| 'change' \| 'unlink'` |

### 安装事件

| 事件名称 | 事件类型 | 触发场景 | 功能说明 |
| --- | --- | --- | --- |
| installation.updated | 全局事件 | 安装版本更新时 | 安装更新事件，携带`version` |
| installation.update-available | 全局事件 | 检测到新版本可用时 | 版本可用事件，携带新`version` |

### MCP事件

| 事件名称 | 事件类型 | 触发场景 | 功能说明 |
| --- | --- | --- | --- |
| mcp.tools.changed | 全局事件 | MCP服务器工具列表变更时 | MCP工具变更事件，携带`server`名称 |
| mcp.browser.open.failed | 全局事件 | MCP浏览器打开URL失败时 | MCP浏览器失败事件，携带`mcpName`和`url` |

### 账户事件

| 事件名称 | 事件类型 | 触发场景 | 功能说明 |
| --- | --- | --- | --- |
| account.added | 全局事件 | OAuth认证成功添加账户时 | 账户添加事件，携带`account`信息 |
| account.removed | 全局事件 | 账户被移除时 | 账户移除事件 |
| account.switched | 全局事件 | 账户切换时 | 账户切换事件，携带`from`和`to` |

### PTY事件

| 事件名称 | 事件类型 | 触发场景 | 功能说明 |
| --- | --- | --- | --- |
| pty.created | 全局事件 | 创建终端PTY时 | PTY创建事件，携带`info` |
| pty.updated | 全局事件 | PTY状态变化时 | PTY更新事件 |
| pty.exited | 全局事件 | PTY进程退出时 | PTY退出事件，携带`id`和`exitCode` |
| pty.deleted | 全局事件 | PTY被删除时 | PTY删除事件 |

### 任务事件

| 事件名称 | 事件类型 | 触发场景 | 功能说明 |
| --- | --- | --- | --- |
| task.started | 会话事件 | Agent工具启动子代理时 | 任务启动事件，携带`task_id`、`agent_type`、`description` |
| task.progress | 会话事件 | 子代理执行过程中 | 任务进度事件，携带`usage`、`last_tool_name`、`summary` |
| task.notification | 会话事件 | 子代理完成时 | 任务通知事件，携带`status: 'completed'                   \| 'failed' \| 'stopped'`、`output_file` |

### 项目事件

| 事件名称 | 事件类型 | 触发场景 | 功能说明 |
| --- | --- | --- | --- |
| project.directories.updated | 全局事件 | 项目目录变更时 | 项目目录更新事件 |
| project.updated | 全局事件 | 项目配置更新时 | 项目更新事件 |

### 工作区事件

| 事件名称 | 事件类型 | 触发场景 | 功能说明 |
| --- | --- | --- | --- |
| workspace.ready | 全局事件 | Workspace初始化完成时 | Workspace就绪事件 |
| workspace.failed | 全局事件 | Workspace初始化失败时 | Workspace失败事件 |
| workspace.status | 全局事件 | Workspace连接状态变化时 | Workspace状态事件 |

**工作树管理事件：**

| 事件名称 | 事件类型 | 触发场景 | 功能说明 |
| --- | --- | --- | --- |
| worktree.ready | 全局事件 | Worktree创建完成时 | Worktree就绪事件 |
| worktree.failed | 全局事件 | Worktree创建失败时 | Worktree失败事件 |

**项目管理事件：**

| 事件名称 | 事件类型 | 触发场景 | 功能说明 |
| --- | --- | --- | --- |
| project.directories.updated | 全局事件 | 项目目录变更时 | 项目目录更新事件 |
| project.updated | 全局事件 | 项目配置更新时 | 项目更新事件 |

### VCS事件

| 事件名称 | 事件类型 | 触发场景 | 功能说明 |
| --- | --- | --- | --- |
| vcs.branch.updated | 全局事件 | Git分支切换时 | 分支更新事件，携带`branch`名称 |

### LSP事件

| 事件名称 | 事件类型 | 触发场景 | 功能说明 |
| --- | --- | --- | --- |
| lsp.updated | 全局事件 | LSP服务状态变化时 | LSP更新事件 |

### 命令事件

| 事件名称 | 事件类型 | 触发HTTP请求 | 功能说明 |
| --- | --- | --- | --- |
| command.executed | 会话事件 | `POST /session/{sessionID}/command` | 命令执行事件，携带`name`、`arguments` |

### TUI事件

| 事件名称 | 事件类型 | 触发场景 | 功能说明 |
| --- | --- | --- | --- |
| tui.prompt.append | 全局事件 | TUI追加文本到输入框时 | TUI追加事件，携带`text` |
| tui.command.execute | 全局事件 | TUI执行命令时 | TUI命令事件，携带`command` |
| tui.toast.show | 全局事件 | TUI显示Toast提示时 | TUI Toast事件，携带`message`和`variant` |
| tui.session.select | 全局事件 | TUI选择会话时 | TUI选择事件，携带`sessionID` |

**模型管理事件：**

| 事件名称 | 事件类型 | 触发场景 | 功能说明 |
| --- | --- | --- | --- |
| models-dev.refreshed | 全局事件 | 开发模型列表刷新时 | 模型刷新事件 |
| catalog.model.updated | 全局事件 | 模型目录更新时 | 模型目录更新事件，携带`model`信息 |

### 插件事件

| 事件名称 | 事件类型 | 触发场景 | 功能说明 |
| --- | --- | --- | --- |
| plugin.added | 全局事件 | 插件安装成功时 | 插件添加事件，携带`id` |

### Todo事件

| 事件名称 | 事件类型 | 触发场景 | 功能说明 |
| --- | --- | --- | --- |
| todo.updated | 会话事件 | Todo工具更新任务列表时 | Todo更新事件，携带`todos`数组 |

## 六、FAQ

### 6.1 客户端Client区别

SDK中有两种客户端，标准客户端和Data-first客户端

#### 6.1.1 标准客户端，返回{ data, error, request?, response? }

```typescript
import { createCodeAgentClient, createCodeAgent } from '@codeagent3/sdk';

// 方式一 自动启动
const { client, server } = await createCodeAgent({
  cwd: process.cwd(),
});
// 方式二 手动启动
const client = createCodeAgentClient({
  baseUrl: 'http://127.0.0.1:50773',
  authToken: '<YOUR_TOKEN>',
  directory: process.cwd(),
});

// 返回 { data, error, request?, response? }
const sessionResp = await client.session.create({
  directory: process.cwd(),
  title: 'Example session',
});
console.log(sessionResp.data);
```

#### 6.1.2 Data-first客户端，直接返回data数据

```typescript
import { createCodeAgentDataClient } from '@codeagent3/sdk';

// 方式一 自启动
const { server } = await createCodeAgent({
  cwd: process.cwd(),
});
const client = server.dataClient(); // 返回data-first client，无需取.data获取数据

// 方式二
const client = createCodeAgentDataClient({
  baseUrl: 'http://127.0.0.1:50773',
  authToken: '<YOUR_TOKEN>',
  directory: process.cwd(),
});

// 方式三
const client = createCodeAgentClient({
  baseUrl: 'http://127.0.0.1:50773',
  authToken: '<YOUR_TOKEN>',
  directory: process.cwd(),
  responseStyle: 'data', // 也可在这里声明为data-first client
  throwOnError: true,
});

// 直接返回数据，无需处理响应包装
const session = await client.session.create({
  directory: process.cwd(),
  title: 'Example session',
});
console.log(session.id);
```

### 6.2 配置自定义模型

通过修改配置文件更新模型配置，自定义模型必须有提供商承载。

---

---

<a id="ch2"></a>

# Global 全局管理

全局级别的运行时管理和监控接口，独立于具体项目工作区。

| 接口方法 | 功能描述 | 使用场景 |
| --- | --- | --- |
| global.health | 获取 CodeAgent 服务器健康状态和版本信息 | 启动时验证服务可用性、监控探针、CI/CD 健康检查 |
| global.event | 以 Server-Sent Events 方式流式获取全局事件 | 实时监控所有会话状态变更、安装更新、账号变更等全局事件 |

## 1 global.health

| 项目 | 说明 |
| --- | --- |
| 接口名称 | global.health |
| 请求方法 | `GET` |
| 请求路径 | `/global/health` |
| 功能描述 | 获取 CodeAgent 服务器健康状态和版本信息 |
| 使用场景 | 启动时验证服务可用性、监控探针、CI/CD 健康检查 |

**请求参数**: 无

**响应参数**:

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `healthy` | `boolean` | 服务是否健康 |
| `version` | `string` | 服务器版本号 |

**使用实例**:

```typescript
// TypeScript
import { createCodeAgentDataClient } from '@codeagent/sdk'

const client = createCodeAgentDataClient({
  baseUrl: 'http://127.0.0.1:43123',
  authToken: 'your-token',
})
const health = await client.global.health()
// 预期结果: health: { healthy: true, version: "1.0.0" }
```

```python
# Python
from codeagent_sdk import AuthenticatedClient
from codeagent_sdk.api.global_ import global_health

client = AuthenticatedClient(
    base_url="http://127.0.0.1:43123/api/v1",
    token="your-token",
)
response = global_health.sync_detailed(client=client)
# 预期结果: GlobalHealthResponse(healthy=True, version="1.0.0")
```

---

### 2 global.event

| 项目 | 说明 |
| --- | --- |
| 接口名称 | global.event |
| 请求方法 | `GET` (SSE) |
| 请求路径 | `/global/event` |
| 功能描述 | 以 Server-Sent Events 方式流式获取全局事件 |
| 使用场景 | 实时监控所有会话状态变更、安装更新、账号变更等全局事件 |

**请求参数**: 无

**响应参数** (SSE 事件流):

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `directory` | `string` | 工作目录 |
| `project` | `string?` | 项目标识 |
| `workspace` | `string?` | 工作区标识 |
| `payload` | `Event` | 事件负载 (详见附录B Event 类型) |

**使用实例**:

```typescript
// TypeScript
const stream = await client.global.event()
for await (const event of stream) {
  console.log('Global event:', event)
}
// 预期结果: AsyncIterable<GlobalEvent> SSE事件流
```

```python
# Python (SSE 需使用 httpx 流式处理)
from codeagent_sdk.api.global_ import global_event

response = global_event.sync_detailed(client=client)
# 处理 SSE 流
# 预期结果: SSE事件流，需使用httpx流式处理
```

---

---

---

<a id="ch3"></a>

# Global.Config 全局配置

全局配置管理，影响所有项目工作区。

| 接口方法 | 功能描述 | 使用场景 |
| --- | --- | --- |
| global.config.get | 获取全局配置信息 | 读取默认模型、权限策略、MCP 配置等 |
| global.config.update | 部分更新全局配置，触发生命周期副作用 | 切换默认模型、修改权限策略、启用/禁用提供商 |

## 1 global.config.get

| 项目 | 说明 |
| --- | --- |
| 接口名称 | global.config.get |
| 请求方法 | `GET` |
| 请求路径 | `/global/config` |
| 功能描述 | 获取全局配置信息 |
| 使用场景 | 读取默认模型、权限策略、MCP 配置等 |

**请求参数**: 无

**响应参数** (`ConfigInfo`):

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `$schema` | `string?` | JSON Schema 标识 |
| `model` | `string?` | 默认模型 |
| `permission` | `object?` | 权限配置 |
| `provider` | `object?` | 提供商配置 |
| `agent` | `object?` | Agent 配置 |
| `command` | `object?` | 命令配置 |
| `mcp` | `object?` | MCP 配置 |
| `tools` | `object?` | 工具开关配置 |
| `instructions` | `string[]?` | 全局指令 |
| `plugin` | `unknown[]?` | 插件列表 |
| `disabled_providers` | `string[]?` | 禁用的提供商 |
| `enabled_providers` | `string[]?` | 启用的提供商 |
| `server` | `object?` | 服务器配置（含 `port`、`hostname`、`mdns`、`mdnsDomain`、`cors`、`maxActivePrompts`、`maxActivePromptsPerWorkspace`） |
| `env` | `object?` | 环境变量配置 |
| `enterprise` | `object?` | 企业配置 |
| `hooks` | `object?` | 钩子配置 |
| `worktree` | `object?` | 工作树配置 |
| `sandbox` | `object?` | 沙箱配置 |
| `temperature` | `number?` | 模型温度 |
| `topP` | `number?` | 模型 Top-P |
| `frequencyPenalty` | `number?` | 频率惩罚 |
| `presencePenalty` | `number?` | 存在惩罚 |
| `availableModels` | `string[]?` | 可用模型列表 |
| `modelOverrides` | `object?` | 模型覆盖配置 |
| `permissions` | `object?` | 权限规则配置 |
| `mcpServers` | `object?` | MCP 服务器配置 |
| `language` | `string?` | 语言设置 |
| `outputStyle` | `string?` | 输出风格 |
| `sensitiveFilePatterns` | `object?` | 敏感文件模式 |

**使用实例**:

```typescript
// TypeScript
const config = await client.global.config.get()
console.log(config.model, config.permission)
// 预期结果: config: { model: "default-model", permission: {...}, ... }
```

```python
# Python
from codeagent_sdk.api.global_ import global_config_get

response = global_config_get.sync_detailed(client=client)
print(response.parsed.model, response.parsed.permission)
# 预期结果: ConfigInfo(model="default-model", permission={...}, ...)
```

---

### 2 global.config.update

| 项目 | 说明 |
| --- | --- |
| 接口名称 | global.config.update |
| 请求方法 | `PATCH` |
| 请求路径 | `/global/config` |
| 功能描述 | 部分更新全局配置，触发生命周期副作用 |
| 使用场景 | 切换默认模型、修改权限策略、启用/禁用提供商 |

**请求参数** (`ConfigPatch`):

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `$schema` | body | `string` | 否 | JSON Schema 标识 |
| `model` | body | `string` | 否 | 默认模型 |
| `permission` | body | `object` | 否 | 权限配置 |
| `provider` | body | `object` | 否 | 提供商配置 |
| `agent` | body | `object` | 否 | Agent 配置 |
| `command` | body | `object` | 否 | 命令配置 |
| `mcp` | body | `object` | 否 | MCP 配置 |
| `tools` | body | `object` | 否 | 工具开关 |
| `instructions` | body | `string[]` | 否 | 全局指令 |
| `plugin` | body | `unknown[]` | 否 | 插件列表 |
| `disabled_providers` | body | `string[]` | 否 | 禁用的提供商 |
| `enabled_providers` | body | `string[]` | 否 | 启用的提供商 |
| `server` | body | `object` | 否 | 服务器配置（含 `port`、`hostname`、`mdns`、`mdnsDomain`、`cors`、`maxActivePrompts`、`maxActivePromptsPerWorkspace`） |
| `env` | body | `object` | 否 | 环境变量配置 |
| `enterprise` | body | `object` | 否 | 企业配置 |
| `hooks` | body | `object` | 否 | 钩子配置 |
| `worktree` | body | `object` | 否 | 工作树配置 |
| `sandbox` | body | `object` | 否 | 沙箱配置 |
| `temperature` | body | `number` | 否 | 模型温度 |
| `topP` | body | `number` | 否 | 模型 Top-P |
| `frequencyPenalty` | body | `number` | 否 | 频率惩罚 |
| `presencePenalty` | body | `number` | 否 | 存在惩罚 |
| `availableModels` | body | `string[]` | 否 | 可用模型列表 |
| `modelOverrides` | body | `object` | 否 | 模型覆盖配置 |
| `permissions` | body | `object` | 否 | 权限规则配置 |
| `mcpServers` | body | `object` | 否 | MCP 服务器配置 |
| `language` | body | `string` | 否 | 语言设置 |
| `outputStyle` | body | `string` | 否 | 输出风格 |
| `sensitiveFilePatterns` | body | `object` | 否 | 敏感文件模式 |

**响应参数**: `ConfigInfo` (返回更新后的完整配置)

**使用实例**:

```typescript
// TypeScript
await client.global.config.update({
  model: 'default-model',
  permission: { mode: 'acceptEdits' },
})
// 预期结果: ConfigInfo (返回更新后的完整配置)
```

```python
# Python
from codeagent_sdk.api.global_ import global_config_update
from codeagent_sdk.models import ConfigPatch

global_config_update.sync_detailed(
    client=client,
    body=ConfigPatch(model="default-model"),
)
# 预期结果: ConfigInfo (返回更新后的完整配置)
```

---

---

---

<a id="ch4"></a>

# Session 会话管理

会话是 CodeAgent 与用户交互的核心单元，包含消息、提示词、权限等完整上下文。

| 接口方法 | 功能描述 | 使用场景 |
| --- | --- | --- |
| session.list | 获取会话列表，支持筛选 | 会话历史浏览、搜索特定会话、仪表盘展示 |
| session.create | 创建新的对话会话 | 开始新对话、AI 编程任务启动 |
| session.get | 获取单个会话详细信息 | 查看会话详情、检查会话状态 |
| session.update | 更新会话属性（标题、元数据、权限、归档） | 修改会话标题、设置权限规则、归档会话 |
| session.delete | 删除指定会话 | 清理测试会话、删除不需要的对话 |
| session.status | 获取所有会话的运行状态映射 | 仪表盘展示会话是否繁忙、是否需要重试 |
| session.messages | 获取会话消息列表（含消息部件） | 获取对话历史、展示聊天记录 |
| session.promptAsync | 向会话发送提示词后立即返回，通过事件流获取结果 | 长时间任务、需要流式输出、非阻塞式交互 |
| session.abort | 中止当前正在运行的提示词 | 用户取消操作、任务超时中断 |
| session.command | 在会话中执行预定义命令 (slash command) | 以斜杠命令的方式执行skill或command |
| session.context | 获取会话上下文使用情况 | 监控上下文窗口用量、判断是否需要压缩 |
| session.fork | 从指定消息处分叉出新会话 | 探索不同方案、回到历史节点重新开始 |
| session.diff | 获取会话中文件变更差异 | 审查代码修改、查看文件变更摘要 |
| session.summarize | 使用指定模型对会话内容生成摘要 | 长对话压缩、上下文管理 |
| session.children | 获取指定会话的子会话列表 | 查看分支会话、子任务会话 |
| session.revert | 回退会话到指定消息 | 撤销操作、回到历史状态 |

## 1 session.list

| 项目 | 说明 |
| --- | --- |
| 接口名称 | session.list |
| 请求方法 | `GET` |
| 请求路径 | `/session` |
| 功能描述 | 获取会话列表，支持筛选 |
| 使用场景 | 会话历史浏览、搜索特定会话、仪表盘展示 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |
| `scope` | query | `'project'` | 否 | 作用域 |
| `path` | query | `string` | 否 | 路径筛选 |
| `roots` | query | `boolean \| 'true' \| 'false'` | 否 | 是否只返回根会话 |
| `start` | query | `number` | 否 | 时间起始点（毫秒Unix时间戳） |
| `search` | query | `string` | 否 | 搜索关键词 |
| `limit` | query | `number` | 否 | 返回数量限制 |

**响应参数**: `Session[]` (详见附录A Session 类型)

**使用实例**:

```typescript
// TypeScript
const sessions = await client.session.list({
  directory: process.cwd(),
  limit: 10,
  search: 'refactor',
})
// 预期结果: sessions: Session[]
```

```python
# Python
from codeagent_sdk.api.session import session_list

response = session_list.sync_detailed(
    client=client,
    directory=str(Path.cwd()),
    limit=10,
    search="refactor",
)
# 预期结果: Session[]
```

---

### 2 session.create

| 项目 | 说明 |
| --- | --- |
| 接口名称 | session.create |
| 请求方法 | `POST` |
| 请求路径 | `/session` |
| 功能描述 | 创建新的对话会话 |
| 使用场景 | 开始新对话、AI 编程任务启动 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |
| `parentID` | body | `string` | 否 | 父会话 ID |
| `title` | body | `string` | 否 | 会话标题 |
| `agent` | body | `string` | 否 | 指定 Agent 名称 |
| `model` | body | `object` | 否 | 模型选择 `{ providerID, id, variant? }` |
| `metadata` | body | `object` | 否 | 自定义元数据 |
| `permission` | body | `PermissionRule[]` | 否 | 权限规则集 |
| `permission_mode` | body | `'default' \| 'acceptEdits' \| 'bypassPermissions' \| 'dontAsk'` | 否 | 权限模式 |
| `workspaceID` | body | `string` | 否 | 工作区 ID |

**响应参数**: `Session` 对象（完整 Session 类型定义见附录A）

**使用实例**:

```typescript
// TypeScript
const session = await client.session.create({
  directory: process.cwd(),
  title: 'My coding session',
  agent: 'code',
  model: { providerID: 'default', id: 'default-model' },
})
// 预期结果: session: { id: "sess-xxx", title: "My coding session", agent: "code", ... }
```

```python
# Python
from codeagent_sdk.api.session import session_create
from codeagent_sdk.models import SessionCreateRequest

response = session_create.sync_detailed(
    client=client,
    directory=str(Path.cwd()),
    body=SessionCreateRequest(title="My coding session"),
)
# 预期结果: Session(id="sess-xxx", title="My coding session", ...)
```

---

### 3 session.get

| 项目 | 说明 |
| --- | --- |
| 接口名称 | session.get |
| 请求方法 | `GET` |
| 请求路径 | `/session/{sessionID}` |
| 功能描述 | 获取单个会话详细信息 |
| 使用场景 | 查看会话详情、检查会话状态 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionID` | path | `string` | 是 | 会话 ID |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |

**响应参数**: `Session` 对象

**使用实例**:

```typescript
// TypeScript
const session = await client.session.get({ sessionID: 'sess-123' })
// 预期结果: session: { id: "sess-123", title: "...", ... }
```

```python
# Python
from codeagent_sdk.api.session import session_get

response = session_get.sync_detailed(client=client, session_id="sess-123")
# 预期结果: Session(id="sess-123", ...)
```

---

### 4 session.update

| 项目 | 说明 |
| --- | --- |
| 接口名称 | session.update |
| 请求方法 | `PATCH` |
| 请求路径 | `/session/{sessionID}` |
| 功能描述 | 更新会话属性（标题、元数据、权限、归档） |
| 使用场景 | 修改会话标题、设置权限规则、归档会话 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionID` | path | `string` | 是 | 会话 ID |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |
| `title` | body | `string` | 否 | 新标题 |
| `metadata` | body | `object` | 否 | 自定义元数据 |
| `permission` | body | `PermissionRule[]` | 否 | 权限规则集 |
| `permission_mode` | body | `'default' \| 'acceptEdits' \| 'bypassPermissions' \| 'dontAsk'` | 否 | 权限模式 |
| `time` | body | `{ archived?: number }` | 否 | 时间相关设置 |

**使用实例**:

```typescript
// TypeScript
await client.session.update({
  sessionID: 'sess-123',
  title: 'Updated title',
  time: { archived: Date.now() },
})
// 预期结果: Session (返回更新后的会话)
```

```python
# Python
from codeagent_sdk.api.session import session_update
from codeagent_sdk.models import SessionUpdateRequest

session_update.sync_detailed(
    client=client,
    session_id="sess-123",
    body=SessionUpdateRequest(title="Updated title"),
)
# 预期结果: Session (返回更新后的会话)
```

---

### 5 session.delete

| 项目 | 说明 |
| --- | --- |
| 接口名称 | session.delete |
| 请求方法 | `DELETE` |
| 请求路径 | `/session/{sessionID}` |
| 功能描述 | 删除指定会话 |
| 使用场景 | 清理测试会话、删除不需要的对话 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionID` | path | `string` | 是 | 会话 ID |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |

**响应参数**: `boolean` (删除是否成功)

**使用实例**:

```typescript
// TypeScript
await client.session.delete({ sessionID: 'sess-123' })
```

```python
# Python
from codeagent_sdk.api.session import session_delete

session_delete.sync_detailed(client=client, session_id="sess-123")
# 预期结果: True (会话已删除)
```

---

### 6 session.status

| 项目 | 说明 |
| --- | --- |
| 接口名称 | session.status |
| 请求方法 | `GET` |
| 请求路径 | `/session/status` |
| 功能描述 | 获取所有会话的运行状态映射 |
| 使用场景 | 仪表盘展示会话是否繁忙、是否需要重试 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |

**响应参数**: `SessionStatusMap` (`{ [sessionID: string]: ` `SessionStatus` ` }`)

其中 `SessionStatus` 为联合类型:
- `{ type: 'idle' }` — 空闲
- `{ type: 'busy' }` — 繁忙
- `{ type: 'retry', attempt, message, next }` — 重试中

**使用实例**:

```typescript
// TypeScript
const statusMap = await client.session.status({ directory: process.cwd() })
// 预期结果: statusMap: { "sess-123": { type: "idle" }, "sess-456": { type: "busy" } }
for (const [id, status] of Object.entries(statusMap)) {
  console.log(id, status.type)
}
```

```python
# Python
from codeagent_sdk.api.session import session_status

response = session_status.sync_detailed(client=client, directory=str(Path.cwd()))
for sid, status in (response.parsed or {}).items():
    print(sid, status.type)
# 预期结果: { "sess-123": SessionStatus(type="idle"), ... }
```

---

### 7 session.messages

| 项目 | 说明 |
| --- | --- |
| 接口名称 | session.messages |
| 请求方法 | `GET` |
| 请求路径 | `/session/{sessionID}/message` |
| 功能描述 | 获取会话消息列表（含消息部件） |
| 使用场景 | 获取对话历史、展示聊天记录 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionID` | path | `string` | 是 | 会话 ID |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |
| `limit` | query | `number` | 否 | 返回数量限制 |
| `before` | query | `string` | 否 | 游标：该 ID 之前的消息 |

**响应参数**: `MessageWithParts[]` (详见附录A)

**使用实例**:

```typescript
// TypeScript
const messages = await client.session.messages({
  sessionID: 'sess-123',
  limit: 20,
})
// 预期结果: messages: MessageWithParts[]
```

```python
# Python
from codeagent_sdk.api.session import session_messages

response = session_messages.sync_detailed(
    client=client, session_id="sess-123", limit=20,
)
# 预期结果: MessageWithParts[]
```

---

### 8 session.promptAsync

| 项目 | 说明 |
| --- | --- |
| 接口名称 | session.promptAsync |
| 请求方法 | `POST` |
| 请求路径 | `/session/{sessionID}/prompt_async` |
| 功能描述 | 向会话发送提示词后立即返回，通过事件流获取结果 |
| 使用场景 | 长时间任务、需要流式输出、非阻塞式交互 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionID` | path | `string` | 是 | 会话 ID |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |
| `messageID` | body | `string` | 否 | 消息 ID |
| `model` | body | `{ providerID, modelID }` | 否 | 模型覆盖 |
| `agent` | body | `string` | 否 | Agent 覆盖 |
| `noReply` | body | `boolean` | 否 | 不等待回复 |
| `tools` | body | `{ [key: string]: boolean }` | 否 | 工具开关 |
| `format` | body | `object` | 否 | 输出格式 (text / json_schema) |
| `system` | body | `string` | 否 | 系统提示词 |
| `variant` | body | `string` | 否 | 模型变体 |
| `access_mode` | body | `'read' \| 'write'` | 否 | 访问模式 |
| `permission_mode` | body | `'default' \| 'acceptEdits' \| 'bypassPermissions' \| 'dontAsk'` | 否 | 权限模式 |
| `parts` | body | `PartInput[]` | 是 | 消息部件数组 |
| `thinking_config` | body | `{ type: 'enabled', budget_tokens?: number } \| { type: 'disabled' }` | 否 | 推理（thinking）配置 |

**parts 类型说明**:
- `{ type: 'text', text: string }` — 文本内容
- `{ type: 'file', mime, filename?, url, source?, id? }` — 文件附件
- `{ type: 'agent', name, prompt? }` — Agent 调用
- `{ type: 'subtask', description? }` — 子任务

**响应参数**: HTTP `204 No Content`，提示词已接收。实际生成内容通过 SSE 事件流（event.subscribe）获取。

**使用实例**:

```typescript
// TypeScript - 异步提示词 + 事件流
const stream = await client.event.subscribe({ directory: process.cwd() })

await client.session.promptAsync({
  sessionID: session.id,
  parts: [{ type: 'text', text: 'Refactor this code' }],
  format: { type: 'text' },
})
// 预期结果: 204 No Content (提示词已接受，通过事件流获取结果)

for await (const event of stream.stream) {
  console.log('Event:', event)
}
```

```python
# Python
from codeagent_sdk.api.prompt import session_prompt_async

response = session_prompt_async.sync_detailed(
    client=client,
    session_id=session.id,
    body=PromptAsyncRequest(
        parts=[PromptPartText(type="text", text="Refactor this code")],
    ),
)
# 预期结果: 204 No Content (提示词已接受)
```

---

### 9 session.abort

| 项目 | 说明 |
| --- | --- |
| 接口名称 | session.abort |
| 请求方法 | `POST` |
| 请求路径 | `/session/{sessionID}/abort` |
| 功能描述 | 中止当前正在运行的提示词 |
| 使用场景 | 用户取消操作、任务超时中断 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionID` | path | `string` | 是 | 会话 ID |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |

**响应参数**: `boolean` (中止是否成功)

**使用实例**:

```typescript
// TypeScript
await client.session.abort({ sessionID: 'sess-123' })
// 预期结果: true (提示词已中止)
```

```python
# Python
from codeagent_sdk.api.prompt import session_abort

session_abort.sync_detailed(client=client, session_id="sess-123")
```

---

### 10 session.command

| 项目 | 说明 |
| --- | --- |
| 接口名称 | session.command |
| 请求方法 | `POST` |
| 请求路径 | `/session/{sessionID}/command` |
| 功能描述 | 在会话中执行预定义命令 (slash command) |
| 使用场景 | 以斜杠命令的方式执行skill或command |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionID` | path | `string` | 是 | 会话 ID |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |
| `messageID` | body | `string` | 否 | 消息 ID |
| `agent` | body | `string` | 否 | Agent 名称 |
| `model` | body | `string` | 否 | 模型标识 |
| `arguments` | body | `string` | 否 | 命令参数 |
| `command` | body | `string` | 否 | skill/command名称 |
| `variant` | body | `string` | 否 | 模型变体 |
| `parts` | body | `FilePart[]` | 否 | 文件附件 |

**响应参数**: `SessionCommandResponse` (`{ info, parts }`)

**使用实例**:

```typescript
// TypeScript
const result = await client.session.command({
  sessionID: session.id,
  command: 'statusline',
  arguments: '',
})
// 预期结果: result: { info: { id: "msg-xxx", role: "assistant", ... }, parts: [...] }
```

```python
# Python
from codeagent_sdk.api.session import session_command

response = session_command.sync_detailed(
    client=client,
    session_id=session.id,
    body=SessionCommandRequest(command="statusline", arguments=""),
)
# 预期结果: SessionCommandResponse(info=..., parts=[...])
```

---

### 11 session.context

| 项目 | 说明 |
| --- | --- |
| 接口名称 | session.context |
| 请求方法 | `GET` |
| 请求路径 | `/session/{sessionID}/context` |
| 功能描述 | 获取会话上下文使用情况 |
| 使用场景 | 监控上下文窗口用量、判断是否需要压缩 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionID` | path | `string` | 是 | 会话 ID |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |

**响应参数** (`SessionContextResponse`):

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `session_id` | `string?` | 会话 ID |
| `token_budget` | `SessionContextTokenBudget?` | Token 预算信息 |
| `compact` | `SessionContextCompact?` | 压缩状态信息 |
| `attachments` | `SessionContextAttachment[]?` | 上下文附件列表 |
| `summary` | `string?` | 上下文摘要 |

**SessionContextTokenBudget**:

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `used` | `number?` | 已使用的 Token 数 |
| `available` | `number?` | 最大上下文窗口 Token 数 |
| `percentage` | `number?` | 上下文使用百分比（0-100） |

**SessionContextCompact**:

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `available` | `boolean?` | 是否可压缩 |
| `last_compacted_at` | `string?` | 上次压缩时间 |
| `reason` | `string?` | 压缩原因 |

**SessionContextAttachment**:

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | `string` | 附件类型 |
| `path` | `string?` | 附件路径 |
| `uri` | `string?` | 附件 URI |

**使用实例**:

```typescript
// TypeScript
const ctx = await client.session.context({ sessionID: 'sess-123' })
console.log(ctx.token_budget?.percentage)
// 预期结果: { session_id: "sess-123", token_budget: { used: 45000, available: 128000, percentage: 35 }, compact: { available: true }, attachments: [], summary: "..." }
```

```python
# Python
from codeagent_sdk.api.session import session_context

response = session_context.sync_detailed(client=client, session_id="sess-123")
# 预期结果: SessionContextResponse(session_id="sess-123", token_budget={...}, compact={...})
```

---

### 12 session.fork

| 项目 | 说明 |
| --- | --- |
| 接口名称 | session.fork |
| 请求方法 | `POST` |
| 请求路径 | `/session/{sessionID}/fork` |
| 功能描述 | 从指定消息处分叉出新会话 |
| 使用场景 | 探索不同方案、回到历史节点重新开始 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionID` | path | `string` | 是 | 原会话 ID |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |
| `messageID` | body | `string` | 否 | 分叉点消息 ID |

**响应参数**: `Session` (新会话)

**使用实例**:

```typescript
// TypeScript
const forked = await client.session.fork({
  sessionID: session.id,
  messageID: 'msg-456',
})
// 预期结果: forked: { id: "sess-new", parentID: "sess-123", ... } (新会话)
```

```python
# Python
from codeagent_sdk.api.session import session_fork

response = session_fork.sync_detailed(
    client=client,
    session_id=session.id,
    body=SessionForkRequest(message_id="msg-456"),
)
```

---

### 13 session.diff

| 项目 | 说明 |
| --- | --- |
| 接口名称 | session.diff |
| 请求方法 | `GET` |
| 请求路径 | `/session/{sessionID}/diff` |
| 功能描述 | 获取会话中文件变更差异 |
| 使用场景 | 审查代码修改、查看文件变更摘要 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionID` | path | `string` | 是 | 会话 ID |
| `messageID` | query | `string` | 否 | 指定消息 ID |

**响应参数**: `SnapshotFileDiffArray`

**使用实例**:

```typescript
// TypeScript
const diffs = await client.session.diff({ sessionID: 'sess-123' })
diffs.forEach(d => console.log(d.file, d.status))
// 预期结果: diffs: [{ file: "src/index.ts", status: "modified", additions: 5, deletions: 2, patch: "..." }]
```

```python
# Python
from codeagent_sdk.api.session import session_diff

response = session_diff.sync_detailed(client=client, session_id="sess-123")
for d in (response.parsed or []):
    print(d.file, d.status)
# 预期结果: [{ file: "src/index.ts", status: "modified", additions: 5, deletions: 2 }]
```

---

### 14 session.summarize

| 项目 | 说明 |
| --- | --- |
| 接口名称 | session.summarize |
| 请求方法 | `POST` |
| 请求路径 | `/session/{sessionID}/summarize` |
| 功能描述 | 使用指定模型对会话内容生成摘要 |
| 使用场景 | 长对话压缩、上下文管理 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionID` | path | `string` | 是 | 会话 ID |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |
| `providerID` | body | `string` | 是 | 提供商 ID |
| `modelID` | body | `string` | 是 | 模型 ID |
| `auto` | body | `boolean` | 否 | 是否自动摘要 |

**响应参数**: `boolean` (摘要是否成功)

**使用实例**:

```typescript
// TypeScript
await client.session.summarize({
  sessionID: 'sess-123',
  providerID: 'default',
  modelID: 'default-model',
})
// 预期结果: true (摘要生成成功)
```

```python
# Python
from codeagent_sdk.api.session import session_summarize
from codeagent_sdk.models import SessionSummarizeRequest

session_summarize.sync_detailed(
    client=client,
    session_id="sess-123",
    body=SessionSummarizeRequest(
        provider_id="default",
        model_id="default-model",
    ),
)
```

---

### 15 session.children

| 项目 | 说明 |
| --- | --- |
| 接口名称 | session.children |
| 请求方法 | `GET` |
| 请求路径 | `/session/{sessionID}/children` |
| 功能描述 | 获取指定会话的子会话列表 |
| 使用场景 | 查看分支会话、子任务会话 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionID` | path | `string` | 是 | 父会话 ID |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |

**响应参数**: `Session[]`

**使用实例**:

```typescript
// TypeScript
const children = await client.session.children({ sessionID: 'sess-123' })
```

```python
# Python
from codeagent_sdk.api.session import session_children

response = session_children.sync_detailed(client=client, session_id="sess-123")
```

---

### 16 session.revert

| 项目 | 说明 |
| --- | --- |
| 接口名称 | session.revert |
| 请求方法 | `POST` |
| 请求路径 | `/session/{sessionID}/revert` |
| 功能描述 | 回退会话到指定消息 |
| 使用场景 | 撤销操作、回到历史状态 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionID` | path | `string` | 是 | 会话 ID |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |
| `messageID` | body | `string` | 是 | 回退目标消息 ID |
| `partID` | body | `string` | 否 | 回退目标部件 ID |

**响应参数**: `Session` 对象

**使用实例**:

```typescript
// TypeScript
const session = await client.session.revert({
  sessionID: 'sess-123',
  messageID: 'msg-456',
})
// 预期结果: session: { id: "sess-123", revert: { messageID: "msg-456", ... }, ... }
```

```python
# Python
from codeagent_sdk.api.session import session_revert

response = session_revert.sync_detailed(
    client=client,
    session_id="sess-123",
    body=SessionRevertRequest(message_id="msg-456"),
)
# 预期结果: Session (已回退)
```

---

---

---

<a id="ch5"></a>

# Workspaces 工作区管理

工作区是项目级别的隔离单元，支持独立的环境变量、根目录和权限策略。

| 接口方法 | 功能描述 | 使用场景 |
| --- | --- | --- |
| workspaces.list | 分页获取工作区列表 | 工作区选择器、管理面板 |
| workspaces.create | 创建新的工作区 | 初始化项目环境、多项目并行 |
| workspaces.get | 获取指定工作区详情 | 验证工作区存在、获取配置 |
| workspaces.agents | 获取工作区可用的 Agent 列表 | Agent 选择器、查看可用 Agent |
| workspaces.commands | 获取工作区可用的命令列表 | 命令选择器、帮助面板 |
| workspaces.skills | 获取工作区可用的技能列表 | 技能选择器、查看可用技能 |
| workspaces.tools | 获取工作区可用的工具列表 | 工具选择器、查看工具输入 Schema |

## 1 workspaces.list

| 项目 | 说明 |
| --- | --- |
| 接口名称 | workspaces.list |
| 请求方法 | `GET` |
| 请求路径 | `/workspaces` |
| 功能描述 | 分页获取工作区列表 |
| 使用场景 | 工作区选择器、管理面板 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `cursor` | query | `string` | 否 | 分页游标 |
| `limit` | query | `number` | 否 | 返回数量限制 |
| `cwd` | query | `string` | 否 | 当前工作目录 |

**响应参数** (`WorkspacePage`):

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `data` | `Workspace[]` | 工作区列表 |
| `next_cursor` | `string \| null` | 下一页游标 |

**使用实例**:

```typescript
// TypeScript
const page = await client.workspaces.list({ limit: 10 })
page.data.forEach(w => console.log(w.id, w.name))
// 预期结果: page: { data: [{ id: "ws-1", cwd: "/path/to/project", ... }], next_cursor: null }
```

```python
# Python
from codeagent_sdk.api.workspace import workspaces_list

response = workspaces_list.sync_detailed(client=client, limit=10)
for w in (response.parsed.data or []):
    print(w.id, w.name)
# 预期结果: WorkspacePage(data=[Workspace(id="ws-1", ...)], next_cursor=None)
```

---

### 2 workspaces.create

| 项目 | 说明 |
| --- | --- |
| 接口名称 | workspaces.create |
| 请求方法 | `POST` |
| 请求路径 | `/workspaces` |
| 功能描述 | 创建新的工作区 |
| 使用场景 | 初始化项目环境、多项目并行 |

**请求参数** (`WorkspaceCreateRequest`):

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `cwd` | body | `string` | 是 | 工作目录 |
| `additional_roots` | body | `string[]` | 否 | 额外根目录 |
| `env` | body | `{ [key: string]: string }` | 否 | 环境变量 |
| `permission_policy` | body | `{ mode: PermissionMode }` | 否 | 权限策略 |

其中 `PermissionMode`: `'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk'`

**响应参数**: `Workspace` 对象

**使用实例**:

```typescript
// TypeScript
const workspace = await client.workspaces.create({
  cwd: '/path/to/project',
  permission_policy: { mode: 'acceptEdits' },
  env: { NODE_ENV: 'development' },
})
// 预期结果: workspace: { id: "ws-xxx", cwd: "/path/to/project", permission_policy: { mode: "acceptEdits" }, ... }
```

```python
# Python
from codeagent_sdk.api.workspace import workspaces_create
from codeagent_sdk.models import WorkspaceCreateRequest

response = workspaces_create.sync_detailed(
    client=client,
    body=WorkspaceCreateRequest(
        cwd="/path/to/project",
        permission_policy=ConfigInfoPermission(mode="acceptEdits"),
    ),
)
# 预期结果: Workspace(id="ws-xxx", cwd="/path/to/project", ...)
```

---

### 3 workspaces.get

| 项目 | 说明 |
| --- | --- |
| 接口名称 | workspaces.get |
| 请求方法 | `GET` |
| 请求路径 | `/workspaces/{workspaceId}` |
| 功能描述 | 获取指定工作区详情 |
| 使用场景 | 验证工作区存在、获取配置 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `workspaceId` | path | `string` | 是 | 工作区 ID |

**响应参数**: `Workspace` 对象

**使用实例**:

```typescript
// TypeScript
const workspace = await client.workspaces.get({ workspaceId: 'ws-123' })
console.log(workspace.name, workspace.roots)
// 预期结果: workspace: { id: "ws-123", cwd: "...", additional_roots: [], ... }
```

```python
# Python
from codeagent_sdk.api.workspace import workspaces_get

response = workspaces_get.sync_detailed(client=client, workspace_id="ws-123")
# 预期结果: Workspace(id="ws-123", ...)
```

---

### 4 workspaces.agents

| 项目 | 说明 |
| --- | --- |
| 接口名称 | workspaces.agents |
| 请求方法 | `GET` |
| 请求路径 | `/workspaces/{workspaceId}/agents` |
| 功能描述 | 获取工作区可用的 Agent 列表 |
| 使用场景 | Agent 选择器、查看可用 Agent |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `workspaceId` | path | `string` | 是 | 工作区 ID |

**响应参数**: `AgentSummaryPage` (`{ data: AgentSummary[], next_cursor }`)

其中 `AgentSummary`: `{ name, description?, source? }`

**使用实例**:

```typescript
// TypeScript
const agents = await client.workspaces.agents({ workspaceId: 'ws-123' })
agents.data.forEach(a => console.log(a.name, a.mode))
// 预期结果: agents: { data: [{ name: "code", description: "Coding agent" }], next_cursor: null }
```

```python
# Python
from codeagent_sdk.api.workspace import workspaces_agents

response = workspaces_agents.sync_detailed(client=client, workspace_id="ws-123")
# 预期结果: AgentSummaryPage(data=[...], next_cursor=None)
```

---

### 5 workspaces.commands

| 项目 | 说明 |
| --- | --- |
| 接口名称 | workspaces.commands |
| 请求方法 | `GET` |
| 请求路径 | `/workspaces/{workspaceId}/commands` |
| 功能描述 | 获取工作区可用的命令列表 |
| 使用场景 | 命令选择器、帮助面板 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `workspaceId` | path | `string` | 是 | 工作区 ID |

**响应参数**: `CommandSummaryPage` (`{ data: CommandSummary[], next_cursor }`)

其中 `CommandSummary`: `{ name, description?, aliases?, source? }`

**使用实例**:

```typescript
// TypeScript
const commands = await client.workspaces.commands({ workspaceId: 'ws-123' })
commands.data.forEach(c => console.log(c.name, c.description))
// 预期结果: commands: { data: [{ name: "compact", description: "..." }], next_cursor: null }
```

```python
# Python
from codeagent_sdk.api.workspace import workspaces_commands

response = workspaces_commands.sync_detailed(client=client, workspace_id="ws-123")
# 预期结果: CommandSummaryPage(data=[...], next_cursor=None)
```

---

### 6 workspaces.skills

| 项目 | 说明 |
| --- | --- |
| 接口名称 | workspaces.skills |
| 请求方法 | `GET` |
| 请求路径 | `/workspaces/{workspaceId}/skills` |
| 功能描述 | 获取工作区可用的技能列表 |
| 使用场景 | 技能选择器、查看可用技能 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `workspaceId` | path | `string` | 是 | 工作区 ID |

**响应参数**: `SkillSummaryPage` (`{ data: SkillSummary[], next_cursor }`)

其中 `SkillSummary`: `{ name, description?, source? }`

**使用实例**:

```typescript
// TypeScript
const skills = await client.workspaces.skills({ workspaceId: 'ws-123' })
skills.data.forEach(s => console.log(s.name, s.description))
// 预期结果: skills: { data: [{ name: "brainstorm", description: "..." }], next_cursor: null }
```

```python
# Python
from codeagent_sdk.api.workspace import workspaces_skills

response = workspaces_skills.sync_detailed(client=client, workspace_id="ws-123")
# 预期结果: SkillSummaryPage(data=[...], next_cursor=None)
```

---

### 7 workspaces.tools

| 项目 | 说明 |
| --- | --- |
| 接口名称 | workspaces.tools |
| 请求方法 | `GET` |
| 请求路径 | `/workspaces/{workspaceId}/tools` |
| 功能描述 | 获取工作区可用的工具列表 |
| 使用场景 | 工具选择器、查看工具输入 Schema |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `workspaceId` | path | `string` | 是 | 工作区 ID |

**响应参数**: `ToolSummaryPage` (`{ data: ` `ToolSummary[]` `, next_cursor }`)

**使用实例**:

```typescript
// TypeScript
const tools = await client.workspaces.tools({ workspaceId: 'ws-123' })
tools.data.forEach(t => console.log(t.name, t.description))
// 预期结果: tools: { data: [{ name: "bash", search_hint: "shell command", input_schema: {...} }], next_cursor: null }
```

```python
# Python
from codeagent_sdk.api.workspace import workspaces_tools

response = workspaces_tools.sync_detailed(client=client, workspace_id="ws-123")
# 预期结果: ToolSummaryPage(data=[...], next_cursor=None)
```

---

---

---

<a id="ch6"></a>

# Find 查找 (项目级别)

项目级别的代码查找功能（非工作区，基于 `directory` 定位）。

| 接口方法 | 功能描述 | 使用场景 |
| --- | --- | --- |
| find.files | 在项目中查找文件 | 文件导航、按名称查找 |

## 1 find.files

| 项目 | 说明 |
| --- | --- |
| 接口名称 | find.files |
| 请求方法 | `GET` |
| 请求路径 | `/find/file` |
| 功能描述 | 在项目中查找文件 |
| 使用场景 | 文件导航、按名称查找 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |
| `query` | query | `string` | 是 | 搜索查询 |
| `dirs` | query | `string[] \| string` | 否 | 目录过滤 |
| `type` | query | `'file' \| 'directory'` | 否 | 类型过滤 |
| `limit` | query | `number` | 否 | 返回数量限制 |

**响应参数**: `SearchFilePathArray` (`string[]`)

**使用实例**:

```typescript
// TypeScript
const files = await client.find.files({ query: '*.test.ts' })
files.forEach(f => console.log(f))
// 预期结果: files: ["src/app.test.ts", "src/utils.test.ts"]
```

```python
# Python
from codeagent_sdk.api.find import find_files

response = find_files.sync_detailed(client=client, query="*.test.ts")
# 预期结果: ["src/app.test.ts", "src/utils.test.ts"]
```

---

---

---

<a id="ch7"></a>

# Event 事件订阅

| 接口方法 | 功能描述 | 使用场景 |
| --- | --- | --- |
| event.subscribe | 以 SSE 方式流式获取项目实例级事件 | 实时监听消息更新、工具调用、权限请求、问题询问等 |

## 1 event.subscribe

| 项目 | 说明 |
| --- | --- |
| 接口名称 | event.subscribe |
| 请求方法 | `GET` (SSE) |
| 请求路径 | `/event` |
| 功能描述 | 以 SSE 方式流式获取项目实例级事件 |
| 使用场景 | 实时监听消息更新、工具调用、权限请求、问题询问等 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |

**响应参数** (SSE 事件流): `Event` 联合类型 (详见附录B)

**使用实例**:

```typescript
// TypeScript
const stream = await client.event.subscribe({ directory: process.cwd() })
// 预期结果: AsyncIterable<Event> SSE事件流，事件类型如 permission.asked, message.part.delta 等
for await (const event of stream.stream) {
  if (event.type === 'permission.asked') {
    await client.permission.reply({
      requestID: event.properties.id,
      reply: 'once',
    })
  }
}
```

```python
# Python
# 注意：event_subscribe.sync_detailed / asyncio_detailed 内部使用非流式 request，
# 不适用于 SSE 持续推送协议。需直接使用 client 的 httpx streaming 模式：
import json

async def listen_events(client, directory):
    async_httpx_client = client.get_async_httpx_client()
    async with async_httpx_client.stream(
        "GET",
        "/event",
        params={"directory": directory},
    ) as response:
        async for line in response.aiter_lines():
            if not line.startswith("data: "):
                continue
            event = json.loads(line[6:])
            event_type = event.get("type")
            properties = event.get("properties", {})
            # 预期结果: SSE事件流，事件类型如 permission.asked, message.part.delta 等
            if event_type == "permission.asked":
                request_id = properties.get("id")
                # 处理权限请求...
            elif event_type == "message.part.delta":
                delta_text = properties.get("delta", "")
                # 处理流式文本...
```

---

---

---

<a id="ch8"></a>

# Permission 权限管理

| 接口方法 | 功能描述 | 使用场景 |
| --- | --- | --- |
| permission.list | 获取当前待处理的权限请求列表 | 审批面板、权限管理 |
| permission.reply | 回复权限请求（允许/拒绝/始终允许） | 批准或拒绝 Agent 的工具使用请求 |

## 1 permission.list

| 项目 | 说明 |
| --- | --- |
| 接口名称 | permission.list |
| 请求方法 | `GET` |
| 请求路径 | `/permission` |
| 功能描述 | 获取当前待处理的权限请求列表 |
| 使用场景 | 审批面板、权限管理 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |

**响应参数**: `PermissionRequestArray`

其中 `PermissionRequest`: `{ id, sessionID?, messageID?, callID?, title?, metadata?, permission?, patterns?, status: 'pending' }`

**使用实例**:

```typescript
// TypeScript
const perms = await client.permission.list({ directory: process.cwd() })
perms.forEach(p => console.log(p.id, p.title))
// 预期结果: perms: [{ id: "perm-123", sessionID: "sess-123", title: "Execute bash", status: "pending" }]
```

```python
# Python
from codeagent_sdk.api.permission import permission_list

response = permission_list.sync_detailed(client=client, directory=str(Path.cwd()))
# 预期结果: [{ id: "perm-123", sessionID: "sess-123", title: "Execute bash", status: "pending" }]
```

---

### 2 permission.reply

| 项目 | 说明 |
| --- | --- |
| 接口名称 | permission.reply |
| 请求方法 | `POST` |
| 请求路径 | `/permission/{requestID}/reply` |
| 功能描述 | 回复权限请求（允许/拒绝/始终允许） |
| 使用场景 | 批准或拒绝 Agent 的工具使用请求 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `requestID` | path | `string` | 是 | 权限请求 ID |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |
| `reply` | body | `'once' \| 'always' \| 'reject'` | 否 | 回复类型 |
| `message` | body | `string` | 否 | 附加消息 |

**响应参数**: `boolean` (回复是否成功)

**使用实例**:

```typescript
// TypeScript
await client.permission.reply({
  requestID: 'perm-123',
  reply: 'always',
  message: 'Approved by SDK',
})
// 预期结果: true (权限已回复)
```

```python
# Python
from codeagent_sdk.api.permission import permission_reply

permission_reply.sync_detailed(
    client=client,
    request_id="perm-123",
    body=PermissionReplyRequest(reply="always", message="Approved by SDK"),
)
# 预期结果: True (权限已回复)
```

---

---

---

<a id="ch9"></a>

# Question 问题管理

| 接口方法 | 功能描述 | 使用场景 |
| --- | --- | --- |
| question.list | 获取当前待回答的问题列表 | 交互式问题面板 |
| question.reply | 回复 Agent 提出的问题 | 用户选择交互式问题的答案 |
| question.reject | 拒绝回答 Agent 提出的问题 | 用户取消交互式问题 |

## 1 question.list

| 项目 | 说明 |
| --- | --- |
| 接口名称 | question.list |
| 请求方法 | `GET` |
| 请求路径 | `/question` |
| 功能描述 | 获取当前待回答的问题列表 |
| 使用场景 | 交互式问题面板 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |

**响应参数**: `QuestionRequestArray`

其中 `QuestionRequest`: `{ id, sessionID, questions: QuestionInfo[], tool? }`

`QuestionInfo`: `{ question, header, options: QuestionOption[], multiSelect? }`

`QuestionOption`: `{ label, description, preview? }`

**使用实例**:

```typescript
// TypeScript
const questions = await client.question.list({ directory: process.cwd() })
questions.forEach(q => console.log(q.id, q.questions))
// 预期结果: questions: [{ id: "q-123", sessionID: "sess-123", questions: [{ question: "选择方案", header: "方案", options: [...] }] }]
```

```python
# Python
from codeagent_sdk.api.question import question_list

response = question_list.sync_detailed(client=client, directory=str(Path.cwd()))
# 预期结果: [{ id: "q-123", sessionID: "sess-123", questions: [...] }]
```

---

### 2 question.reply

| 项目 | 说明 |
| --- | --- |
| 接口名称 | question.reply |
| 请求方法 | `POST` |
| 请求路径 | `/question/{requestID}/reply` |
| 功能描述 | 回复 Agent 提出的问题 |
| 使用场景 | 用户选择交互式问题的答案 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `requestID` | path | `string` | 是 | 问题请求 ID |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |
| `answers` | body | `string[][]` | 是 | 答案数组 |

**响应参数**: `boolean` (回复是否成功)

**使用实例**:

```typescript
// TypeScript
await client.question.reply({
  requestID: 'q-123',
  answers: [['happy path']],
})
// 预期结果: true (问题已回复)
```

```python
# Python
from codeagent_sdk.api.question import question_reply

question_reply.sync_detailed(
    client=client,
    request_id="q-123",
    body=QuestionReplyRequest(answers=[["happy path"]]),
)
# 预期结果: True (问题已回复)
```

---

### 3 question.reject

| 项目 | 说明 |
| --- | --- |
| 接口名称 | question.reject |
| 请求方法 | `POST` |
| 请求路径 | `/question/{requestID}/reject` |
| 功能描述 | 拒绝回答 Agent 提出的问题 |
| 使用场景 | 用户取消交互式问题 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `requestID` | path | `string` | 是 | 问题请求 ID |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |

**响应参数**: `boolean` (拒绝是否成功)

**使用实例**:

```typescript
// TypeScript
await client.question.reject({ requestID: 'q-123' })
// 预期结果: true (问题已拒绝)
```

```python
# Python
from codeagent_sdk.api.question import question_reject

question_reject.sync_detailed(client=client, request_id="q-123")
# 预期结果: True (问题已拒绝)
```

---

---

---

<a id="ch10"></a>

# Provider 模型提供商

| 接口方法 | 功能描述 | 使用场景 |
| --- | --- | --- |
| provider.list | 获取所有可用的模型提供商 | 提供商选择器、模型切换 |
| provider.auth | 获取各提供商支持的认证方式 | 认证配置、OAuth 流程启动 |

## 1 provider.list

| 项目 | 说明 |
| --- | --- |
| 接口名称 | provider.list |
| 请求方法 | `GET` |
| 请求路径 | `/provider` |
| 功能描述 | 获取所有可用的模型提供商 |
| 使用场景 | 提供商选择器、模型切换 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |

**响应参数** (`ProviderListResult`):

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `all` | `Provider[]` | 所有提供商 |
| `default` | `{ [key: string]: string }` | 默认提供商映射 |
| `connected` | `string[]` | 已连接的提供商 ID |

**使用实例**:

```typescript
// TypeScript
const providers = await client.provider.list()
const connected = providers.connected
// 预期结果: providers: { all: [{ id: "openai", name: "OpenAI", models: {...} }], default: { chat: "openai" }, connected: ["openai"] }
```

```python
# Python
from codeagent_sdk.api.provider import provider_list

response = provider_list.sync_detailed(client=client)
# 预期结果: ProviderListResult(all=[...], default={...}, connected=["openai"])
```

---

### 2 provider.auth

| 项目 | 说明 |
| --- | --- |
| 接口名称 | provider.auth |
| 请求方法 | `GET` |
| 请求路径 | `/provider/auth` |
| 功能描述 | 获取各提供商支持的认证方式 |
| 使用场景 | 认证配置、OAuth 流程启动 |

**请求参数**: 无

**响应参数**: `ProviderAuthMethods` (`{ [providerID: string]: ProviderAuthMethodInfo[] }`)

**使用实例**:

```typescript
// TypeScript
const authMethods = await client.provider.auth()
for (const [id, methods] of Object.entries(authMethods)) {
  console.log(id, methods)
}
// 预期结果: authMethods: { "openai": [{ type: "api_key", label: "API Key" }] }
```

```python
# Python
from codeagent_sdk.api.provider import provider_auth

response = provider_auth.sync_detailed(client=client)
```

---

---

---

<a id="ch11"></a>

# Config 配置管理 (项目级别)

项目级别的配置管理，影响特定工作目录。

| 接口方法 | 功能描述 | 使用场景 |
| --- | --- | --- |
| config.get | 获取项目级配置信息 | 读取当前项目模型、权限、Agent 配置 |
| config.update | 部分更新项目级配置 | 修改项目模型、启用/禁用工具 |
| config.providers | 获取项目级提供商配置摘要 | 查看已配置的提供商和默认模型 |

## 1 config.get

| 项目 | 说明 |
| --- | --- |
| 接口名称 | config.get |
| 请求方法 | `GET` |
| 请求路径 | `/config` |
| 功能描述 | 获取项目级配置信息 |
| 使用场景 | 读取当前项目模型、权限、Agent 配置 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |

**响应参数** (`ConfigInfo`):

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `$schema` | `string?` | JSON Schema 标识 |
| `model` | `string?` | 默认模型 |
| `permission` | `object?` | 权限配置 |
| `provider` | `object?` | 提供商配置 |
| `agent` | `object?` | Agent 配置 |
| `command` | `object?` | 命令配置 |
| `mcp` | `object?` | MCP 配置 |
| `tools` | `object?` | 工具开关配置 |
| `instructions` | `string[]?` | 全局指令 |
| `plugin` | `unknown[]?` | 插件列表 |
| `disabled_providers` | `string[]?` | 禁用的提供商 |
| `enabled_providers` | `string[]?` | 启用的提供商 |
| `server` | `object?` | 服务器配置（含 `port`、`hostname`、`mdns`、`mdnsDomain`、`cors`、`maxActivePrompts`、`maxActivePromptsPerWorkspace`） |
| `env` | `object?` | 环境变量配置 |
| `enterprise` | `object?` | 企业配置 |
| `hooks` | `object?` | 钩子配置 |
| `worktree` | `object?` | 工作树配置 |
| `sandbox` | `object?` | 沙箱配置 |
| `temperature` | `number?` | 模型温度 |
| `topP` | `number?` | 模型 Top-P |
| `frequencyPenalty` | `number?` | 频率惩罚 |
| `presencePenalty` | `number?` | 存在惩罚 |
| `availableModels` | `string[]?` | 可用模型列表 |
| `modelOverrides` | `object?` | 模型覆盖配置 |
| `permissions` | `object?` | 权限规则配置 |
| `mcpServers` | `object?` | MCP 服务器配置 |
| `language` | `string?` | 语言设置 |
| `outputStyle` | `string?` | 输出风格 |
| `sensitiveFilePatterns` | `object?` | 敏感文件模式 |

**使用实例**:

```typescript
// TypeScript
const config = await client.config.get({ directory: process.cwd() })
console.log(config.model, config.permission)
// 预期结果: config: { model: "default-model", permission: {...}, tools: {...}, ... }
```

```python
# Python
from codeagent_sdk.api.config import config_get

response = config_get.sync_detailed(client=client, directory=str(Path.cwd()))
# 预期结果: ConfigInfo(model="default-model", permission={...}, ...)
```

---

### 2 config.update

| 项目 | 说明 |
| --- | --- |
| 接口名称 | config.update |
| 请求方法 | `PATCH` |
| 请求路径 | `/config` |
| 功能描述 | 部分更新项目级配置 |
| 使用场景 | 修改项目模型、启用/禁用工具 |

**请求参数** (`ConfigPatch`):

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |
| `$schema` | body | `string` | 否 | JSON Schema 标识 |
| `model` | body | `string` | 否 | 默认模型 |
| `permission` | body | `object` | 否 | 权限配置 |
| `provider` | body | `object` | 否 | 提供商配置 |
| `agent` | body | `object` | 否 | Agent 配置 |
| `command` | body | `object` | 否 | 命令配置 |
| `mcp` | body | `object` | 否 | MCP 配置 |
| `tools` | body | `object` | 否 | 工具开关 |
| `instructions` | body | `string[]` | 否 | 全局指令 |
| `plugin` | body | `unknown[]` | 否 | 插件列表 |
| `disabled_providers` | body | `string[]` | 否 | 禁用的提供商 |
| `enabled_providers` | body | `string[]` | 否 | 启用的提供商 |
| `server` | body | `object` | 否 | 服务器配置（含 `port`、`hostname`、`mdns`、`mdnsDomain`、`cors`、`maxActivePrompts`、`maxActivePromptsPerWorkspace`） |
| `env` | body | `object` | 否 | 环境变量配置 |
| `enterprise` | body | `object` | 否 | 企业配置 |
| `hooks` | body | `object` | 否 | 钩子配置 |
| `worktree` | body | `object` | 否 | 工作树配置 |
| `sandbox` | body | `object` | 否 | 沙箱配置 |
| `temperature` | body | `number` | 否 | 模型温度 |
| `topP` | body | `number` | 否 | 模型 Top-P |
| `frequencyPenalty` | body | `number` | 否 | 频率惩罚 |
| `presencePenalty` | body | `number` | 否 | 存在惩罚 |
| `availableModels` | body | `string[]` | 否 | 可用模型列表 |
| `modelOverrides` | body | `object` | 否 | 模型覆盖配置 |
| `permissions` | body | `object` | 否 | 权限规则配置 |
| `mcpServers` | body | `object` | 否 | MCP 服务器配置 |
| `language` | body | `string` | 否 | 语言设置 |
| `outputStyle` | body | `string` | 否 | 输出风格 |
| `sensitiveFilePatterns` | body | `object` | 否 | 敏感文件模式 |

**使用实例**:

```typescript
// TypeScript
await client.config.update({
  directory: process.cwd(),
  model: 'default-model',
  tools: { bash: false },
})
// 预期结果: ConfigInfo (返回更新后的完整配置)
```

```python
# Python
from codeagent_sdk.api.config import config_update
from codeagent_sdk.models import ConfigPatch

config_update.sync_detailed(
    client=client,
    directory=str(Path.cwd()),
    body=ConfigPatch(model="default-model"),
)
# 预期结果: ConfigInfo (返回更新后的完整配置)
```

---

### 3 config.providers

| 项目 | 说明 |
| --- | --- |
| 接口名称 | config.providers |
| 请求方法 | `GET` |
| 请求路径 | `/config/providers` |
| 功能描述 | 获取项目级提供商配置摘要 |
| 使用场景 | 查看已配置的提供商和默认模型 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |

**响应参数** (`ProviderConfigProvidersResult`):

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `providers` | `ProviderInfo[]` | 提供商信息列表（每个 model 含 `max_context_tokens` 字段） |
| `default` | `{ [key: string]: string }` | 默认提供商映射 |

**使用实例**:

```typescript
// TypeScript
const result = await client.config.providers({ directory: process.cwd() })
result.providers.forEach(p => console.log(p.id, p.models))
console.log('Defaults:', result.default)
// 预期结果: result: { providers: [{ id: "openai", name: "OpenAI", models: { "gpt-4": { max_context_tokens: 128000 } } }], default: { chat: "openai" } }
```

```python
# Python
from codeagent_sdk.api.config import config_providers

response = config_providers.sync_detailed(client=client, directory=str(Path.cwd()))
# 预期结果: ProviderConfigProvidersResult(providers=[...], default={...})
```

---

---

---

<a id="ch12"></a>

# MCP 服务器管理

MCP (Model Context Protocol) 服务器管理接口，用于扩展 Agent 工具能力。

| 接口方法 | 功能描述 | 使用场景 |
| --- | --- | --- |
| mcp.status | 获取所有 MCP 服务器连接状态 | MCP 服务器监控、调试连接问题 |
| mcp.add | 从 AI Market 添加 MCP 服务器 | 动态添加工具服务器、扩展 Agent 能力 |
| mcp.remove | 移除 MCP 服务器配置 | 删除 MCP 服务器、清理配置 |
| mcp.connect | 连接指定的 MCP 服务器 | 启动 MCP 服务、建立工具连接 |
| mcp.disconnect | 断开指定 MCP 服务器连接 | 停止 MCP 服务、调试连接 |

## 1 mcp.status

| 项目 | 说明 |
| --- | --- |
| 接口名称 | mcp.status |
| 请求方法 | `GET` |
| 请求路径 | `/mcp` |
| 功能描述 | 获取所有 MCP 服务器连接状态 |
| 使用场景 | MCP 服务器监控、调试连接问题 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |

**响应参数**: `McpStatusMap` (`{ [name: string]: McpStatus }`)

其中 `McpStatus` 联合类型（每种状态均含 `scope` 字段，标识配置来源）:
- `{ status: 'connected', scope }` — 已连接
- `{ status: 'disabled', scope }` — 已禁用
- `{ status: 'failed', error, scope }` — 连接失败
- `{ status: 'needs_auth', scope }` — 需要认证
- `{ status: 'needs_client_registration', error, scope }` — 需要客户端注册

`scope` 枚举值: `'local'` | `'project'` | `'additional'` | `'user'` | `'dynamic'` | `'enterprise'` | `'managed'`

**使用实例**:

```typescript
// TypeScript
const statusMap = await client.mcp.status()
for (const [name, status] of Object.entries(statusMap)) {
  console.log(name, status.status)
}
// 预期结果: statusMap: { "my-tools": { status: "connected" }, "github": { status: "needs_auth" } }
```

```python
# Python
from codeagent_sdk.api.mcp import mcp_status

response = mcp_status.sync_detailed(client=client)
# 预期结果: { "my-tools": McpConnectedStatus(status="connected"), ... }
```

---

### 2 mcp.add

| 项目 | 说明 |
| --- | --- |
| 接口名称 | mcp.add |
| 请求方法 | `POST` |
| 请求路径 | `/mcp` |
| 功能描述 | 从 AI Market 添加 MCP 服务器 |
| 使用场景 | 动态添加工具服务器、扩展 Agent 能力 |

**请求参数** (`McpAddRequest`):

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |
| `source` | body | `'market' \| 'config'` | 是 | 添加来源 |
| `mcpId` | body | `string` | 否 | MCP 服务 ID，支持 `id@version` 格式（source 为 market 时必填） |
| `version` | body | `string` | 否 | MCP 版本，优先于 mcpId 中的 @version |
| `scope` | body | `'local' \| 'project' \| 'user'` | 否 | 配置写入范围，默认 `local` |
| `name` | body | `string` | 否 | 自定义 MCP 服务器名称，默认使用 mcpId |
| `isOverWrite` | body | `boolean` | 否 | 是否覆盖同名配置，默认 `true` |
| `config` | body | `object` | 否 | MCP 服务器配置（source 为 config 时必填，含 `type`、`command`/`url` 等） |

**source 变体说明**:
- `source: 'market'` — 从 AI Market 安装，需提供 `mcpId`
- `source: 'config'` — 通过配置直接添加，需提供 `name` 和 `config`

**响应参数** (`McpAddResponse`):

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `success` | `boolean` | 是否添加成功 |
| `mcpId` | `string` | MCP 服务 ID |
| `version` | `string?` | 版本号 |
| `name` | `string` | 服务器名称 |
| `config` | `Record<string, unknown>` | 服务器配置 |
| `isExist` | `boolean` | 是否已存在同名配置 |
| `writeLocation` | `string?` | 配置写入路径 |

**使用实例**:

```typescript
// TypeScript
const result = await client.mcp.add({
  mcpId: 'my-mcp-server@1.0.0',
  scope: 'project',
})
console.log(result.success, result.name)
// 预期结果: result: { success: true, mcpId: "my-mcp-server", version: "1.0.0", name: "my-mcp-server", config: {...}, isExist: false }
```

```python
# Python
from codeagent_sdk.api.mcp import mcp_add

response = mcp_add.sync_detailed(
    client=client,
    body=McpAddFromMarketRequest(mcp_id="my-mcp-server@1.0.0", scope="project"),
)
# 预期结果: McpAddFromMarketResponse(success=True, mcp_id="my-mcp-server", ...)
```

---

### 3 mcp.remove

| 项目 | 说明 |
| --- | --- |
| 接口名称 | mcp.remove |
| 请求方法 | `DELETE` |
| 请求路径 | `/mcp/{name}` |
| 功能描述 | 移除 MCP 服务器配置 |
| 使用场景 | 删除 MCP 服务器、清理配置 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | path | `string` | 是 | MCP 服务器名称 |
| `scope` | query | `'local' \| 'project' \| 'user'` | 否 | 配置范围 |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |

**响应参数**: `{ deleted: true }`

**使用实例**:

```typescript
// TypeScript
await client.mcp.remove({ name: 'my-tools' })
// 预期结果: { deleted: true } (MCP服务器已移除)
```

```python
# Python
from codeagent_sdk.api.mcp import mcp_remove

mcp_remove.sync_detailed(client=client, name="my-tools")
# 预期结果: { deleted: True } (MCP服务器已移除)
```

---

### 4 mcp.connect

| 项目 | 说明 |
| --- | --- |
| 接口名称 | mcp.connect |
| 请求方法 | `POST` |
| 请求路径 | `/mcp/{name}/connect` |
| 功能描述 | 连接指定的 MCP 服务器 |
| 使用场景 | 启动 MCP 服务、建立工具连接 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | path | `string` | 是 | MCP 服务器名称 |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |

**响应参数**: `boolean` (连接是否成功)

**使用实例**:

```typescript
// TypeScript
await client.mcp.connect({ name: 'my-tools' })
// 预期结果: true (MCP服务器已连接)
```

```python
# Python
from codeagent_sdk.api.mcp import mcp_connect

mcp_connect.sync_detailed(client=client, name="my-tools")
# 预期结果: True (MCP服务器已连接)
```

---

### 5 mcp.disconnect

| 项目 | 说明 |
| --- | --- |
| 接口名称 | mcp.disconnect |
| 请求方法 | `POST` |
| 请求路径 | `/mcp/{name}/disconnect` |
| 功能描述 | 断开指定 MCP 服务器连接 |
| 使用场景 | 停止 MCP 服务、调试连接 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | path | `string` | 是 | MCP 服务器名称 |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |

**响应参数**: `boolean` (断开是否成功)

**使用实例**:

```typescript
// TypeScript
await client.mcp.disconnect({ name: 'my-tools' })
// 预期结果: true (MCP服务器已断开)
```

```python
# Python
from codeagent_sdk.api.mcp import mcp_disconnect

mcp_disconnect.sync_detailed(client=client, name="my-tools")
# 预期结果: True (MCP服务器已断开)
```

---

---

---

<a id="ch13"></a>

# Skill 技能管理

| 接口方法 | 功能描述 | 使用场景 |
| --- | --- | --- |
| skill.list | 获取项目可用的技能列表 | 技能选择器、查看可用技能 |

## 1 skill.list

| 项目 | 说明 |
| --- | --- |
| 接口名称 | skill.list |
| 请求方法 | `GET` |
| 请求路径 | `/skill` |
| 功能描述 | 获取项目可用的技能列表 |
| 使用场景 | 技能选择器、查看可用技能 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |

**响应参数**: `SkillInfoArray`

其中 `SkillInfo`: `{ name, description?, location, content, userInvocable?, source? }`

**使用实例**:

```typescript
// TypeScript
const skills = await client.skill.list({ directory: process.cwd() })
skills.forEach(s => console.log(s.name, s.description))
// 预期结果: skills: [{ name: "brainstorm", description: "Brainstorm ideas", location: ".codeagent/skills/brainstorm.md", content: "..." }]
```

```python
# Python
from codeagent_sdk.api.skill import skill_list

response = skill_list.sync_detailed(client=client, directory=str(Path.cwd()))
# 预期结果: [{ name: "brainstorm", description: "Brainstorm ideas", location: ".codeagent/skills/brainstorm.md", content: "..." }]
```

---

---

---

<a id="ch14"></a>

# Skills 技能安装管理

技能的安装、卸载、启用和禁用管理接口。与第 18 节的 `skill.list`（查询可用技能）不同，本节侧重技能的生命周期管理。

| 接口方法 | 功能描述 | 使用场景 |
| --- | --- | --- |
| skills.add | 从 AI Market 安装技能 | 动态添加新技能 |
| skills.remove | 卸载技能 | 移除不需要的技能 |
| skills.exists | 检查技能是否已安装 | 安装前检查、条件逻辑 |
| skills.enable | 启用技能 | 恢复已禁用的技能 |
| skills.disable | 禁用技能 | 临时停用、调试 |

## 1 skills.add

| 项目 | 说明 |
| --- | --- |
| 接口名称 | skills.add |
| 请求方法 | `POST` |
| 请求路径 | `/skills/add` |
| 功能描述 | 从 AI Market 安装技能（需 root 权限） |
| 使用场景 | 动态添加新技能 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | body | `string` | 是 | 技能 ID |
| `version` | body | `string` | 否 | 技能版本 |
| `scope` | body | `'user' \| 'project'` | 否 | 安装范围 |
| `isOverWrite` | body | `boolean` | 否 | 是否覆盖已有技能 |

**响应参数** (`SkillAddResponse`): `{ success: boolean, message?, version? }`

**使用实例**:

```typescript
// TypeScript
const result = await client.skills.add({ id: 'my-skill', scope: 'project' })
console.log(result.success)
// 预期结果: { success: true, version: "1.0.0" }
```

```python
# Python
from codeagent_sdk.api.skills import skills_add

response = skills_add.sync_detailed(
    client=client,
    body=SkillsAddRequest(id="my-skill", scope="project"),
)
# 预期结果: SkillAddResponse(success=True, version="1.0.0")
```

---

### 2 skills.remove

| 项目 | 说明 |
| --- | --- |
| 接口名称 | skills.remove |
| 请求方法 | `DELETE` |
| 请求路径 | `/skills` |
| 功能描述 | 卸载技能（需 root 权限） |
| 使用场景 | 移除不需要的技能 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | body | `string` | 是 | 技能 ID |
| `scope` | body | `'user' \| 'project'` | 否 | 卸载范围 |

**响应参数** (`SkillRemoveResponse`): `{ success: boolean, message: string }`

**使用实例**:

```typescript
// TypeScript
const result = await client.skills.remove({ id: 'my-skill' })
console.log(result.success)
// 预期结果: { success: true, message: "Skill removed" }
```

```python
# Python
from codeagent_sdk.api.skills import skills_remove

response = skills_remove.sync_detailed(
    client=client,
    body=SkillsRemoveRequest(id="my-skill"),
)
# 预期结果: SkillRemoveResponse(success=True, message="Skill removed")
```

---

### 3 skills.exists

| 项目 | 说明 |
| --- | --- |
| 接口名称 | skills.exists |
| 请求方法 | `GET` |
| 请求路径 | `/skills/exists` |
| 功能描述 | 检查技能是否已安装（需 root 权限） |
| 使用场景 | 安装前检查、条件逻辑 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | query | `string` | 是 | 技能 ID |
| `isProject` | query | `boolean` | 否 | 是否检查项目级别 |

**响应参数** (`SkillExistsResponse`): `{ success: boolean, message?, data: { isExist: boolean } }`

**使用实例**:

```typescript
// TypeScript
const result = await client.skills.exists({ id: 'my-skill' })
console.log(result.data.isExist)
// 预期结果: { success: true, data: { isExist: true } }
```

```python
# Python
from codeagent_sdk.api.skills import skills_exists

response = skills_exists.sync_detailed(client=client, id="my-skill")
# 预期结果: SkillExistsResponse(success=True, data=SkillExistsData(is_exist=True))
```

---

### 4 skills.enable

| 项目 | 说明 |
| --- | --- |
| 接口名称 | skills.enable |
| 请求方法 | `POST` |
| 请求路径 | `/skills/enable` |
| 功能描述 | 启用技能（需 root 权限） |
| 使用场景 | 恢复已禁用的技能 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | body | `string` | 是 | 技能 ID |

**响应参数** (`SkillEnableResponse`): `{ success: boolean, message: string }`

**使用实例**:

```typescript
// TypeScript
const result = await client.skills.enable({ id: 'my-skill' })
console.log(result.success)
// 预期结果: { success: true, message: "Skill enabled" }
```

```python
# Python
from codeagent_sdk.api.skills import skills_enable

response = skills_enable.sync_detailed(
    client=client,
    body=SkillsEnableRequest(id="my-skill"),
)
# 预期结果: SkillEnableResponse(success=True, message="Skill enabled")
```

---

### 5 skills.disable

| 项目 | 说明 |
| --- | --- |
| 接口名称 | skills.disable |
| 请求方法 | `POST` |
| 请求路径 | `/skills/disable` |
| 功能描述 | 禁用技能（需 root 权限） |
| 使用场景 | 临时停用、调试 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | body | `string` | 是 | 技能 ID |

**响应参数** (`SkillDisableResponse`): `{ success: boolean, message: string }`

**使用实例**:

```typescript
// TypeScript
const result = await client.skills.disable({ id: 'my-skill' })
console.log(result.success)
// 预期结果: { success: true, message: "Skill disabled" }
```

```python
# Python
from codeagent_sdk.api.skills import skills_disable

response = skills_disable.sync_detailed(
    client=client,
    body=SkillsDisableRequest(id="my-skill"),
)
# 预期结果: SkillDisableResponse(success=True, message="Skill disabled")
```

---

---

---

<a id="ch15"></a>

# Instance 实例管理

| 接口方法 | 功能描述 | 使用场景 |
| --- | --- | --- |
| instance.dispose | 销毁当前项目实例 | 项目实例清理、资源释放 |

## 1 instance.dispose

| 项目 | 说明 |
| --- | --- |
| 接口名称 | instance.dispose |
| 请求方法 | `POST` |
| 请求路径 | `/instance/dispose` |
| 功能描述 | 销毁当前项目实例 |
| 使用场景 | 项目实例清理、资源释放 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |

**响应参数**: `boolean` (销毁是否成功)

**使用实例**:

```typescript
// TypeScript
await client.instance.dispose({ directory: process.cwd() })
// 预期结果: true (实例已销毁)
```

```python
# Python
from codeagent_sdk.api.instance import instance_dispose

instance_dispose.sync_detailed(client=client, directory=str(Path.cwd()))
# 预期结果: True (实例已销毁)
```

---

---

---

<a id="ch16"></a>

# App 应用管理

| 接口方法 | 功能描述 | 使用场景 |
| --- | --- | --- |
| app.log | 写入应用日志条目 | SDK 客户端日志上报、审计追踪 |
| app.agents | 获取项目可用的 Agent 列表 | Agent 选择器、查看可用 Agent 配置 |

## 1 app.log

| 项目 | 说明 |
| --- | --- |
| 接口名称 | app.log |
| 请求方法 | `POST` |
| 请求路径 | `/log` |
| 功能描述 | 写入应用日志条目 |
| 使用场景 | SDK 客户端日志上报、审计追踪 |

**请求参数** (`AppLogRequest`):

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |
| `service` | body | `string` | 是 | 服务名称 |
| `level` | body | `'debug' \| 'info' \| 'error' \| 'warn'` | 是 | 日志级别 |
| `message` | body | `string` | 是 | 日志消息 |
| `extra` | body | `object` | 否 | 额外数据 |

**响应参数**: `boolean` (日志写入是否成功)

**使用实例**:

```typescript
// TypeScript
await client.app.log({
  service: 'my-app',
  level: 'info',
  message: 'Task completed successfully',
  extra: { taskId: '123' },
})
// 预期结果: true (日志写入成功)
```

```python
# Python
from codeagent_sdk.api.app import app_log
from codeagent_sdk.models import AppLogRequest

app_log.sync_detailed(
    client=client,
    body=AppLogRequest(
        service="my-app",
        level="info",
        message="Task completed successfully",
    ),
)
# 预期结果: True (日志写入成功)
```

---

### 2 app.agents

| 项目 | 说明 |
| --- | --- |
| 接口名称 | app.agents |
| 请求方法 | `GET` |
| 请求路径 | `/agent` |
| 功能描述 | 获取项目可用的 Agent 列表 |
| 使用场景 | Agent 选择器、查看可用 Agent 配置 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |

**响应参数**: `AgentInfo`数组

其中 `AgentInfo`: `{ name, description?, mode, native?, hidden?, topP?, temperature?, color?, permission?, model?, variant?, prompt?, options, steps? }`

**使用实例**:

```typescript
// TypeScript
const agents = await client.app.agents({ directory: process.cwd() })
agents.forEach(a => console.log(a.name, a.mode))
// 预期结果: agents: [{ name: "code", description: "Coding agent", mode: "primary", ... }]
```

```python
# Python
from codeagent_sdk.api.app import app_agents

response = app_agents.sync_detailed(client=client, directory=str(Path.cwd()))
# 预期结果: [{ name: "code", description: "Coding agent", mode: "primary", ... }]
```

---

---

---

<a id="ch17"></a>

# Command 命令管理

| 接口方法 | 功能描述 | 使用场景 |
| --- | --- | --- |
| command.list | 获取项目可用的命令列表 | 命令帮助面板、自动补全 |

## 1 command.list

| 项目 | 说明 |
| --- | --- |
| 接口名称 | command.list |
| 请求方法 | `GET` |
| 请求路径 | `/command` |
| 功能描述 | 获取项目可用的命令列表 |
| 使用场景 | 命令帮助面板、自动补全 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |

**响应参数**: `CommandInfoArray`

其中 `CommandInfo`: `{ name, description?, agent?, model?, source?, template?, scope?, subtask?, hints }`

**使用实例**:

```typescript
// TypeScript
const commands = await client.command.list({ directory: process.cwd() })
commands.forEach(c => console.log(c.name, c.description))
// 预期结果: commands: [{ name: "compact", description: "Compact conversation", template: "/compact", hints: [] }]
```

```python
# Python
from codeagent_sdk.api.command import command_list

response = command_list.sync_detailed(client=client, directory=str(Path.cwd()))
# 预期结果: [{ name: "compact", description: "Compact conversation", template: "/compact", hints: [] }]
```

---

---

---

<a id="ch18"></a>

# Launcher 服务器启动与管理

SDK 提供的服务器生命周期管理工具，支持自动启动、发现已运行实例、连接和关闭 CodeAgent 服务器。

| 接口方法 | 功能描述 | 使用场景 |
| --- | --- | --- |
| createCodeAgent | 自动启动服务器并获取完整应用实例 | SDK 集成开发、自动化测试 |
| createCodeAgentServer | 启动服务器并获取 Server 对象 | 需要独立管理服务器生命周期 |
| CodeAgentLauncher.start | 启动新的 CodeAgent 服务器进程 | 自定义启动流程 |
| CodeAgentLauncher.connectOrStart | 连接已有实例或启动新实例 | 复用已运行的服务器 |
| CodeAgentLauncher.discover | 发现已运行的服务器实例 | 连接已启动的服务器 |

## 1 createCodeAgent

| 项目 | 说明 |
| --- | --- |
| 接口名称 | createCodeAgent |
| 功能描述 | 自动启动 CodeAgent 服务器并返回包含客户端和服务器的应用实例 |
| 使用场景 | SDK 集成开发、自动化测试 |

**请求参数** (`CodeAgentServerOptions`):

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `cwd` | `string` | 是 | 工作目录 |
| `directory` | `string` | 否 | 客户端默认目录（默认使用 cwd） |
| `binaryPath` | `string` | 否 | 自定义二进制路径 |
| `binaryArgs` | `string[]` | 否 | 传递给二进制的额外参数 |
| `env` | `Record<string, string \| undefined>` | 否 | 环境变量 |
| `configDir` | `string` | 是 | 配置目录 |
| `host` | `string` | 否 | 服务器主机（默认 `127.0.0.1`） |
| `port` | `number` | 否 | 服务器端口（默认 `0` 随机分配） |
| `timeoutMs` | `number` | 否 | 启动超时时间（默认 `10000` ms） |

**响应参数** (`CodeAgentApp`):

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `client` | `CodeAgentApi` | 生成的 SDK 客户端实例 |
| `server` | `CodeAgentServer` | 服务器管理对象 |

**使用实例**:

```typescript
// TypeScript
import { createCodeAgent } from '@codeagent/sdk'

const { client, server } = await createCodeAgent({
  cwd: process.cwd(),
  configDir: '/path/to/config',
})

try {
  const health = await client.global.health()
  console.log(health)
  // 预期结果: { healthy: true, version: "1.0.0" }
} finally {
  await server.close()
}
```

---

### 2 createCodeAgentServer

| 项目 | 说明 |
| --- | --- |
| 接口名称 | createCodeAgentServer |
| 功能描述 | 启动 CodeAgent 服务器并返回 Server 对象，提供更细粒度的生命周期控制 |
| 使用场景 | 需要独立管理服务器生命周期、多客户端共享服务器 |

**请求参数**: 同 `createCodeAgent` 的 `CodeAgentServerOptions`

**响应参数** (`CodeAgentServer`):

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `url` | `string` | 服务器 URL |
| `baseUrl` | `string` | API 基础 URL |
| `token` | `string` | 认证令牌 |
| `configDir` | `string` | 配置目录 |
| `client()` | `() => CodeAgentApi` | 获取原始响应客户端 |
| `dataClient()` | `() => CodeAgentDataApi` | 获取 data-first 客户端 |
| `close()` | `() => Promise<void>` | 关闭服务器 |

**使用实例**:

```typescript
// TypeScript
import { createCodeAgentServer } from '@codeagent/sdk'

const server = await createCodeAgentServer({
  cwd: process.cwd(),
  configDir: '/path/to/config',
})

const client = server.dataClient()
const health = await client.global.health()
// 预期结果: health: { healthy: true, version: "1.0.0" }

await server.close()
```

---

### 3 CodeAgentLauncher.start

| 项目 | 说明 |
| --- | --- |
| 接口名称 | CodeAgentLauncher.start |
| 功能描述 | 启动新的 CodeAgent 服务器进程 |
| 使用场景 | 自定义启动流程、需要直接控制进程 |

**请求参数** (`CodeAgentLauncherOptions`):

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `cwd` | `string` | 是 | 工作目录 |
| `binaryPath` | `string` | 否 | 自定义二进制路径 |
| `binaryArgs` | `string[]` | 否 | 传递给二进制的额外参数 |
| `env` | `Record<string, string \| undefined>` | 否 | 环境变量 |
| `configDir` | `string` | 是 | 配置目录 |
| `host` | `string` | 否 | 服务器主机（默认 `127.0.0.1`） |
| `port` | `number` | 否 | 服务器端口（默认 `0`） |
| `timeoutMs` | `number` | 否 | 启动超时时间（默认 `10000` ms） |

**响应参数**: `CodeAgentLauncher` 实例

**使用实例**:

```typescript
// TypeScript
import { CodeAgentLauncher } from '@codeagent/sdk'

const launcher = await CodeAgentLauncher.start({
  cwd: process.cwd(),
  configDir: '/path/to/config',
  port: 43123,
})
// 预期结果: launcher: CodeAgentLauncher 实例 (baseUrl: "http://127.0.0.1:43123", token: "...")

const client = launcher.client()
await launcher.stop()
```

---

### 4 CodeAgentLauncher.connectOrStart

| 项目 | 说明 |
| --- | --- |
| 接口名称 | CodeAgentLauncher.connectOrStart |
| 功能描述 | 优先连接已运行的服务器实例，如无则启动新实例 |
| 使用场景 | 复用已运行的服务器、避免重复启动 |

**请求参数**: 同 `CodeAgentLauncherOptions`

**响应参数**: `CodeAgentLauncher` 实例

**使用实例**:

```typescript
// TypeScript
import { CodeAgentLauncher } from '@codeagent/sdk'

const launcher = await CodeAgentLauncher.connectOrStart({
  cwd: process.cwd(),
  configDir: '/path/to/config',
})
// 预期结果: launcher: CodeAgentLauncher 实例 (连接已有或新启动的服务器)

const client = launcher.client()
await launcher.stop()
```

---

### 5 CodeAgentLauncher.discover

| 项目 | 说明 |
| --- | --- |
| 接口名称 | CodeAgentLauncher.discover |
| 功能描述 | 发现已运行的服务器实例（从 manifest 文件读取） |
| 使用场景 | 连接已启动的服务器、跨进程共享实例 |

**请求参数**:

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `configDir` | `string` | 是 | 配置目录路径 |

**响应参数** (`CodeAgentLauncherDiscovery | null`):

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `baseUrl` | `string` | 服务器基础 URL |
| `token` | `string` | 认证令牌 |
| `pid` | `number?` | 服务器进程 ID |
| `configDir` | `string` | 配置目录 |
| `version` | `string?` | 服务器版本 |

**使用实例**:

```typescript
// TypeScript
import { CodeAgentLauncher } from '@codeagent/sdk'

const discovery = await CodeAgentLauncher.discover({
  configDir: '/path/to/config',
})
// 预期结果: discovery: { baseUrl: "http://127.0.0.1:43123", token: "xxx", pid: 12345, configDir: "/path/to/config", version: "1.0.0" } | null

if (discovery) {
  console.log('Found server:', discovery.baseUrl, discovery.version)
} else {
  console.log('No running server found')
}
```

---

---

---

<a id="ch19"></a>

# Server 服务器管理

服务器扩展重载接口，用于热加载技能、命令、MCP 等扩展配置。

| 接口方法 | 功能描述 | 使用场景 |
| --- | --- | --- |
| server.reload | 重载扩展配置 | 安装新扩展后热加载、调试扩展 |

## 1 server.reload

| 项目 | 说明 |
| --- | --- |
| 接口名称 | server.reload |
| 请求方法 | `POST` |
| 请求路径 | `/server/reload` |
| 功能描述 | 重载扩展配置 |
| 使用场景 | 安装新扩展后热加载、调试扩展 |

**请求参数**:

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `directory` | query | `string` | 否 | 工作目录 |
| `workspace` | query | `string` | 否 | 工作区名称 |
| `scope` | body | `'user' \| 'project' \| 'all'` | 否 | 重载范围，默认 `all` |
| `types` | body | `('skills' \| 'commands' \| 'agents' \| 'extensions' \| 'mcp' \| 'plugins')[]` | 否 | 重载类型过滤 |

**响应参数** (`ReloadResult`): `{ results: Record<string, { success: number, failed: number, errors: string[] }> }`

- HTTP 200: 全部成功
- HTTP 207: 部分失败
- HTTP 500: 全部失败
- HTTP 409: 已有重载进行中

**使用实例**:

```typescript
// TypeScript
const result = await client.server.reload({
  scope: 'project',
  types: ['skills', 'commands'],
})
console.log(result.results)
// 预期结果: { results: { skills: { success: 2, failed: 0, errors: [] }, commands: { success: 1, failed: 0, errors: [] } } }
```

```python
# Python
from codeagent_sdk.api.server import server_reload

response = server_reload.sync_detailed(
    client=client,
    body=ServerReloadRequest(scope="project", types=["skills", "commands"]),
)
# 预期结果: ReloadResult(results={...})
```

---

---

---

<a id="ch20"></a>

# 附录 A: 公共类型

## Session 类型

```typescript
type Session = {
  id: string
  slug: string
  projectID: string
  workspaceID?: string
  directory: string
  path?: string
  parentID?: string
  summary?: {
    additions: number
    deletions: number
    files: number
    diffs?: Array<{ path?, file?, patch?, additions?, deletions?, status? }>
  }
  cost?: number
  tokens?: { input?, output?, reasoning?, cache?: { read?, write? } }
  share?: object
  title: string
  agent?: string
  model?: { providerID: string, id: string, variant?: string }
  version: string
  metadata?: object
  time: { created: number, updated?, compacting?, archived? }
  permission?: PermissionRuleset
  revert?: { messageID: string, partID?, snapshot?, diff? }
}
```

### Message 类型

```typescript
type Message = {
  id: string
  sessionID: string
  role: 'user' | 'assistant'
  time: { created: number, completed?: number }
  parentID?: string
  modelID?: string
  providerID?: string
  [key: string]: unknown
}

type MessageWithParts = {
  info: Message
  parts: Array<Part>
}
```

### Part 类型 (消息部件联合类型)

```
Part = TextPart | SubtaskPart | ReasoningPart | FilePart | ToolPart
     | StepStartPart | StepFinishPart | SnapshotPart | PatchPart
     | AgentPart | RetryPart | CompactionPart
```

### PermissionRule 类型

```typescript
type PermissionRule = {
  permission: string
  pattern: string
  action: 'allow' | 'deny' | 'ask'
}
```

### Workspace 类型

```typescript
type Workspace = {
  id: string
  cwd: string
  additional_roots: string[]
  env: { [key: string]: string }
  permission_policy: { mode: PermissionMode }
  created_at: string
  updated_at: string
}
```

### SessionStatus 详细类型

```typescript
type SessionStatus =
  | { type: 'idle' }
  | { type: 'busy' }
  | {
      type: 'retry'
      attempt: number
      message: string
      next: number
    }
```

### SessionCommandResponse 类型

```typescript
type SessionCommandResponse = {
  info: {
    id: string
    sessionID: string
    role: 'assistant'
    time: { created: number; completed?: number }
    error?: unknown
    parentID?: string
    modelID?: string
    providerID?: string
    mode?: string
    agent?: string
    path?: { [key: string]: unknown }
    summary?: string
    cost?: number
    tokens?: { [key: string]: unknown }
    structured?: unknown
    variant?: string
    finish?: string
    [key: string]: unknown
  }
  parts: Array<{
    id: string
    sessionID?: string
    messageID?: string
    type: string
    [key: string]: unknown
  }>
}
```

### Part 详细类型

```typescript
type TextPart = {
  id: string; sessionID: string; messageID: string
  type: 'text'; text: string
  synthetic?: boolean; ignored?: boolean
  time?: { start: number; end?: number }
  metadata?: { [key: string]: unknown }
}

type SubtaskPart = {
  id: string; sessionID: string; messageID: string
  type: 'subtask'; prompt: string; description: string; agent: string
  model?: { providerID: string; modelID: string }
  command?: string
}

type ReasoningPart = {
  id: string; sessionID: string; messageID: string
  type: 'reasoning'; text: string
  metadata?: { [key: string]: unknown }
  time: { start: number; end?: number }
}

type FilePart = {
  id: string; sessionID: string; messageID: string
  type: 'file'; mime: string; filename?: string; url: string
  source?: FilePartSource
}

type ToolPart = {
  id: string; sessionID: string; messageID: string
  type: 'tool'; callID: string; tool: string; state: ToolState
  metadata?: { [key: string]: unknown }
}

type StepStartPart = {
  id: string; sessionID: string; messageID: string
  type: 'step-start'; snapshot?: string
}

type StepFinishPart = {
  id: string; sessionID: string; messageID: string
  type: 'step-finish'; reason: string; snapshot?: string
  cost: number; tokens: { total?: number; input: number; output: number; reasoning: number; cache: { read: number; write: number } }
}

type SnapshotPart = {
  id: string; sessionID: string; messageID: string
  type: 'snapshot'; snapshot: string
}

type PatchPart = {
  id: string; sessionID: string; messageID: string
  type: 'patch'; hash: string; files: Array<string>
}

type AgentPart = {
  id: string; sessionID: string; messageID: string
  type: 'agent'; name: string
  source?: { value: string; start: number; end: number }
}

type RetryPart = {
  id: string; sessionID: string; messageID: string
  type: 'retry'; attempt: number; error: ApiError
  time: { created: number }
}

type CompactionPart = {
  id: string; sessionID: string; messageID: string
  type: 'compaction'; auto: boolean; overflow?: boolean; tail_start_id?: string
}
```

### ToolState 类型

```typescript
type ToolState =
  | { status: 'pending'; input: { [key: string]: unknown }; raw: string }
  | { status: 'running'; input: { [key: string]: unknown }; title?: string; metadata?: { [key: string]: unknown }; time: { start: number } }
  | { status: 'completed'; input: { [key: string]: unknown }; output: string; title: string; metadata: { [key: string]: unknown }; time: { start: number; end: number; compacted?: number }; attachments?: Array<FilePart> }
  | { status: 'error'; input: { [key: string]: unknown }; error: string; metadata?: { [key: string]: unknown }; time: { start: number; end: number } }
```

### Provider 类型

```typescript
type Provider = {
  id: string
  name: string
  source?: 'env' | 'config' | 'custom' | 'api'
  env: Array<string>
  key?: string
  options: { [key: string]: unknown }
  models: { [key: string]: unknown }
}
```

### AgentInfo 类型

```typescript
type AgentInfo = {
  name: string
  description?: string
  mode: 'subagent' | 'primary' | 'all'
  native?: boolean
  hidden?: boolean
  topP?: number
  temperature?: number
  color?: string
  permission?: PermissionRuleset
  model?: { modelID: string; providerID: string }
  variant?: string
  prompt?: string
  options: { [key: string]: unknown }
  steps?: number
}
```

### CommandInfo 类型

```typescript
type CommandInfo = {
  name: string
  description?: string
  agent?: string
  model?: string
  source?: 'command' | 'mcp' | 'skill'
  template?: string
  scope?: 'project' | 'global'
  subtask?: boolean
  hints: Array<string>
}
```

### SkillInfo 类型

```typescript
type SkillInfo = {
  name: string
  description?: string
  location: string
  content: string
  userInvocable?: boolean
  source?: 'skill' | 'mcp' | 'command'
}
```

### ToolSummary 类型

```typescript
type ToolSummary = {
  name: string
  search_hint?: string
  input_schema?: unknown
}
```

### McpConfig 工具定义

```typescript
type McpTool = {
  name: string
  description?: string
  input_schema: unknown
  enabled: boolean
}
```

### AuthCredential 类型

```typescript
type AuthCredential =
  | { type: 'oauth'; refresh: string; access: string; expires: number }
  | { type: 'api'; key: string; metadata?: { [key: string]: string } }

type AuthInfo = {
  id: string
  serviceID: string
  description: string
  credential: AuthCredential
}
```

### AgentAddRequest 类型

```typescript
type AgentAddRequest = {
  id: string
  scope?: 'user' | 'project'
  version?: string
}

type AgentAddResponse = {
  success: boolean
  message?: string
}

type AgentRemoveResponse = {
  success: boolean
  message?: string
}
```

### SessionContextResponse 类型

```typescript
type SessionContextTokenBudget = {
  used?: number
  available?: number
  percentage?: number
}

type SessionContextCompact = {
  available?: boolean
  last_compacted_at?: string
  reason?: string
}

type SessionContextAttachment = {
  type: string
  path?: string
  uri?: string
}

type SessionContextResponse = {
  session_id?: string
  token_budget?: SessionContextTokenBudget
  compact?: SessionContextCompact
  attachments?: SessionContextAttachment[]
  summary?: string
}
```

### SnapshotFileDiffArray 类型

```typescript
type SnapshotFileDiff = {
  file: string
  patch?: string
  additions?: number
  deletions?: number
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'
}

type SnapshotFileDiffArray = Array<SnapshotFileDiff>
```

### WsTicketRequest / WsTicketResponse 类型

```typescript
type WsTicketRequest = {
  scope: 'server' | 'session'
  session_id?: string
  scopes: string[]
  ttl_ms?: number
}

type WsTicketResponse = {
  ticket: string
  expires_at: string
}
```

---

---

<a id="ch21"></a>

# 附录 B: Event 类型

通过 SSE（Server-Sent Events）流获取服务端实时事件通知。

## 事件一览

| 事件类型 | 触发场景 |
| --- | --- |
| `server.connected` | SSE/WebSocket 连接建立 |
| `server.heartbeat` | 定时心跳（默认 10s） |
| `server.instance.disposed` | 服务实例销毁 |
| `session.created` | 创建新会话 |
| `session.updated` | 会话信息变更（prompt 完成/失败/中止后） |
| `session.deleted` | 删除会话 |
| `session.status` | 会话运行状态变更（busy/idle/retry） |
| `session.idle` | 会话进入空闲（与 session.status idle 同时发出，向后兼容） |
| `session.error` | 会话发生错误 |
| `session.state_changed` | 会话状态转换（idle/running/requires_action） |
| `session.compacted` | 会话上下文压缩完成 |
| `session.reverted` | 会话回滚完成 |
| `session.unreverted` | 取消会话回滚 |
| `message.updated` | 消息创建或更新 |
| `message.created` | 消息创建 |
| `message.removed` | 消息删除 |
| `message.part.updated` | 消息片段完整快照更新 |
| `message.part.removed` | 消息片段删除 |
| `message.part.delta` | 消息片段增量更新（流式文本/推理 delta） |
| `session.next.reasoning.started` | 模型推理过程开始 |
| `session.next.reasoning.delta` | 模型推理过程增量 |
| `session.next.reasoning.ended` | 模型推理过程结束 |
| `task.started` | 子 Agent 任务开始 |
| `task.progress` | 子 Agent 任务进度 |
| `task.notification` | 子 Agent 任务通知（completed/failed/stopped） |
| `permission.asked` | 权限请求（工具执行需要授权时） |
| `permission.replied` | 权限回复（用户授权/拒绝/中止） |
| `permission.updated` | 权限上下文更新 |
| `question.asked` | 问题请求（工具需要用户交互时） |
| `question.replied` | 问题回复 |
| `question.rejected` | 问题拒绝（用户取消/超时） |
| `file.edited` | 文件被编辑 |
| `file.watcher.updated` | 文件系统监听变更 |
| `command.executed` | 斜杠命令执行完成 |
| `installation.updated` | 安装版本更新 |
| `todo.updated` | Todo 列表更新 |

### 连接方式

#### 实例级事件流

```
GET /api/v1/event?directory={directory}&workspace={workspace}
```

按 `directory` 和 `workspace` 过滤，只接收匹配的事件。`workspace` 为可选参数。

#### 全局事件流

```
GET /api/v1/global/event
```

接收所有实例的事件，不过滤。

#### SSE 消息格式

```
event: message
data: {"id":"evt_xxx","type":"session.status","properties":{...}}
```

全局事件流额外包含 `directory`、`project`、`workspace` 字段。

### 连接生命周期事件

#### server.connected

连接建立后立即发送，无附加属性。

#### server.heartbeat

定时心跳，默认 10 秒间隔。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| intervalMs | number | 心跳间隔（毫秒） |

#### server.instance.disposed

服务实例销毁时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| directory | string | 实例目录 |

### 会话事件

#### session.created

创建新会话时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |
| info | Session | 会话完整信息 |

#### session.updated

会话信息变更时发送（prompt 完成/失败/中止后）。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |
| info | Session | 会话完整信息 |

#### session.deleted

会话被删除时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |
| info | Session | 会话完整信息 |

#### session.status

会话运行状态变更时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |
| status | SessionStatus | 状态对象 |

**SessionStatus 类型：**

| 状态 | 属性 | 说明 |
| --- | --- | --- |
| `{ type: "idle" }` | — | 会话空闲 |
| `{ type: "busy" }` | — | 会话正在处理 |
| `{ type: "retry", attempt, message, action?, next }` | attempt: number, message: string, next: number | 会话正在重试 |

#### session.idle

会话进入空闲状态时发送，与 `session.status` (idle) 同时发出，用于向后兼容。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |

#### session.error

会话发生错误时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID（可选） |
| error | SessionErrorUnion | 错误详情（可选） |

**错误类型：**

| 错误名 | 说明 |
| --- | --- |
| ProviderAuthError | Provider 认证失败 |
| UnknownError | 未知错误 |
| MessageOutputLengthError | 输出长度超限 |
| MessageAbortedError | 消息被中止 |
| StructuredOutputError | 结构化输出错误 |
| ContextOverflowError | 上下文溢出 |
| APIError | API 调用错误 |

#### session.state_changed

会话状态转换时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |
| state | string | `"idle"` / `"running"` / `"requires_action"` |

#### session.compacted

会话上下文压缩完成时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |

#### session.reverted

会话回滚操作完成时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |
| messageID | string | 回滚到的消息 ID |
| partID | string | 回滚到的片段 ID |
| snapshot | string | 快照标识 |

#### session.unreverted

取消会话回滚时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |

### 消息事件

#### message.updated

消息创建或更新时发送（包括用户消息、助手消息占位、流式结果等）。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |
| info | Message | 消息完整信息 |

#### message.created

消息创建时发送（与 message.updated 类似，但仅在消息首次创建时触发）。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |
| info | Message | 消息完整信息 |

#### message.removed

消息被删除时发送（压缩清理、回滚清理时）。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |
| messageID | string | 被删除的消息 ID |

#### message.part.updated

消息片段完整快照更新时发送（content_block_stop 或 message_stop 时）。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |
| part | Part | 片段完整快照 |
| time | number | 时间戳 |
| task_id | string | 子 Agent 任务 ID（可选） |

**Part 类型包括：** text, subtask, reasoning, file, tool, step-start, step-finish, snapshot, patch, agent, retry, compaction

#### message.part.removed

消息片段被删除时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |
| messageID | string | 消息 ID |
| partID | string | 片段 ID |

#### message.part.delta

消息片段增量更新时发送（流式文本/推理 delta）。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |
| messageID | string | 消息 ID |
| partID | string | 片段 ID |
| field | string | 变更字段名 |
| delta | string | 增量内容 |

### 推理事件

#### session.next.reasoning.started

模型推理过程（thinking block）开始时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| timestamp | number | 时间戳 |
| sessionID | string | 会话 ID |
| assistantMessageID | string | 助手消息 ID |
| reasoningID | string | 推理片段 ID |
| providerMetadata | object | Provider 元数据（可选） |

#### session.next.reasoning.delta

模型推理过程增量内容。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| timestamp | number | 时间戳 |
| sessionID | string | 会话 ID |
| assistantMessageID | string | 助手消息 ID |
| reasoningID | string | 推理片段 ID |
| delta | string | 增量推理内容 |

#### session.next.reasoning.ended

模型推理过程结束时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| timestamp | number | 时间戳 |
| sessionID | string | 会话 ID |
| assistantMessageID | string | 助手消息 ID |
| reasoningID | string | 推理片段 ID |
| text | string | 完整推理文本 |
| providerMetadata | object | Provider 元数据（可选） |

### 子 Agent 任务事件

#### task.started

子 Agent 任务开始执行时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |
| task_id | string | 任务 ID |
| agent_type | string | Agent 类型（可选） |
| description | string | 任务描述 |
| tool_use_id | string | 工具调用 ID（可选） |
| task_type | string | 任务类型（可选） |
| workflow_name | string | 工作流名称（可选） |
| prompt | string | 任务提示（可选） |

#### task.progress

子 Agent 任务执行进度更新时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |
| task_id | string | 任务 ID |
| agent_type | string | Agent 类型（可选） |
| description | string | 进度描述 |
| tool_use_id | string | 工具调用 ID（可选） |
| usage | object | 资源使用（可选） |
| last_tool_name | string | 最后执行的工具名（可选） |
| summary | string | 进度摘要（可选） |
| workflow_progress | object[] | 工作流进度（可选） |

#### task.notification

子 Agent 任务状态通知（完成/失败/停止）。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |
| task_id | string | 任务 ID |
| agent_type | string | Agent 类型（可选） |
| tool_use_id | string | 工具调用 ID（可选） |
| status | string | `"completed"` / `"failed"` / `"stopped"` |
| output_file | string | 输出文件路径 |
| summary | string | 结果摘要 |
| usage | object | 资源使用（可选） |

### 权限事件

#### permission.asked

工具执行需要用户授权时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 权限请求 ID |
| sessionID | string | 会话 ID |
| permission | string | 权限类型 |
| patterns | string[] | 文件匹配模式 |
| metadata | object | 元数据 |
| always | string[] | "始终允许"选项 |
| tool | object | 关联的工具信息（可选，含 messageID 和 callID） |

#### permission.replied

用户对权限请求做出响应时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |
| requestID | string | 权限请求 ID |
| reply | string | `"once"` / `"always"` / `"reject"` |
| effective_reply | string | 实际生效的回复（可选） |

#### permission.updated

权限上下文更新时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 权限 ID |
| sessionID | string | 会话 ID（可选） |
| messageID | string | 消息 ID（可选） |
| callID | string | 工具调用 ID（可选） |
| title | string | 标题（可选） |
| metadata | object | 元数据（可选） |
| permission | any | 权限信息（可选） |
| patterns | string[] | 文件匹配模式（可选） |
| status | string | 固定为 `"pending"` |

### 问答事件

#### question.asked

工具需要用户交互输入时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 问题请求 ID |
| sessionID | string | 会话 ID |
| questions | QuestionInfo[] | 问题列表 |
| tool | QuestionTool | 关联的工具信息（可选） |

#### question.replied

用户回答问题后发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |
| requestID | string | 问题请求 ID |
| answers | string[][] | 回答内容 |

#### question.rejected

用户取消或超时未回答时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |
| requestID | string | 问题请求 ID |
| reason | string | 拒绝原因（可选） |

### 文件事件

#### file.edited

文件被编辑（工具执行后）时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| file | string | 被编辑的文件路径 |

#### file.watcher.updated

文件系统监听变更时发送，与 `file.edited` 同时发出。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| file | string | 变更文件路径 |
| event | string | `"add"` / `"change"` / `"unlink"` |

### 命令事件

#### command.executed

斜杠命令执行完成时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| name | string | 命令名称 |
| sessionID | string | 会话 ID |
| arguments | string | 命令参数 |
| messageID | string | 消息 ID |

### 系统事件

#### installation.updated

服务启动时发送当前版本信息。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| version | string | 当前安装版本 |

#### todo.updated

Todo 列表更新时发送。

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| sessionID | string | 会话 ID |
| todos | Todo[] | Todo 列表 |

### 事件时序示例

#### 典型 Prompt 执行流程

```
1. session.status          { status: { type: "busy" } }
2. session.updated         { info: { ... } }
3. message.updated         { info: UserMessage }          // 用户消息
4. message.updated         { info: AssistantMessage }     // 助手消息占位
5. session.state_changed   { state: "running" }
6. message.part.delta      { delta: "..." }               // 流式文本（多次）
7. message.part.updated    { part: TextPart }             // 文本片段完成
8. session.next.reasoning.started  { ... }                // 推理开始（如启用）
9. session.next.reasoning.delta    { delta: "..." }       // 推理增量（多次）
10. session.next.reasoning.ended   { text: "..." }        // 推理结束
11. message.part.updated   { part: ToolPart }             // 工具调用片段
12. task.started           { ... }                        // 子 Agent 开始（如有）
13. task.progress          { ... }                        // 子 Agent 进度（多次）
14. task.notification      { status: "completed" }        // 子 Agent 完成
15. message.updated        { info: AssistantMessage }     // 最终结果消息
16. session.status         { status: { type: "idle" } }
17. session.idle           { sessionID: "..." }
18. session.updated        { info: { ... } }
19. session.state_changed  { state: "idle" }
```

#### 权限请求流程

```
1. permission.asked        { id, permission, patterns, ... }
   → 用户通过 API 回复
2. permission.replied      { requestID, reply: "once"|"always"|"reject" }
```

#### 问答流程

```
1. question.asked          { id, questions: [...] }
   → 用户通过 API 回答
2. question.replied        { requestID, answers: [...] }
```

---

---

<a id="ch22"></a>

# Python SDK 流式对话示例

本文档提供了一个简化的 Python SDK 使用示例，展示如何实现异步流式对话功能。

## 运行示例

### 前提条件

- 确保已安装 Python 3.10+
- 确保已安装 httpx：

  ```bash
  pip install httpx
  ```
- 确保已安装 codeagent-sdk

- 确保 CodeAgent 服务器正在运行：

  ```bash
  codeagent serve
  ```

### 注意

> - 如果遇到 agent 接口报 404，请升级 CodeAgentCLI 到最新版本

### 示例代码

```python
import asyncio
import json
import os
from pathlib import Path

# 禁用代理，避免 localhost 请求被拦截
os.environ["NO_PROXY"] = "127.0.0.1,localhost"
os.environ["no_proxy"] = "127.0.0.1,localhost"

from codeagent_sdk import AuthenticatedClient
from codeagent_sdk.api.app import app_agents
from codeagent_sdk.api.config import config_providers
from codeagent_sdk.api.session import session_create
from codeagent_sdk.api.prompt import session_prompt_async
from codeagent_sdk.models.session_create_request import SessionCreateRequest
from codeagent_sdk.api.permission import permission_reply
from codeagent_sdk.models.permission_reply_request import PermissionReplyRequest
from codeagent_sdk.models.permission_reply_request_reply import PermissionReplyRequestReply
from codeagent_sdk.api.question import question_reply
from codeagent_sdk.models.question_reply_request import QuestionReplyRequest
from codeagent_sdk.models.prompt_async_request import PromptAsyncRequest
from codeagent_sdk.models.prompt_async_request_parts_item_type_0 import PromptAsyncRequestPartsItemType0
from codeagent_sdk.models.prompt_async_request_model import PromptAsyncRequestModel

# 工作目录
DIRECTORY = str(Path.cwd())

# 创建client方式一：独立启动server，填写url和token。注：方式一、方式二根据情况任选一种
def setup_client():
  """创建并配置 AuthenticatedClient"""
  base_url = os.environ.get("CODEAGENT_SERVER_URL", "在这里填写server的url，示例：http://127.0.0.1:50772")
  token = os.environ.get("CODEAGENT_SERVER_TOKEN", "在这里填写token")

  client = AuthenticatedClient(
    base_url=f"{base_url}/api/v1",
    token=token,
    httpx_args={"trust_env": False},  # 禁用代理,
  )
  print("✅ 客户端配置完成")
  return client

# 创建client方式二：通过SDK内置方法启动server。注：方式一、方式二根据情况任选一种
# def start_server():
#     """通过 SDK 内置方式启动 CodeAgent server，注入权限环境变量"""
#     print("🚀 启动 CodeAgent server（SDK 内置模式）...")
#     app = create_code_agent(
#         cwd=Path.cwd(),
#         config_dir=join(Path.home(), ".cac"),
#         env={
#             "SDK_LOAD_SETTINGS_PERMISSIONS": "true",
#         },
#     )
#     client = app.client  # AuthenticatedClient
#     server = app.server  # CodeAgentServer，关闭应用时记得调用server.close()关闭服务
#     print(f"✅ Server 已启动: {server.base_url}")
#     return client, server

def get_or_create_session(client):
  """创建测试会话"""
  try:
    session_title = "Python SDK 流式对话"

    # 创建新会话
    create_body = SessionCreateRequest(title=session_title)
    create_response = session_create.sync_detailed(
      client=client,
      directory=DIRECTORY,
      body=create_body,
    )
    if create_response.status_code.value == 200:
      session_id = create_response.parsed.id
      print(f"✅ 创建新会话: {session_id}")
      return session_id

    print("❌ 无法创建会话")
    return None
  except Exception as e:
    print(f"❌ 创建会话失败: {e}")
    return None

async def handle_events(client, session_id, streaming_response, response_lock):
  """处理流式事件，实时显示 AI 响应"""
  # 维护 part_id 到类型的映射
  part_types = {}  # {part_id: "text" | "reasoning"}
  # 跟踪当前显示的 part 类型
  current_part_type = None

  try:
    async_httpx_client = client.get_async_httpx_client()
    async with async_httpx_client.stream(
            "GET",
            "/event",
            params={"directory": DIRECTORY},
    ) as response:
      async for line in response.aiter_lines():
        if not line.startswith("data: "):
          continue

        data = json.loads(line[6:])
        # 可打印事件流（方便调试定位）
        # print(f"Event: {json.dumps(data, ensure_ascii=False)}")
        event_type = data.get("type")
        properties = data.get("properties", {})

        # 权限请求事件：让用户选择 once/always/reject
        if event_type in ("permission.asked", "permission.requested"):
          request_id = properties.get("id")
          if request_id:
            asyncio.create_task(
              handle_permission_asked(client, request_id, properties)
            )
          continue

        # 问题请求事件：显示交互选项让用户选择
        if event_type == "question.asked":
          request_id = properties.get("id")
          questions = properties.get("questions", [])
          if request_id and questions:
            asyncio.create_task(
              handle_question_asked(client, request_id, questions)
            )
          continue

        if event_type == "message.part.updated":
          # 记录 part 的类型
          part = properties.get("part", {})
          part_session_id = properties.get("sessionID", "")
          if part_session_id == session_id:
            part_types[part.get("id")] = part.get("type")

          # 工具调用记录
          if part.get("type") == "tool" and part_session_id == session_id:
            tool_name = part.get("tool", "unknown")
            call_id = part.get("callID", "")
            state = part.get("state", {})
            status = state.get("status", "")
            tool_input = state.get("input", {})

            if status == "pending":
              print(f"\n\033[33m🔧 {tool_name}\033[0m args: {json.dumps(tool_input, ensure_ascii=False)}")
            elif status == "completed":
              output = state.get("output", "")
              # 截断过长的输出
              if len(output) > 500:
                output = output[:500] + "...(truncated)"
              print(f"\n\033[32m✅ {tool_name} result:\033[0m {output}")
            elif status == "error":
              error_msg = state.get("error", "")
              print(f"\n\033[31m❌ {tool_name} error:\033[0m {error_msg}")

        elif event_type == "message.part.delta":
          # 检查 session_id
          if properties.get("sessionID") != session_id:
            continue
          # field 值: "thinking" 表示思考内容, "text" 表示普通文本
          field = properties.get("field")
          if field == "thinking":
            part_type = "reasoning"
          elif field:
            part_type = field
          else:
            part_type = part_types.get(properties.get("partID"), "text")

          delta_text = properties.get("delta", "")
          if part_type == "reasoning":
            # 思考内容使用特殊样式展示
            if current_part_type != "reasoning":
              print(f"\n\033[90m💭 think:\033[0m", end="", flush=True)
              current_part_type = "reasoning"
            print(f"\033[90m{delta_text}\033[0m", end="", flush=True)
          else:
            # 普通文本内容
            if current_part_type == "reasoning":
              print()
            current_part_type = "text"
            async with response_lock:
              streaming_response["content"] += delta_text
            print(delta_text, end="", flush=True)

        elif event_type == "message.updated":
          # 消息完成
          info = properties.get("info", {})
          if properties.get("sessionID") != session_id:
            continue
          if info.get("finish") == "stop":
            async with response_lock:
              streaming_response["completed"] = True
            print()

        elif event_type == "session.idle":
          # 会话空闲，作为完成信号的补充
          if properties.get("sessionID") == session_id:
            async with response_lock:
              streaming_response["completed"] = True

        elif event_type == "session.error":
          # 会话错误
          if properties.get("sessionID") == session_id:
            print(f"\n⚠️ 会话错误: {properties.get('error', '')}")
            async with response_lock:
              # streaming_response["completed"] = True
              streaming_response["error"] = True

  except Exception as e:
    print(f"⚠️ 事件处理异常: {e}")

async def send_message(client, session_id, agent, prompt, streaming_response,
                       response_lock, provider_id, model_id):
  """发送消息并显示流式响应"""
  try:
    # 重置响应状态
    async with response_lock:
      streaming_response["content"] = ""
      streaming_response["completed"] = False
      streaming_response["error"] = False

    # 构造消息体
    prompt_body = PromptAsyncRequest(
      agent=agent.name,
      model=PromptAsyncRequestModel(
        provider_id=provider_id,
        model_id=model_id,
      ),
      parts=[
        PromptAsyncRequestPartsItemType0(type_="text", text=prompt),
      ],
      # permission_mode=PermissionMode.BYPASSPERMISSIONS,
    )

    # 发送消息（异步 API）
    async_response = session_prompt_async.sync_detailed(
      client=client,
      session_id=session_id,
      body=prompt_body,
      directory=DIRECTORY,
    )

    if async_response.status_code.value != 204:
      print(f"❌ 发送消息失败: {async_response.status_code}")
      if hasattr(async_response, "content"):
        print(f"  错误详情: {async_response.content}")
      return False

    while True:
      await asyncio.sleep(1)

      async with response_lock:
        last_content_length = len(streaming_response["content"])
        # 如果响应已完成，退出等待
        if streaming_response["completed"]:
          break

    print(f"\n✅ 响应完成，共 {last_content_length} 字符")

    return True
  except Exception as e:
    print(f"❌ 发送消息异常: {e}")
    import traceback
    traceback.print_exc()
    return False

async def handle_permission_asked(client, request_id, properties):
  """显示权限请求信息，让用户选择 once/always/reject 后回复"""
  # 显示权限请求详情
  tool_name = properties.get("toolName", "unknown")
  input_summary = properties.get("inputSummary", "")
  print("\n" + "=" * 60)
  print(f"🔐 权限请求: {tool_name}")
  if input_summary:
    print(f"   {input_summary}")
  print("-" * 60)
  print("   1. once   — 本次允许")
  print("   2. always — 始终允许")
  print("   3. reject — 拒绝")
  print("=" * 60)

  choices = {
    "1": PermissionReplyRequestReply.ONCE,
    "2": PermissionReplyRequestReply.ALWAYS,
    "3": PermissionReplyRequestReply.REJECT,
  }

  while True:
    try:
      choice = (await asyncio.to_thread(input, "请输入选项编号: ")).strip()
      if choice in choices:
        reply = choices[choice]
        break
      print("⚠️ 请输入 1、2 或 3")
    except (EOFError, KeyboardInterrupt):
      print("\n⚠️ 取消，默认拒绝")
      reply = PermissionReplyRequestReply.REJECT
      break

  try:
    reply_body = PermissionReplyRequest(reply=reply)
    resp = await permission_reply.asyncio_detailed(
      request_id=request_id,
      client=client,
      body=reply_body,
      directory=DIRECTORY,
    )
    if resp.status_code.value == 200:
      print(f"✅ 已回复权限请求: {request_id} ({reply.value})")
    else:
      print(f"⚠️ 回复权限请求失败: {resp.status_code}")
  except Exception as e:
    print(f"⚠️ 回复权限请求异常: {e}")

async def handle_question_asked(client, request_id, questions):
  """显示问题选项，让用户交互选择后回复"""
  answers = []
  for q in questions:
    question_text = q.get("question", "")
    header = q.get("header", "")
    options = q.get("options", [])
    multi_select = q.get("multiSelect", False)

    print("\n" + "=" * 60)
    print(f"📋 {header}")
    print(f"   {question_text}")
    print("-" * 60)
    for idx, opt in enumerate(options, 1):
      label = opt.get("label", f"Option {idx}")
      desc = opt.get("description", "")
      print(f"   {idx}. {label}" + (f" — {desc}" if desc else ""))
    print("=" * 60)

    while True:
      try:
        if multi_select:
          choice = (await asyncio.to_thread(input, "请输入选项编号（逗号分隔）: ")).strip()
          nums = [int(s.strip()) for s in choice.split(",") if s.strip()]
          selected = [options[n - 1].get("label", "") for n in nums if 1 <= n <= len(options)]
          if selected:
            answers.append(selected)
            break
        else:
          choice = (await asyncio.to_thread(input, "请输入选项编号: ")).strip()
          num = int(choice)
          if 1 <= num <= len(options):
            answers.append([options[num - 1].get("label", "")])
            break
        print(f"⚠️ 请输入 1-{len(options)} 之间的数字")
      except ValueError:
        print("⚠️ 请输入有效数字")
      except (EOFError, KeyboardInterrupt):
        print("\n👋 取消，默认选第1项")
        answers.append([options[0].get("label", "")] if options else [""])
        break

  try:
    reply_body = QuestionReplyRequest(answers=answers)
    resp = await question_reply.asyncio_detailed(
      request_id=request_id,
      client=client,
      body=reply_body,
      directory=DIRECTORY,
    )
    if resp.status_code.value == 200:
      print(f"✅ 已回复问题: {request_id}")
    else:
      print(f"⚠️ 回复问题失败: {resp.status_code}")
  except Exception as e:
    print(f"⚠️ 回复问题异常: {e}")

async def chat_loop(client, session_id, agent, streaming_response,
                    response_lock, provider_id, model_id):
  """交互式对话循环"""
  print("=" * 60)
  print("开始对话（输入 'quit' 退出）")
  print("=" * 60)

  while True:
    print("\n💭 您:")
    try:
      prompt = input("> ")
    except (EOFError, KeyboardInterrupt):
      print("\n\n👋 检测到中断，退出对话")
      break

    if prompt.lower() in ("quit", "exit", "q"):
      print("👋 退出对话")
      break

    if not prompt.strip():
      print("⚠️ 请输入有效的内容")
      continue

    print("\n🤖 AI:")

    # 发送消息并显示流式响应
    success = await send_message(
      client, session_id, agent, prompt,
      streaming_response, response_lock, provider_id, model_id,
    )
    if not success:
      print("⚠️ 消息发送失败，请重试")

def get_agents(client):
  """获取可用的 agents"""
  try:
    agents_response = app_agents.sync_detailed(
      client=client,
      directory=DIRECTORY,
    )
    if agents_response.status_code.value != 200:
      print(f"❌ 无法获取 agents 列表: {agents_response.status_code},content:{agents_response.content}")
      return None

    agents = agents_response.parsed or []
    if not agents:
      print("❌ 无可用 agent")
      return None

    print(f"✅ 找到 {len(agents)} 个可用 agent")
    # print(f"agents:{json.dumps([agent.to_dict() for agent in agents])}")
    return agents
  except Exception as e:
    print(f"❌ 获取 agents 失败: {e}")
    return None

def get_providers(client):
  """获取所有可用 provider 和 model，返回 [(provider_id, model_id, display_name)] 列表"""
  try:
    providers_response = config_providers.sync_detailed(
      client=client,
      directory=DIRECTORY,
    )
    # print(f"providers_response={providers_response.content}")
    if providers_response.status_code.value != 200:
      print(f"❌ 无法获取 provider 列表: {providers_response.status_code}")
      return []

    providers_data = providers_response.parsed
    if not providers_data:
      print("❌ 无可用的 provider 配置")
      return []

    all_providers = providers_data.providers or []
    print(f"  可用 provider: {len(all_providers)} 个")

    models = []
    for p in all_providers:
      model_keys = list(p.models.additional_properties.keys()) if p.models else []
      for mid in model_keys:
        models.append((p.id, mid, f"{p.id}/{mid}"))
    return models
  except Exception as e:
    print(f"❌ 获取 provider 失败: {e}")
    return []

def select_model(models):
  """列出所有模型，让用户选择一个，返回 (provider_id, model_id)"""
  if not models:
    print("❌ 无可用模型")
    return None, None

  print("\n" + "=" * 60)
  print("可用模型列表：")
  print("=" * 60)
  for i, (_, _, display) in enumerate(models, 1):
    print(f"  {i:>3}. {display}")
  print("=" * 60)

  while True:
    try:
      choice = input("请输入模型序号（回车默认第 1 个）: ").strip()
      if not choice:
        idx = 0
      else:
        idx = int(choice) - 1
      if 0 <= idx < len(models):
        provider_id, model_id, _ = models[idx]
        print(f"✅ 已选择: {provider_id}/{model_id}")
        return provider_id, model_id
      print(f"⚠️ 请输入 1-{len(models)} 之间的数字")
    except ValueError:
      print("⚠️ 请输入有效数字")
    except (EOFError, KeyboardInterrupt):
      print("\n👋 取消选择")
      return None, None

async def main():
  """异步流式对话主函数"""
  print("=" * 60)
  print("Python SDK 流式对话示例")
  print("=" * 60)

  try:
    # 创建客户端
    print("\n📦 创建客户端...")
    client = setup_client()

    # 获取 agents
    print("\n🤖 获取可用 agents...")
    agents = get_agents(client)
    if not agents:
      return

    # 获取可用 provider 列表
    print("\n🔧 获取可用 provider 列表...")
    models = get_providers(client)

    # 交互选择模型
    provider_id, model_id = select_model(models)
    if not provider_id:
      return

    # 创建会话
    print("\n💬 创建会话...")
    session_id = get_or_create_session(client)
    if not session_id:
      return

    # 启动事件监听
    print("\n📡 启动事件监听...")
    streaming_response = {"content": "", "completed": False, "error": False}
    response_lock = asyncio.Lock()
    event_task = asyncio.create_task(
      handle_events(client, session_id, streaming_response, response_lock)
    )

    # 对话循环
    await chat_loop(
      client, session_id, agents[0],
      streaming_response, response_lock, provider_id, model_id,
    )

    # 清理
    print("\n📡 清理事件监听...")
    if event_task:
      event_task.cancel()
      try:
        await event_task
      except asyncio.CancelledError:
        pass

    # 关闭客户端
    try:
      client.get_httpx_client().close()
    except Exception:
      pass

    print("\n✅ 程序执行完成")

  except Exception as e:
    print(f"\n❌ 程序异常: {e}")
    import traceback
    traceback.print_exc()

if __name__ == "__main__":
  try:
    asyncio.run(main())
  except KeyboardInterrupt:
    print("\n\n👋 程序已退出")
  except Exception as e:
    print(f"\n❌ 程序异常退出: {e}")
```

### 示例输出

```
============================================================
Python SDK 流式对话示例
============================================================

📦 创建客户端...
✅ 客户端配置完成

🤖 获取可用 agents...
✅ 找到 5 个可用 agent

🔧 获取默认 provider 配置...
✅ 获取默认 provider: default, model: default-model

💬 创建会话...
✅ 创建新会话: ses_xxxxx

📡 启动事件监听...

============================================================
开始对话（输入 'quit' 退出）
============================================================

💭 您:
> hi

🤖 AI:
Hi! How can I help you?
✅ 响应完成，共 23 字符

💭 您:
> 什么是 Python？

🤖 AI:
Python 是一种高级编程语言，以其简洁的语法和强大的功能而闻名...
✅ 响应完成，共 156 字符

💭 您:
> quit
👋 退出对话

📡 清理事件监听...

✅ 程序执行完成
```

---

---

<a id="ch23"></a>

# TypeScript SDK 流式对话示例

本文档提供 TypeScript SDK 的流式对话完整示例，帮助快速上手 CodeAgent SDK。

---

## 一、快速开始

### 1.1 基本使用流程

完整的流式对话流程包括以下步骤：

1. 创建客户端 → 2. 健康检查 → 3. 创建会话 → 4. 订阅事件 → 5. 发送消息 → 6. 处理响应 → 7. 获取消息历史 → 8. 清理资源

---

## 二、完整流程示例

以下示例覆盖完整的流式对话流程，包含详细注释和最佳实践。

**完整代码：**

```typescript
import { createCodeAgentClient, createCodeAgent } from '@codeagent3/sdk';
import { homedir } from 'os';

/**
 * TypeScript SDK 流式对话完整示例（手动启动模式）
 *
 * 流程：创建客户端 → 健康检查 → 创建会话 → 订阅事件 → 发送消息 → 等待响应 → 获取消息历史 → 清理资源
 */
async function main() {
  console.log('=== TypeScript SDK 流式对话完整示例 ===\n');

  // ========== 1.1 创建客户端实例 ==========
  // ✅ 正确：使用环境变量配置，避免硬编码敏感信息
  const SERVER_URL = process.env.CODEAGENT_SERVER_URL ?? 'http://127.0.0.1:30000';
  const AUTH_TOKEN = process.env.CODEAGENT_SERVER_TOKEN ?? '';

  const client = createCodeAgentClient({
    baseUrl: SERVER_URL,
    authToken: AUTH_TOKEN,
    directory: process.cwd(), // 当前工作目录
    responseStyle: 'data', // 直接返回 data，无需手动解构 { data, error }
    throwOnError: true, // 错误时抛出异常，便于统一处理
  });

  console.log('✅ 步骤1: Client 创建成功（手动启动模式）');

  // ========== 1.2 自动启动 Server 并创建客户端 ==========
  // ✅ 正确：使用 createCodeAgent 自动启动 server，无需手动管理进程
  // const { server } = await createCodeAgent({
  //   cwd: process.cwd(),
  //   configDir: join(homedir(), '.cac'), // 配置目录
  // })
  // const client = server.dataClient()

  // console.log('✅ 步骤1: Server 自动启动成功')
  // console.log('  Base URL:', server.baseUrl)
  // console.log('  Token 已内置，无需手动配置')

  try {
    // ========== 2. 健康检查 ==========
    // ✅ 正确：检查服务器健康状态，确保服务可用
    const health = await client.global.health();
    console.log('✅ 步骤2: 服务器健康状态:', health.healthy);

    // ========== 2.1 获取 Provider 列表 ==========
    // ✅ 正确：获取所有可用的 provider 和模型信息
    const providerList = await client.config.providers();
    console.log('✅ 步骤2.1: Provider 列表获取成功');
    console.log(JSON.stringify(providerList, null, 2));

    // ========== 2.2 自定义模型配置 ==========
    // ✅ 正确：从现有 provider 中选择一个并自定义模型
    const customProvider = { id: 'default', name: 'default' };
    const customModelId = 'custom-model'; // 自定义模型 ID

    console.log('\n✅ 步骤2.2: 自定义模型配置');
    console.log(`  Provider: ${customProvider.name} (${customProvider.id})`);
    console.log(`  自定义模型 ID: ${customModelId}`);

    // ========== 3. 创建会话 ==========
    // ✅ 正确：创建新会话，指定工作目录和模型
    const session = await client.session.create({
      directory: process.cwd(), // 工作目录
      title: 'TypeScript SDK 流式对话示例',
      // model: {
      //   providerID: customProvider.id, // 使用自定义 provider
      //   id: customModelId, // 使用自定义模型
      // },
    });
    console.log('✅ 步骤3: 会话创建成功');
    console.log('  Session ID:', session.id);
    console.log('  Title:', session.title);
    console.log('  Directory:', session.directory);

    // ❌ 错误示例：未指定工作目录
    // const session = await client.session.create({
    //   title: 'Example', // 缺少 directory 参数
    // })

    // ========== 4. 订阅事件流 ==========
    // ✅ 正确：订阅 SSE 事件流，实时处理响应
    const eventStream = await client.event.subscribe();
    console.log('✅ 步骤4: 事件流订阅成功');

    // 创建事件处理任务（异步执行，不阻塞主流程）
    let responseCompleted = false;
    const eventHandler = async () => {
      try {
        for await (const event of eventStream.stream) {
          // 处理不同类型的事件
          switch (event.type) {
            // ✅ 正确：实时输出文本增量 case 'message.part.delta':// ✅ 正确：处理文本生成增量（另一种格式） case 'session.next.text.delta':
            // ✅ 正确：处理推理过程增量（思考过程）case 'session.next.reasoning.delta':
            // ✅ 正确：工具调用成功case 'session.next.tool.success':

            // ✅ 正确：自动批准权限请求（交互式场景）
            case 'permission.asked':
              await client.permission.reply({
                requestID: event.properties.id,
                reply: 'always', // 或 'deny' 拒绝
              });
              console.log('\n[权限] 询问');
              break;
            // ✅ 正确：权限已自动批准通过
            case 'permission.replied':
              console.log('\n[权限] 已自动批准');
              break;

            // ✅ 正确：会话空闲，表示对话完成
            case 'session.idle':
              console.log('\n✅ 步骤5: 对话完成');
              responseCompleted = true;
              return; // 结束事件循环

            // ❌ 错误：会话错误
            case 'session.error':
              console.error('\n[会话错误]', event.properties);
              responseCompleted = true;
              return;
          }
        }
      } catch (error) {
        console.error('❌ 事件处理出错:', error);
      }
    };

    // 启动事件处理（不阻塞）
    eventHandler();

    // ========== 5. 发送消息 ==========
    // ✅ 正确：发送消息到模型，触发流式响应
    console.log('\n✅ 步骤5: 发送消息...');
    await client.session.promptAsync({
      sessionID: session.id,
      parts: [
        {
          type: 'text',
          text: '你好，你是谁',
        },
      ],
      format: { type: 'text' }, // 文本格式
      // 如果需要临时切换模型，可以在 promptAsync 中指定（可选）
      // model: {
      //   providerID: customProvider.id, // 使用自定义 provider
      //   modelID: 'default-model-auto', // 使用自定义模型
      // },
    });

    // ========== 6. 等待响应完成 ==========
    // ✅ 正确：等待事件流处理完成（实际应用中应使用 Promise 或事件通知）
    // 这里使用简单的轮询等待
    const maxWaitTime = 30000; // 最大等待 30 秒
    const startTime = Date.now();
    while (!responseCompleted && Date.now() - startTime < maxWaitTime) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (!responseCompleted) {
      console.log('\n⚠️ 响应超时，继续执行...');
    }

    // ========== 7. 获取完整消息历史 ==========
    // ✅ 正确：获取会话的完整消息历史
    const messages = await client.session.messages({
      sessionID: session.id,
    });
    console.log('\n✅ 步骤6: 消息历史获取成功, 共', messages.length, '条消息');

    // ✅ 正确：消息结构为 { info: { role, id, ... }, parts: [{ text, ... }] }
    // 显示消息摘要
    messages.forEach((msg, index) => {
      const role = msg.info?.role || 'unknown'; // ✅ 正确：role 在 info 对象中
      const contentPreview = msg.parts?.map((p) => p.text).join('');
      console.log(`  ${index + 1}. Role: ${role}, Content: ${contentPreview}`);
    });

    // ❌ 错误示例：直接访问 msg.role（不存在）
    // messages.forEach((msg) => {
    //   console.log(msg.role) // undefined，因为 role 在 msg.info.role
    // })

    // ========== 8. 清理资源 ==========
    // ✅ 正确：删除会话，释放资源
    await client.session.delete({ sessionID: session.id });
    console.log('\n✅ 步骤7: 会话已删除，资源已清理');

    console.log('\n=== 示例执行完成 ===');
  } catch (error) {
    // ❌ 错误处理：捕获并显示详细错误信息
    console.error('\n❌ 执行出错:', error);
    if (error instanceof Error) {
      console.error('  错误信息:', error.message);
      console.error('  错误堆栈:', error.stack);
    } else {
      console.error('  未知错误:', JSON.stringify(error));
    }
    process.exit(1); // ✅ 正确：错误时退出进程
  } finally {
    // ✅ 正确：自启动server 需要在 finally 块中关闭 server，确保资源清理
    // await server.close();
    // ✅ 正确：确保进程退出（手动启动模式无需关闭 server）
    process.exit(0);
  }
}

// 执行主函数
main().catch(console.error);
```

**执行文件**

手动起serve先补全`SERVER_URL`和`AUTH_TOKEN`，然后运行`bun run <your-file-path>.ts` 或者 `npx tsx <your-file-path>.ts`

**执行结果示例：**

```
=== TypeScript SDK 流式对话完整示例（手动启动） ===

✅ 步骤1: Client 创建成功（手动启动模式）
✅ 步骤2: 服务器健康状态: true
✅ 步骤3: 会话创建成功
  Session ID: abc123-def456-ghi789
  Title: TypeScript SDK 流式对话示例
  Directory: /path/to/project
✅ 步骤4: 事件流订阅成功

✅ 步骤5: 发送消息...

✅ 步骤5: 对话完成

✅ 步骤6: 消息历史获取成功, 共 2 条消息
  1. Role: user, Content: 你好，你是谁
  2. Role: assistant, Content: 用户询问"你好，你是谁"，这是一个简单的自我介绍请求。我应该简洁地介绍自己，说明我是CodeAgentCLI的内部AI编码助手，以及我的主要功能和用途。根据指示，我应该简洁直接，不要过度解释。你好！我是 CodeAgentCLI 的内部 AI 编码助手。

我是一个交互式工具，帮助你完成软件工程任务，比如：
- 解决 bug 和修复代码问题
- 添加新功能和重构代码
- 解释代码和项目结构
- 执行各种开发操作

我可以访问你的本地代码库，使用各种工具来读取、编辑文件，搜索代码，运行命令等。有什么我可以帮助你的吗？

✅ 步骤7: 会话已删除，资源已清理

=== 示例执行完成 ===
```

---

## 三、问题定位

### 3.1 API不可用或者报401，需要使用auth login进行登录

```bash
# 先登录
codeagent auth login

# 再起serve
codeagent serve
```

### 3.2 Debug 日志位置

**服务器日志：**

```bash
# 默认 debug 日志位置（以 debug 启动 serve 或自启动时才会生成）
$HOME/.cac/debug/
```

### 3.2 Server 文件位置

**配置文件：**

```bash
# 全局配置
$HOME/.cac/server/log
```

---

---

<a id="ch24"></a>

# SDK 权限配置指导

本文档面向 CodeAgentCLI SDK 使用者，有关权限配置不生效或如何配置bypass模式的说明

---

## SDK权限生效方法

权限询问是 SDK 自动化流程最常见的卡点。CodeAgent 提供 **3 种** 解决方案，按"配置层级"从全局到细粒度排列：

| 方法 | 作用域 | 生效方式 | 适用场景 |
| --- | --- | --- | --- |
| 1. 用户配置文件预设权限 | 全局（所有会话） | serve 启动前预加载 | 统一默认权限策略，所有会话都走同一档 |
| 2. permission_mode（接口参数） | 工作区 / 会话 / 单次 prompt | 创建时指定 或 运行时动态切换 | 运行中会话权限策略 |
| 3. 监听事件流自动回复 | 单次询问 permission.asked | 运行时动态回复 permission.reply | 需要审计/记录每一次放行 |

**优先级**（高 → 低）：

```
promptAsync.permission_mode           （单次覆盖，最高）
        ↓
session.create（或session.update）      （会话初始模式）
        ↓
workspaces.create                     （工作区策略，会话未传则继承）
        ↓
全局 settings.json                    （预加载模式，最低）
        ↓
permission.reply                      （兜底行为，监听询问事件，自动回复）
```

---

### 方法 1：用户配置文件预设bypassPermissions

在用户配置文件 `~/.cac/settings.json` 中写入 `permissions.defaultMode`，但 SDK 默认 **不读取** 该配置。必须在启动 serve 前**精确**设置环境变量 `SDK_LOAD_SETTINGS_PERMISSIONS='true'`，serve 启动时才会预加载该配置。

**配置文件**（`~/.cac/settings.json`）：

```json
{
  "permissions": {
    "defaultMode": "bypassPermissions"
  }
}
```

#### 1） 手动起 serve

```bash
# Linux/macOS
export SDK_LOAD_SETTINGS_PERMISSIONS=true

# Windows (cmd)
set SDK_LOAD_SETTINGS_PERMISSIONS=true

# Windows (PowerShell)
$env:SDK_LOAD_SETTINGS_PERMISSIONS = 'true'

# 启动serve
codeagent serve
```

#### 2） 自启动起 serve

SDK 的 `env` 选项会把环境变量注入到 serve 子进程，无需在父进程预设。两种语言 SDK 均支持：

##### TypeScript SDK

```typescript
import { createCodeAgentServer } from 'codeagent';
import { homedir } from 'node:os';
import { join } from 'node:path';

const server = await createCodeAgentServer({
  cwd: process.cwd(),
  configDir: join(homedir(), '.cac'),
  // binaryPath: 'codeagent',  可指向本地 .bat 或 .exe
  env: {
    SDK_LOAD_SETTINGS_PERMISSIONS: 'true', // 注入到子进程环境
  },
});

const client = server.dataClient();
// 后续所有会话默认 bypassPermissions，无需每次显式传参
```

##### Python SDK

```python
from os.path import join
from pathlib import Path
from codeagent_sdk import create_code_agent

app = create_code_agent(
    cwd=Path.cwd(),
    config_dir=join(Path.home(), ".cac"),
    env={
        "SDK_LOAD_SETTINGS_PERMISSIONS": "true",  # 注入到子进程环境
    },
)
client = app.client   # AuthenticatedClient
server = app.server   # CodeAgentServer
# Python 的 sync()/asyncio() 天然就是 data-first（直接返回 data），无需额外 dataClient()

# 后续所有会话默认 bypassPermissions，无需每次显式传参

# 使用完毕后关闭 server
server.close()
```

> **两种 SDK 的 `env` 行为差异**：
> - **TypeScript**：`env` 中的值会覆盖父进程同名变量；值为 `undefined` 时不会移除该键。
> - **Python**：`env` 中的值会覆盖父进程同名变量；值为 `None` 时会从子进程环境中**移除**该键。

---

### 方法 2：工作区/会话/prompt时传入权限模式

在 `workspaces.create` / `session.create` / `session.promptAsync` 调用时直接传权限模式参数，仅作用于当前工作区/会话/prompt，不影响全局配置。

#### 1） workspaces.create

```typescript
// 创建一个 bypassPermissions 的工作区
const workspace = await client.workspaces.create({
  cwd: process.cwd(),
  permission_policy: {
    mode: 'bypassPermissions', // ← 嵌套在 permission_policy 下
  },
});

// 该工作区下创建的会话默认继承工作区权限策略
const session = await client.session.create({
  directory: workspace.cwd,
  title: 'inherited-session',
  workspaceID: workspace.id,
  // 不传 permission_mode，继承 workspace 的 permission_policy
});
```

#### 2） session.create / session.update

```typescript
// 创建一个 bypassPermissions 的会话
const session = await client.session.create({
  directory: process.cwd(),
  title: 'my-automated-session',
  permission_mode: 'bypassPermissions', // 不传，继承 workspace 的 permission_policy
});

// 后续可更新会话的权限模式
await client.session.update({
  sessionID: session.id,
  permission_mode: 'acceptEdits', // ← 修改后持久生效
});
```

#### 3） session.promptAsync

**特点**：仅在本次 prompt 调用期间生效，不污染会话整体权限模式。下一次 `promptAsync` 若不传该字段，则继续沿用会话级权限模式。

```typescript
// 会话本身保持 default 模式（默认询问），但本次 prompt 临时切到 bypass
await client.session.promptAsync({
  sessionID: session.id,
  message: '请批量重命名 ./src 下所有 .ts 文件',
  permission_mode: 'bypassPermissions', // ← 仅本次 prompt 生效，不传则沿用会话级模式
});
```

---

### 方法 3：事件订阅自动回复

保持默认权限模式（`default`），订阅 SSE 事件流，每当出现 `permission.asked` 事件时调用 `permission.reply` 自动放行。适合需要审计每一次放行的场景。

```typescript
// 2. 订阅事件流
const stream = await client.event.subscribe({ directory: process.cwd() });

// 3. 发起异步 prompt（会触发工具调用 → permission.asked）
await client.session.promptAsync({
  sessionID: session.id,
  message: '请读取 ./README.md 并总结',
});

// 4. 监听并自动回复
for await (const event of stream.stream) {
  if (event.type === 'permission.asked') {
    const requestID = event.properties?.id;
    if (requestID) {
      // 自动放行（reply: 'once' 仅本次 | 'always' 永久 | 'reject' 拒绝）
      await client.permission.reply({
        requestID,
        reply: 'always',
        message: 'Auto-allowed by SDK script.',
      });
    }
  }

  // 会话结束时退出循环
  if (event.type === 'session.updated' && event.properties?.sessionID === session.id) {
    break;
  }
}
```

---

## FAQ

### Q1. 为什么settings.json配了 bypass，SDK 仍然询问权限？

**根因**：SDK 默认 **不读取** 用户 settings.json 中的权限配置。必须在启动 serve 前设置环境变量 `SDK_LOAD_SETTINGS_PERMISSIONS=true`。

**排查清单**：

1. **环境变量值是否精确等于字符串 `"true"`？**
   - ❌ `SDK_LOAD_SETTINGS_PERMISSIONS=1` → 不生效
   - ❌ `SDK_LOAD_SETTINGS_PERMISSIONS=True` → 不生效（大小写敏感）
   - ❌ `SDK_LOAD_SETTINGS_PERMISSIONS=TRUE` → 不生效
   - ✅ `SDK_LOAD_SETTINGS_PERMISSIONS=true` → 生效

2. **环境变量是否传到了 serve 子进程？**
   - 手动起 serve：在启动 `codeagent serve` 的同一 shell 中 `export` 或 `set`
   - 自动起 serve：通过 `createCodeAgentServer({ env: { ... } })` 注入

3. **settings.json 路径是否正确？**
   - 默认读取 `~/.cac/settings.json`（即 `configDir` 指向的目录）
   - 自动起 serve 时通过 `configDir` 选项指定

4. **配置字段是否正确？**

   ```json
   {
     "permissions": {
       "defaultMode": "bypassPermissions" // ← 注意大小写和驼峰
     }
   }
   ```

---

### Q2. PermissionMode 有哪些取值？各自行为是什么？

**权威定义**（`types.gen.ts:1753`）：

```typescript
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk';
```

| 取值 | 行为 |
| --- | --- |
| `default` | 允许目录内文件读操作，其他操作每次工具调用前都询问（触发 `permission.asked`） |
| `acceptEdits` | 自动允许目录内Edit/Read/Write 类工具自动放行，其他仍询问 |
| `bypassPermissions` | 所有工具调用都自动放行，不询问 |
| `dontAsk` | 不询问，不弹权限请求，无权限的操作直接跳过 |

> ⚠️ **remote 模式限制**：`bypassPermissions` 和 `dontAsk` 在 remote（`--host 0.0.0.0`）启动时会被服务端拒绝并返回 400，详见 Q5。

---

### Q3. permission.reply 的 reply 取值是什么？

```typescript
export type PermissionReplyRequest = {
  reply?: 'once' | 'always' | 'reject';
  message?: string;
};
```

| 取值 | 含义 |
| --- | --- |
| `'once'` | 仅本次放行，下次同类工具调用仍会询问 |
| `'always'` | 永久放行该工具/路径组合，后续不再询问 |
| `'reject'` | 拒绝本次工具调用 |

---

### Q4. session 和 workspace 的权限字段为什么命名不一致？

这是历史演进导致的设计差异，文档以实际接口为准：

| 对象 | 字段路径 | 结构 |
| --- | --- | --- |
| Session | `permission_mode` | 扁平 |
| Workspace | `permission_policy.mode` | 嵌套 |

**调用对比**：

```typescript
// Session：扁平
await client.session.create({
  permission_mode: 'bypassPermissions', // ← 直接字段
});

// Workspace：嵌套
await client.workspaces.create({
  permission_policy: { mode: 'bypassPermissions' }, // ← 嵌套对象
});
```

**继承关系**：session 不传 `permission_mode` 时，继承所属 workspace 的 `permission_policy.mode`。

---

### Q5. bypassPermissions 在 remote 模式下为何报 400？

**现象**：当 serve 以 `--host 0.0.0.0`（remote 模式）启动时，`session.create` 传 `permission_mode: 'bypassPermissions'` 会返回 HTTP 400。

**根因**：remote 模式下服务端禁止高风险权限模式，防止远程调用方绕过权限保护。

**规避方案**：

1. **改用 `acceptEdits`**：remote 模式下允许，对编辑类工具自动放行
2. **改用方法 3**（监听 `permission.asked` 自动回复）：remote 模式下可用
3. **改用 loopback 模式**：serve 以 `--host 127.0.0.1` 启动，`bypassPermissions` 可用

---

## 附录：类型定义速查

```typescript
// PermissionMode（types.gen.ts:1753）
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk';

// SessionCreateRequest（types.gen.ts:1844-1866）
export type SessionCreateRequest = {
  parentID?: string;
  title?: string;
  agent?: string;
  model?: { providerID: string; id: string; variant?: string };
  metadata?: { [key: string]: unknown };
  permission?: Array<{
    permission: string;
    pattern: string;
    action: 'allow' | 'deny' | 'ask';
  }>;
  permission_mode?: PermissionMode; // 扁平
  workspaceID?: string;
};

// WorkspaceCreateRequest（types.gen.ts:1998-2007）
export type WorkspaceCreateRequest = {
  cwd: string;
  additional_roots?: Array<string>;
  env?: { [key: string]: string };
  permission_policy?: { mode: PermissionMode }; // 嵌套
};

// PermissionReplyRequest（types.gen.ts:2195-2198）
export type PermissionReplyRequest = {
  reply?: 'once' | 'always' | 'reject';
  message?: string;
};

// CodeAgentLauncherOptions（launcher.ts）
export type CodeAgentLauncherOptions = {
  cwd: string;
  binaryPath?: string;
  binaryArgs?: string[];
  env?: Record<string, string | undefined>; // 可注入环境变量
  configDir: string;
  host?: string;
  port?: number;
  timeoutMs?: number;
};
```
