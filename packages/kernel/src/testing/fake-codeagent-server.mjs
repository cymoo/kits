#!/usr/bin/env node
// 按 docs/references/codeagent-sdk.md 写的假 CodeAgent 服务（契约测试用，phase1-implementation 4.3 节）。
// 只做 kits 用到的那几样：就绪行、Bearer、/api/v1 前缀、/global/config、会话、prompt_async、SSE 事件、
// 权限请求和回复、abort。不调模型：每次 prompt 先要求跑一条命令，回复后说一句话、发 prompt.completed。
// 文本里带“重试”时先发一次 session.next.retried。GET /api/v1/__state 给测试看收到了什么。
import { createServer } from 'node:http'

const args = process.argv.slice(2)
const arg = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const token = arg('--token') ?? 'fake-token'
const state = { config: {}, patched: 0, prompts: [], replies: [], aborted: [] }
const streams = new Set()
const sessions = new Map()
const pending = new Map()
let seq = 0
const next = (p) => `${p}_${++seq}`

const send = (type, properties) => {
  for (const res of streams) res.write(`data: ${JSON.stringify({ type, properties })}\n\n`)
}
const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(body === undefined ? '' : JSON.stringify(body))
}
const readBody = async (req) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const text = Buffer.concat(chunks).toString()
  return text ? JSON.parse(text) : {}
}

function finishPrompt(sessionID, run) {
  const textId = next('prt')
  const text = '命令跑完了，结果是 hi。'
  send('message.part.updated', {
    sessionID,
    part: { id: textId, messageID: run.messageID, sessionID, type: 'text', text: '' },
  })
  send('message.part.delta', {
    sessionID,
    messageID: run.messageID,
    partID: textId,
    field: 'text',
    delta: text,
  })
  const now = Date.now()
  const info = {
    id: run.messageID,
    sessionID,
    role: 'assistant',
    time: { created: run.started, completed: now },
    tokens: { input: 120, output: 8, cache: { read: 0, write: 0 } },
    cost: 0,
  }
  run.parts.push({ id: textId, messageID: run.messageID, sessionID, type: 'text', text })
  sessions.get(sessionID).messages.push({ info, parts: run.parts })
  send('message.updated', { sessionID, info })
  send('prompt.completed', { sessionID, status: 'completed', result_message_id: run.messageID })
  send('session.idle', { sessionID })
}

async function startPrompt(sessionID, body) {
  const text = (body.parts ?? []).map((p) => p.text ?? '').join('')
  state.prompts.push({ sessionID, text, system: body.system, agent: body.agent, model: body.model })
  const messageID = next('msg')
  const run = { messageID, started: Date.now(), parts: [] }
  sessions.get(sessionID).run = run
  send('session.status', { sessionID, status: { type: 'busy' } })
  send('message.updated', {
    sessionID,
    info: { id: messageID, sessionID, role: 'assistant', time: { created: run.started } },
  })
  if (text.includes('重试')) {
    send('session.next.retried', {
      sessionID,
      attempt: 1,
      error: { name: 'APIError', data: { message: 'gateway 503' } },
      next: Date.now() + 1000,
    })
  }
  const callID = next('call')
  const tool = { id: next('prt'), messageID, sessionID, type: 'tool', callID, tool: 'bash' }
  send('message.part.updated', {
    sessionID,
    part: { ...tool, state: { status: 'running', input: { command: 'echo hi' } } },
  })
  const id = next('per')
  pending.set(id, { sessionID, callID, tool })
  // 文档里的事件名是 permission.requested（permission.asked 是别名）
  send('permission.requested', {
    id,
    sessionID,
    permission: 'bash',
    patterns: ['echo hi'],
    metadata: { command: 'echo hi' },
    always: ['echo *'],
    tool: { messageID, callID },
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const auth =
    req.headers.authorization === `Bearer ${token}` ||
    url.searchParams.get('access_token') === token
  if (!auth) return json(res, 401, { error: 'unauthorized' })
  if (!url.pathname.startsWith('/api/v1/')) return json(res, 404, { error: 'not found' })
  const route = url.pathname.slice('/api/v1'.length)
  const m = (re) => re.exec(route)
  try {
    if (route === '/global/health') return json(res, 200, { healthy: true, version: 'fake' })
    if (route === '/__state') return json(res, 200, state)
    if (route === '/global/config') {
      if (req.method === 'PATCH') {
        state.config = { ...state.config, ...(await readBody(req)) }
        state.patched += 1
      }
      return json(res, 200, state.config)
    }
    if (route === '/event') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      res.write(`data: ${JSON.stringify({ type: 'server.connected', properties: {} })}\n\n`)
      streams.add(res)
      req.on('close', () => streams.delete(res))
      return
    }
    if (route === '/session' && req.method === 'POST') {
      const body = await readBody(req)
      const id = next('ses')
      sessions.set(id, { id, title: body.title ?? '', permission: body.permission, messages: [] })
      send('session.created', { sessionID: id, info: { id } })
      return json(res, 200, { id, title: body.title ?? '' })
    }
    if (route === '/session/status') return json(res, 200, {})
    if (route === '/permission' && req.method === 'GET') {
      return json(
        res,
        200,
        [...pending].map(([id, p]) => ({
          id,
          sessionID: p.sessionID,
          permission: 'bash',
          patterns: ['echo hi'],
          status: 'pending',
        })),
      )
    }
    let hit = m(/^\/permission\/([^/]+)\/reply$/)
    if (hit && req.method === 'POST') {
      const body = await readBody(req)
      const p = pending.get(hit[1])
      if (!p) return json(res, 404, { error: 'no such request' })
      pending.delete(hit[1])
      state.replies.push({ id: hit[1], ...body })
      send('permission.replied', { sessionID: p.sessionID, requestID: hit[1], reply: body.reply })
      const run = sessions.get(p.sessionID).run
      const done =
        body.reply === 'reject'
          ? { status: 'error', input: { command: 'echo hi' }, error: 'rejected' }
          : {
              status: 'completed',
              input: { command: 'echo hi' },
              output: 'hi\n',
              metadata: { exit: 0 },
            }
      const part = { ...p.tool, state: done }
      run.parts.push(part)
      send('message.part.updated', { sessionID: p.sessionID, part })
      setTimeout(() => finishPrompt(p.sessionID, run), 20)
      return json(res, 200, true)
    }
    hit = m(/^\/session\/([^/]+)\/prompt_async$/)
    if (hit && req.method === 'POST') {
      if (!sessions.has(hit[1])) return json(res, 404, { error: 'no such session' })
      const body = await readBody(req)
      json(res, 204)
      setTimeout(() => void startPrompt(hit[1], body), 20)
      return
    }
    hit = m(/^\/session\/([^/]+)\/abort$/)
    if (hit && req.method === 'POST') {
      state.aborted.push(hit[1])
      for (const [id, p] of pending) {
        if (p.sessionID === hit[1]) {
          pending.delete(id)
          send('permission.cancelled', { sessionID: hit[1], requestID: id, reason: 'aborted' })
        }
      }
      send('prompt.failed', {
        sessionID: hit[1],
        status: 'failed',
        error: { name: 'MessageAbortedError' },
      })
      send('session.idle', { sessionID: hit[1] })
      return json(res, 200, true)
    }
    hit = m(/^\/session\/([^/]+)\/message$/)
    if (hit) return json(res, 200, sessions.get(hit[1])?.messages ?? [])
    hit = m(/^\/session\/([^/]+)\/diff$/)
    if (hit) return json(res, 200, [])
    return json(res, 404, { error: `no route ${req.method} ${route}` })
  } catch (e) {
    return json(res, 500, { error: String(e) })
  }
})

server.listen(Number(arg('--port') ?? 0), arg('--host') ?? '127.0.0.1', () => {
  const { port } = server.address()
  // 就绪行：stdout 一行 JSON
  process.stdout.write(`starting fake codeagent\n`)
  process.stdout.write(
    `${JSON.stringify({ type: 'codeagent.server.ready', base_url: `http://127.0.0.1:${port}`, auth: { token }, version: 'fake' })}\n`,
  )
})
process.on('SIGTERM', () => process.exit(0))
