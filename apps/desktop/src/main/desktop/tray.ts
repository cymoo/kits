import path from 'node:path'
import { app, type BrowserWindow, Menu, nativeImage, Tray } from 'electron'

// 关窗收到托盘 / 菜单栏（phase1-implementation PR18）：设置里开着“关闭窗口后继续运行”时，关窗只是藏起来，
// 运行中的会话不中断；托盘菜单能重新打开窗口或退出。⌘Q / 托盘的“退出”才真正退出。

export interface BackgroundDeps {
  resources: string
  keepRunning(): boolean
  // 当前的窗口（没有就新建一个）
  window(): BrowserWindow
  // 运行中 / 等处理的会话数，托盘提示里显示
  activeCount(): number
}

let quitting = false
app.on('before-quit', () => {
  quitting = true
})

export function setupBackground(deps: BackgroundDeps) {
  let tray: Tray | undefined

  const show = () => {
    const win = deps.window()
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  const ensureTray = () => {
    if (tray) return
    // macOS 用模板图（系统按菜单栏深浅自动着色），Windows 用带底色的
    const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'
    const icon = nativeImage.createFromPath(path.join(deps.resources, 'tray', file))
    if (process.platform === 'darwin') icon.setTemplateImage(true)
    tray = new Tray(icon)
    tray.setToolTip('kits')
    const menu = () =>
      Menu.buildFromTemplate([
        { label: '打开 kits', click: show },
        {
          label:
            deps.activeCount() > 0
              ? `${deps.activeCount()} 个会话在运行或等你处理`
              : '没有运行中的会话',
          enabled: false,
        },
        { type: 'separator' },
        { label: '退出 kits', accelerator: 'CommandOrControl+Q', click: () => app.quit() },
      ])
    // 菜单在打开时现做，会话数是最新的。macOS 菜单栏点一下就出菜单；Windows 左键打开窗口、右键出菜单
    const popup = () => tray?.popUpContextMenu(menu())
    tray.on('right-click', popup)
    tray.on('click', process.platform === 'darwin' ? popup : show)
  }

  // 每个新建的窗口都挂上：关窗时设置开着就只是藏起来
  const attach = (win: BrowserWindow) => {
    win.on('close', (event) => {
      if (quitting || !deps.keepRunning()) return
      event.preventDefault()
      ensureTray()
      win.hide()
    })
  }

  return {
    attach,
    show,
    // 设置里关掉了：托盘也收起来
    sync() {
      if (!deps.keepRunning() && tray) {
        tray.destroy()
        tray = undefined
      }
    },
  }
}
