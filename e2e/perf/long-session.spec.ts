// 长会话的性能实测，不进 CI（pnpm -F @kits/e2e perf，先 pnpm -F @kits/desktop build）。
// 先用 mock 内核跑一轮拿到真实形状的数据，再往库里克隆成 N 轮（每轮 15 个工具、每个输出 2KB），
// 重启后测：拉快照、打开会话、在这个会话里再流式跑一轮时的帧和主线程耗时。结果打在 PERF 开头的一行里。
// 轮数用 PERF_SIZES 指定，默认 1,100,300,1000。
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron, expect, type Page, test } from '@playwright/test'

const main = path.resolve(import.meta.dirname, '../../apps/desktop/out/main/index.js')
const SIZES = (process.env.PERF_SIZES ?? '1,100,300,1000').split(',').map(Number)

function envFor(root: string) {
  const merged: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) merged[k] = v
  return Object.assign(merged, {
    KITS_CONFIG_DIR: path.join(root, 'config'),
    KITS_USER_DATA_DIR: path.join(root, 'data'),
    KITS_WORKSPACE_DIR: path.join(root, 'kits-workspace'),
    KITS_SKIP_ONBOARDING: '1',
    KITS_HIDDEN_WINDOW: '1',
    KITS_KERNEL: 'mock',
    KITS_MOCK_SCENARIO: 'streaming',
    KITS_MOCK_SPEED: '1',
  })
}

async function configure(page: Page, root: string) {
  const workdir = path.join(root, 'member-svc')
  mkdirSync(workdir, { recursive: true })
  const real = realpathSync(workdir)
  await page.evaluate(
    (dir) =>
      window.kits.settings.update({
        gateways: [
          {
            id: 'corp',
            name: '公司网关',
            baseUrl: 'http://127.0.0.1:9/v1',
            enabled: true,
            models: [{ id: 'coder-main', note: '', contextWindow: 128000, toolCall: true }],
          },
        ],
        defaultModel: 'corp/coder-main',
        workdirs: [{ path: dir, lastUsedAt: 0 }],
      }),
    real,
  )
}

type Row = Record<string, unknown>

// 把会话里已有的那一轮克隆 n-1 份放在它前面；每轮工具补到 15 个、输出补到 2KB
function seed(dbFile: string, sessionId: string, n: number) {
  const db = new DatabaseSync(dbFile)
  db.exec('PRAGMA foreign_keys = ON')
  const msgs = db
    .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at')
    .all(sessionId) as Row[]
  const prts = db.prepare('SELECT * FROM parts WHERE session_id = ?').all(sessionId) as Row[]
  const dfs = db.prepare('SELECT * FROM diffs WHERE session_id = ?').all(sessionId) as Row[]
  const insert = (table: string, row: Row) => {
    const cols = Object.keys(row)
    db.prepare(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    ).run(...(cols.map((c) => row[c]) as never[]))
  }
  const tool = prts.find((p) => p.type === 'tool') as Row
  const pad = 'x'.repeat(2000)
  const t0 = Math.min(...msgs.map((m) => Number(m.created_at))) - n * 120_000
  db.exec('BEGIN')
  for (let i = 0; i < n - 1; i++) {
    const shift = t0 + i * 120_000 - Number(msgs[0]?.created_at)
    const idMap = new Map<string, string>()
    for (const m of msgs) {
      const id = `seed${i}-${m.id}`
      idMap.set(String(m.id), id)
      insert('messages', {
        ...m,
        id,
        turn: i + 1,
        kernel_turn: null,
        created_at: Number(m.created_at) + shift,
        completed_at: m.completed_at === null ? null : Number(m.completed_at) + shift,
      })
    }
    const base = prts.map((p) => ({ ...p }))
    for (let k = 0; k < 13; k++) {
      const payload = JSON.parse(String(tool.payload))
      payload.callId = `${payload.callId}-x${k}`
      payload.output = pad
      base.push({
        ...tool,
        id: `${tool.id}-x${k}`,
        seq: -100 + k,
        payload: JSON.stringify(payload),
      })
    }
    for (const p of base) {
      const payload = JSON.parse(String(p.payload))
      if (payload.callId) payload.callId = `seed${i}-${payload.callId}`
      if (
        payload.type === 'tool' &&
        typeof payload.output === 'string' &&
        payload.output.length < 2000
      )
        payload.output = pad
      insert('parts', {
        ...p,
        id: `seed${i}-${p.id}`,
        message_id: idMap.get(String(p.message_id)),
        payload: JSON.stringify(payload),
        created_at: Number(p.created_at) + shift,
        updated_at: Number(p.updated_at) + shift,
      })
    }
    for (const d of dfs) insert('diffs', { ...d, id: `seed${i}-${d.id}`, turn: i + 1 })
  }
  // 原来那一轮排到最后
  db.prepare("UPDATE messages SET turn = ? WHERE session_id = ? AND id NOT LIKE 'seed%'").run(
    n,
    sessionId,
  )
  db.prepare("UPDATE diffs SET turn = ? WHERE session_id = ? AND id NOT LIKE 'seed%'").run(
    n,
    sessionId,
  )
  db.prepare('UPDATE sessions SET turns = ? WHERE id = ?').run(n, sessionId)
  db.exec('COMMIT')
  const count = db.prepare('SELECT count(*) AS c FROM parts WHERE session_id = ?').get(sessionId)
  db.close()
  return Number((count as Row).c)
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s[Math.min(s.length - 1, Math.floor(s.length * p))] as number) : 0
}

for (const n of SIZES) {
  test(`long session perf: ${n} turns`, async () => {
    test.setTimeout(600_000)
    const root = mkdtempSync(path.join(os.tmpdir(), 'kits-perf-'))
    const env = envFor(root)
    try {
      // 1. 跑一轮真实的
      let app = await electron.launch({ args: [main], env })
      let page = await app.firstWindow()
      await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
      await configure(page, root)
      await expect(page.getByText('member-svc').first()).toBeVisible()
      const box0 = page.getByLabel('给 Agent 发消息')
      await box0.fill('给兑换接口加幂等校验')
      await box0.press('Enter')
      await expect(page.getByTestId('session-status')).toHaveText(/已完成/, { timeout: 60_000 })
      const sessionId = decodeURIComponent(page.url().split('#/s/')[1] ?? '')
      await app.close()

      // 2. 灌数据
      const parts = n > 1 ? seed(path.join(root, 'data', 'kits.db'), sessionId, n) : 0

      // 3. 重启，测打开
      app = await electron.launch({ args: [main], env })
      page = await app.firstWindow()
      // 启动时会自动打开上次的会话，等它打开完再回首页
      await expect(page.getByTestId('session-status')).toBeVisible({ timeout: 60_000 })
      await page.getByRole('link', { name: /新会话/ }).click()
      await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible({
        timeout: 30_000,
      })
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Performance.enable')
      const KEYS = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration']
      const metrics = async () => {
        const { metrics: ms } = (await cdp.send('Performance.getMetrics')) as {
          metrics: { name: string; value: number }[]
        }
        return Object.fromEntries(
          ms.filter((m) => KEYS.includes(m.name)).map((m) => [m.name, m.value]),
        )
      }
      const diff = (a: Record<string, number>, b: Record<string, number>) =>
        Object.fromEntries(
          KEYS.map((k) => [
            k.replace('Duration', ''),
            Math.round(((b[k] ?? 0) - (a[k] ?? 0)) * 1000),
          ]),
        )

      const getMs: number[] = []
      let snapshotMB = 0
      for (let i = 0; i < 3; i++) {
        const r = await page.evaluate(async (id) => {
          const t = performance.now()
          const d = await window.kits.session.get(id)
          return { ms: performance.now() - t, bytes: JSON.stringify(d).length }
        }, sessionId)
        getMs.push(r.ms)
        snapshotMB = r.bytes / 1e6
      }

      const openMs: number[] = []
      const openCost: Record<string, number>[] = []
      for (let i = 0; i < 3; i++) {
        const before = await metrics()
        await page.evaluate(() => {
          location.hash = '#/'
        })
        await expect(page.getByRole('heading', { name: '要做什么？' })).toBeVisible()
        const ms = await page.evaluate(
          async ({ id, want }) => {
            const t = performance.now()
            location.hash = `#/s/${encodeURIComponent(id)}`
            await new Promise<void>((resolve, reject) => {
              const tick = () => {
                if (performance.now() - t > 60_000)
                  reject(
                    new Error(
                      `answers ${document.querySelectorAll('[data-testid="answer"]').length}/${want}`,
                    ),
                  )
                else if (document.querySelectorAll('[data-testid="answer"]').length >= want)
                  resolve()
                else requestAnimationFrame(tick)
              }
              tick()
            })
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
            return performance.now() - t
          },
          { id: sessionId, want: n },
        )
        openMs.push(ms)
        openCost.push(diff(before, await metrics()))
      }
      const dom = await page.evaluate(() => document.querySelectorAll('*').length)

      // 4. 在这个会话里再跑一轮，测流式时的帧
      await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>
        const frames: number[] = []
        const longs: number[] = []
        w.__perf = { frames, longs, stop: false }
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) longs.push(e.duration)
        }).observe({ type: 'longtask', buffered: false })
        let last = performance.now()
        const loop = (t: number) => {
          frames.push(t - last)
          last = t
          if (!(w.__perf as { stop: boolean }).stop) requestAnimationFrame(loop)
        }
        requestAnimationFrame(loop)
      })
      const box = page.getByLabel('给 Agent 发消息')
      await box.fill('再跑一遍')
      const started = Date.now()
      const streamBefore = await metrics()
      await box.press('Enter')
      await expect(page.getByTestId('session-status')).toHaveText(/运行中/)
      await expect(page.getByTestId('session-status')).toHaveText(/已完成/, { timeout: 120_000 })
      const wall = Date.now() - started
      const streamCost = diff(streamBefore, await metrics())
      const stream = await page.evaluate(() => {
        const p = (
          window as unknown as { __perf: { frames: number[]; longs: number[]; stop: boolean } }
        ).__perf
        p.stop = true
        return { frames: p.frames.slice(1), longs: p.longs }
      })
      const heap = await page.evaluate(
        () =>
          (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize,
      )
      const mainRss = await app.evaluate(() => process.memoryUsage().rss)
      const f = stream.frames
      const result = {
        turns: n,
        parts,
        snapshotMB: Number(snapshotMB.toFixed(1)),
        sessionGetMs: getMs.map((x) => Math.round(x)),
        openMs: openMs.map((x) => Math.round(x)),
        openCost: openCost.at(-1),
        streamCost,
        domNodes: dom,
        stream: {
          wallMs: wall,
          frames: f.length,
          fps: Number(((f.length * 1000) / f.reduce((a, b) => a + b, 0)).toFixed(1)),
          p50: Number(pct(f, 0.5).toFixed(1)),
          p95: Number(pct(f, 0.95).toFixed(1)),
          max: Math.round(Math.max(...f)),
          over50ms: f.filter((x) => x > 50).length,
          longTasks: stream.longs.length,
          longTaskTotalMs: Math.round(stream.longs.reduce((a, b) => a + b, 0)),
        },
        rendererHeapMB: Math.round(heap / 1e6),
        mainRssMB: Math.round(mainRss / 1e6),
      }
      console.log(`PERF ${JSON.stringify(result)}`)
      await app.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
