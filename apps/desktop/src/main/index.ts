import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { defaultPermissions, gatewaySecretKey, readonlyCommandPatterns } from '@kits/core'
import type { KernelName } from '@kits/core/ipc'
import { app, BrowserWindow, Notification, shell } from 'electron'
import { AgentService } from './agents/agent-service'
import { ConfigService } from './config/config-service'
import { resolveConfigDir, resolveWorkspaceDir } from './config/paths'
import { SecretStore } from './config/secrets'
import { openDatabase } from './db'
import { Notifier } from './desktop/notifier'
import { setupBackground } from './desktop/tray'
import { FileSearch } from './files/search'
import { testGateway } from './gateway/gateway-client'
import { push, registerIpc, trustedUrl } from './ipc/register'
import { kernelSettingsKey, loadAgents, loadMcp, loadSkills } from './kernel/kernel-config'
import { kernelInfo, kernelLogsDir } from './kernel/kernel-info'
import { createKernelManager } from './kernel/runtime'
import { McpService } from './mcp/mcp-service'
import { MemoryService } from './memory/memory-service'
import { createElectronPlatform } from './platform'
import { SessionService } from './sessions/session-service'
import { SessionStore } from './sessions/session-store'
import { KitsToolHost } from './tools/kits-tool-host'
import { createUpdater, updateUrl } from './updater'
import { inspectWorkdir } from './workdir/inspect'

// 主进程入口：读配置、打开数据库、注册 IPC、开窗口。会话、内核等按模块往里加。

declare const __KITS_VERSION__: string

// 开发时不设名字，userData 会落在 …/Application Support/Electron 下
app.setName('kits')

// E2E 和本地调试可以指定独立的用户数据目录，不碰真实数据。必须在 app ready 之前设置。
if (process.env.KITS_USER_DATA_DIR) {
  app.setPath('userData', process.env.KITS_USER_DATA_DIR)
}

// 把窗口叫回来。窗口开好之前是空的：启动完窗口自己会显示
let reveal = () => {}

// 同一份用户数据只开一个实例：两个实例各自缓存再写回密钥表、数据库会互相覆盖。
// 第二个实例直接退出，把已有窗口叫到前面。关窗后窗口只是藏起来，focus 对隐藏的窗口不起作用，要走 reveal
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
} else {
  app.on('second-instance', () => reveal())
}

let shutdown: (() => Promise<void>) | undefined

// IPC 传来的内核名只认这两个
function kernelName(v: unknown): KernelName {
  if (v !== 'opencode' && v !== 'codeagent') throw new Error(`不认识的内核：${String(v)}`)
  return v
}

// 家目录下的路径写成 ~/…，结尾带 /，和原型一致
function homeLabel(dir: string): string {
  const home = os.homedir()
  const shown = dir === home || dir.startsWith(home + path.sep) ? `~${dir.slice(home.length)}` : dir
  return shown.endsWith(path.sep) ? shown : `${shown}${path.sep}`
}

// 内置的技能等（打包后在 resources/builtin，开发时在 apps/desktop/resources/builtin）
function builtinFolder(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'builtin')
    : path.resolve(import.meta.dirname, '../../resources/builtin')
}

// 托盘图标等（打包后在 resources，开发时在 apps/desktop/resources）
function resourcesFolder(): string {
  return app.isPackaged
    ? process.resourcesPath
    : path.resolve(import.meta.dirname, '../../resources')
}

// 随应用带的 ripgrep（打包后在 resources/bin/ripgrep，开发时在 third_party/ripgrep/<os>-<arch>，
// 目录名和 electron-builder 的 ${os}-${arch} 一样；这个平台没有时目录不存在，放到 PATH 上也没影响）
function toolsFolder(): string {
  const osName = { darwin: 'mac', win32: 'win' }[process.platform as string] ?? process.platform
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'ripgrep')
    : path.resolve(
        import.meta.dirname,
        '../../../../third_party/ripgrep',
        `${osName}-${process.arch}`,
      )
}

function migrationsFolder(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'drizzle')
    : path.resolve(import.meta.dirname, '../../drizzle')
}

function rendererEntry(): string {
  return !app.isPackaged && process.env.ELECTRON_RENDERER_URL
    ? process.env.ELECTRON_RENDERER_URL
    : pathToFileURL(path.join(import.meta.dirname, '../renderer/index.html')).href
}

const isTrusted = trustedUrl(rendererEntry())

function createWindow(onFocus: () => void): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'kits',
    backgroundColor: '#F6F5F2',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
    },
  })
  // 窗口只显示应用自己的页面：站外链接交给系统浏览器，不在窗口里打开、不让页面跳走
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrusted(url)) event.preventDefault()
  })
  win.on('focus', onFocus)
  void win.loadURL(rendererEntry())
  return win
}

app.whenReady().then(() => {
  const platform = createElectronPlatform()
  const { db } = openDatabase(path.join(platform.userDataDir, 'kits.db'), migrationsFolder())
  const secrets = new SecretStore(
    path.join(platform.userDataDir, 'secrets.json'),
    platform.encryptor,
  )
  const tools = new KitsToolHost()
  // 设置变了要重启内核、内核启动要读设置，两边互相引用
  let onConfigChanged = () => {}
  // “关闭窗口后继续运行”关掉时收起托盘
  let onBackgroundChanged = () => {}
  // 只有进内核配置的字段变了才重启：最近目录、外观这些改了不动内核，免得新建会话时撞上重启
  let kernelInputs: string | undefined
  const config = new ConfigService({
    dir: resolveConfigDir(),
    onSettingsChanged: (settings) => {
      push('settings.changed', settings)
      onBackgroundChanged()
      const next = kernelSettingsKey(settings)
      if (next === kernelInputs) return
      kernelInputs = next
      onConfigChanged()
    },
  })
  kernelInputs = kernelSettingsKey(config.getSettings())
  const kernels = createKernelManager({
    platform,
    config,
    secrets,
    tools,
    onStatus: (status) => push('kernel.status', status),
    builtinDir: builtinFolder(),
    toolsDir: toolsFolder(),
  })
  onConfigChanged = () => kernels.configChanged()

  const files = new FileSearch()
  const lookupVar = (name: string) => secrets.get(`env:${name}`) ?? process.env[name]
  const mcp = new McpService({
    file: config.paths.mcp,
    lookupVar,
    hasVar: (name) => lookupVar(name) !== undefined,
    onChanged: () => kernels.configChanged(),
  })
  const agentService = new AgentService({
    config,
    builtinDir: builtinFolder(),
    loadMcp: () => loadMcp(config),
    onChanged: () => kernels.configChanged(),
    trash: (file) => platform.trashPath(file),
    openPath: (file) => platform.openPath(file),
  })
  const updater = createUpdater({
    isPackaged: platform.isPackaged,
    version: platform.version,
    url: () => updateUrl(config.getSettings().updateUrl),
  })
  updater.start()
  const store = new SessionStore(db)
  // 系统通知：窗口不在前台时，等确认、提问、出错、完成各发一次；点了打开那个会话
  let openSession = (_id: string) => {}
  const notifier = new Notifier({
    general: () => config.getSettings().general,
    focused: () => BrowserWindow.getFocusedWindow() !== null,
    session: (id) => store.session(id),
    show: ({ sessionId, title, body }) => {
      if (!Notification.isSupported()) return
      const n = new Notification({ title, body })
      n.on('click', () => openSession(sessionId))
      n.show()
    },
    // 程序坞角标：有几个会话在等你
    onWaitingCount: (n) => {
      if (process.platform === 'darwin') app.dock?.setBadge(n > 0 ? String(n) : '')
    },
  })
  // 上次退出时还在跑的会话标成中断
  store.markInterrupted(Date.now())
  const sessions = new SessionService({
    store,
    kernels,
    resolveAgent: (name, workdir) =>
      loadAgents(
        config,
        builtinFolder(),
        existsSync(workdir) ? realpathSync(workdir) : undefined,
      ).find((a) => a.name === name),
    loadMcp: () => loadMcp(config),
    registry: tools.registry,
    push: (channel, payload) => {
      push(channel, payload)
      notifier.observe(channel, payload)
    },
    exportsDir: path.join(platform.userDataDir, 'exports'),
    attachmentsDir: path.join(platform.userDataDir, 'attachments'),
    disabledSkills: () => config.getSettings().skillsDisabled,
    enabledSkills: (workdir) =>
      loadSkills(config, builtinFolder(), workdir)
        .skills.filter((s) => s.enabled)
        .map((s) => s.name),
  })
  const memory = new MemoryService({
    personalFile: config.paths.memory,
    sessionTitle: (id) => store.session(id)?.title,
    onPersonalCreated: () => kernels.configChanged(),
  })
  // 提问、产出交给会话服务；记忆按会话的工作目录写
  tools.setHandlers({
    ...tools.current,
    askUser: (input, ctx) => sessions.askUser(input, ctx),
    outputSchema: (ctx) => sessions.outputSchema(ctx),
    onOutput: (output, ctx) => sessions.onOutput(output, ctx),
    remember: async (input, ctx) => {
      const session = sessions.sessionFor(ctx)
      if (!session) throw new Error('找不到这次调用属于哪个会话')
      memory.add(input.scope, input.text, `session:${session.id}`, session.workdir)
    },
  })
  // 最近用过的工作目录放在最前面，最多记 10 个
  const rememberWorkdir = (dir: string) => {
    const rest = config.getSettings().workdirs.filter((w) => w.path !== dir)
    config.updateSettings({
      workdirs: [{ path: dir, lastUsedAt: Date.now() }, ...rest].slice(0, 10),
    })
  }

  registerIpc(
    {
      app: {
        checkForUpdates: () => updater.check(),
        info: () => ({
          version: platform.version,
          os: platform.os,
          electron: process.versions.electron,
          node: process.versions.node,
          configDir: config.paths.dir,
          configDirLabel: homeLabel(config.paths.dir),
          skipOnboarding: process.env.KITS_SKIP_ONBOARDING === '1',
          homeDir: os.homedir(),
          defaultWorkdir: resolveWorkspaceDir(),
          userDataDir: platform.userDataDir,
        }),
        openExternal: (url) => platform.openExternal(url),
        openPath: (target) => platform.openPath(target),
        revealPath: (target) => platform.revealPath(target),
        permissionDefaults: () => ({
          // 按模式写的规则（bash 的白名单）显示通配那一档
          tools: Object.fromEntries(
            Object.entries(defaultPermissions).map(([tool, v]) => [
              tool,
              typeof v === 'string' ? v : (v['*'] ?? 'ask'),
            ]),
          ),
          readonlyCommands: [
            ...new Set(readonlyCommandPatterns.map((p) => p.replace(/\s*\*$/, ''))),
          ],
        }),
      },
      settings: {
        get: () => config.getSettings(),
        update: (patch) => config.updateSettings(patch),
        loadError: () => config.loadError ?? secrets.loadError ?? null,
      },
      session: {
        create: async (input) => {
          // 用真实路径：macOS 的 /var 等是软链接，内核按真实路径判断目录内外
          const workdir = realpathSync(input.workdir)
          rememberWorkdir(workdir)
          return sessions.create({ ...input, workdir, kernel: kernelName(input.kernel) })
        },
        list: () => sessions.list(),
        get: (id) => sessions.get(id),
        search: (query) => sessions.search(query),
        remove: (id) => sessions.remove(id),
        rename: ({ id, title }) => sessions.rename(id, title),
        setPinned: ({ id, pinned }) => sessions.setPinned(id, pinned),
        compact: (id) => sessions.compact(id),
        prompt: ({ id, text, attachments }) => sessions.prompt(id, text, attachments),
        abort: (id) => sessions.abort(id),
        respondPermission: (input) => sessions.respondPermission(input),
        answerQuestion: (input) => sessions.answerQuestion(input),
        diffs: (id) => sessions.diffs(id),
      },
      output: {
        list: (id) => sessions.outputs(id),
        save: (input) => sessions.saveOutput(input),
        export: (input) => sessions.exportOutput(input),
      },
      mcp: {
        overview: () => mcp.overview(),
        parse: (text) => mcp.parse(text),
        add: (text) => mcp.add(text),
        remove: (name) => mcp.remove(name),
        setEnabled: ({ name, enabled }) => mcp.setEnabled(name, enabled),
        setPermission: ({ server, tool, level }) => mcp.setPermission(server, tool, level),
        test: (name) => mcp.test(name),
      },
      skills: {
        list: ({ workdir }) => {
          // 工作目录可能已经被删了：那就只列内置和个人的
          const dir = workdir && existsSync(workdir) ? realpathSync(workdir) : undefined
          const { skills, errors } = loadSkills(config, builtinFolder(), dir)
          return {
            skills: skills.map((s) => ({
              name: s.name,
              description: s.description,
              source: s.source,
              dir: s.dir,
              enabled: s.enabled,
              shadows: s.shadows,
            })),
            dirs: {
              builtin: path.join(builtinFolder(), 'skills'),
              personal: config.paths.skills,
              ...(dir ? { project: path.join(dir, '.agents', 'skills') } : {}),
            },
            errors: errors.map((e) => ({ path: e.path, message: e.message })),
          }
        },
        setEnabled: ({ name, enabled }) => {
          const off = config.getSettings().skillsDisabled.filter((n) => n !== name)
          config.updateSettings({ skillsDisabled: enabled ? off : [...off, name] })
        },
        openDir: async ({ source, workdir }) => {
          // 内置的只读，打开看看；个人、项目的没有就先建好再打开
          const dir =
            source === 'builtin'
              ? path.join(builtinFolder(), 'skills')
              : source === 'personal'
                ? config.paths.skills
                : workdir
                  ? path.join(realpathSync(workdir), '.agents', 'skills')
                  : undefined
          if (!dir) throw new Error('没有工作目录')
          if (source !== 'builtin') mkdirSync(dir, { recursive: true })
          await platform.openPath(dir)
        },
      },
      memory: {
        list: ({ scope, workdir }) => memory.list(scope, workdir),
        add: ({ scope, workdir, text }) => memory.add(scope, text, 'manual', workdir),
        update: ({ scope, workdir, index, text }) => memory.update(scope, index, text, workdir),
        remove: ({ scope, workdir, index }) => memory.remove(scope, index, workdir),
        open: async ({ scope, workdir }) => platform.openPath(memory.ensure(scope, workdir)),
      },
      files: {
        search: ({ workdir, query }) => files.search(workdir, query),
      },
      workdir: {
        inspect: (dir) => inspectWorkdir(realpathSync(dir)),
        createDefault: () => {
          const dir = resolveWorkspaceDir()
          mkdirSync(dir, { recursive: true })
          const real = realpathSync(dir)
          rememberWorkdir(real)
          return real
        },
        pick: async () => {
          const dir = await platform.pickDirectory()
          if (dir) rememberWorkdir(dir)
          return dir
        },
      },
      agents: {
        list: ({ workdir }) =>
          agentService.overview(workdir).agents.map((a) => ({
            name: a.name,
            description: a.description,
            source: a.source,
            ...(a.model ? { model: a.model } : {}),
          })),
        overview: ({ workdir }) => agentService.overview(workdir),
        save: (input) => agentService.save(input),
        remove: (ref) => agentService.remove(ref),
        preview: (input) => agentService.preview(input),
        createOutput: (ref) => agentService.createOutput(ref),
        open: (ref) => agentService.open(ref),
      },
      gateway: {
        test: ({ baseUrl, apiKey, gatewayId }) => {
          const key = apiKey ?? (gatewayId ? secrets.get(gatewaySecretKey(gatewayId)) : undefined)
          return testGateway(key ? { baseUrl, apiKey: key } : { baseUrl })
        },
      },
      kernel: {
        status: () =>
          kernelInfo({
            userDataDir: platform.userDataDir,
            resourcesPath: platform.resourcesPath,
            runtime: (id) => kernels.status(id),
            mock: process.env.KITS_KERNEL === 'mock',
          }),
        // 类型只管编译期，渲染进程传来的值要在这里挡住：它会拼进目录和可执行文件路径
        restart: (id) => kernels.requestRestart(kernelName(id)),
        openLogs: async (id) => {
          const dir = kernelLogsDir(platform.userDataDir, kernelName(id))
          mkdirSync(dir, { recursive: true })
          await platform.openPath(dir)
        },
      },
      // 网关 key、MCP 变量都经内核子进程的环境变量传进去，改了也要按新配置重启
      secrets: {
        set: ({ key, value }) => {
          secrets.set(key, value)
          kernels.configChanged()
        },
        has: (key) => secrets.has(key),
        encrypted: () => secrets.encrypted,
        remove: (key) => {
          secrets.remove(key)
          kernels.configChanged()
        },
      },
    },
    isTrusted,
  )

  // 退出时关掉内核子进程和工具服务，不留孤儿进程
  shutdown = async () => {
    await kernels.dispose()
    await tools.stop()
  }

  // 窗口回到前台时看一眼 settings.json 有没有被人改过
  const onFocus = () => void config.reloadIfChanged()
  const background = setupBackground({
    resources: resourcesFolder(),
    keepRunning: () => config.getSettings().general.keepRunning,
    window: () => BrowserWindow.getAllWindows()[0] ?? open(),
    activeCount: () =>
      store.list().filter((s) => s.status === 'running' || s.status === 'waiting').length,
  })
  const open = () => {
    const win = createWindow(onFocus)
    background.attach(win)
    return win
  }
  open()
  reveal = background.show
  onBackgroundChanged = () => background.sync()
  openSession = (id) => {
    background.show()
    push('app.navigate', `/s/${id}`)
  }

  app.on('activate', () => {
    // 关窗藏起来的：点程序坞图标再显示出来
    background.show()
  })
})

// will-quit 不等异步清理：先拦下退出，清理完再直接退出。清理期间再触发的退出也拦下，只是不重复清理。
// 用 app.exit 而不是再调 app.quit：清理很快时 quit 还处在被取消的那一轮里，会被忽略，进程就退不掉
let quitting = false
app.on('will-quit', (event) => {
  if (!shutdown) return
  event.preventDefault()
  if (quitting) return
  quitting = true
  void shutdown()
    .catch(() => {})
    .finally(() => app.exit(0))
})

// 开着“关闭窗口后继续运行”时关窗只是藏起来，走不到这里；关掉了才按平台习惯退出
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
