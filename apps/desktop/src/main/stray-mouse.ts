// E2E 的透明窗口：setIgnoreMouseEvents 只挡点击，真实光标经过时 macOS 上还会漏进 mouseLeave 和不带按键的 mouseMove。
// Chromium 见到不带按键的鼠标事件就认为按键松开了，释放 pointer capture，Playwright 正在做的拖动中途断掉。
// 真实事件和测试注入的事件走同一条路，分不出来源，只挡能确定不是测试发的：
// mouseLeave 测试不发；按键按着时，测试发的 mouseMove 都带按键。
// 没按键时的真实 mouseMove 挡不了，测试自己的悬停也长这样。

export interface MouseInput {
  type: string
  button?: string
}

// 返回判断函数：true 表示这个事件要挡掉。按键状态记在闭包里，一个窗口用一个
export function createStrayMouseFilter(): (mouse: MouseInput) => boolean {
  let held = false
  return (mouse) => {
    if (mouse.type === 'mouseDown') held = true
    if (mouse.type === 'mouseUp') held = false
    if (mouse.type === 'mouseLeave') return true
    return held && mouse.type === 'mouseMove' && (mouse.button ?? 'none') === 'none'
  }
}
