// 输入框的 / 和 @ 菜单往哪边开、最高多少。首页的输入框在窗口中间，向上放不下时不能顶出窗口。纯函数，有单测。

export const MENU_MAX_HEIGHT = 360
// 向上还能放下这么高就向上开，和会话页的方向保持一致；再矮才看哪边地方大
export const MENU_MIN_HEIGHT = 220

export interface MenuPlacement {
  side: 'up' | 'down'
  maxHeight: number
}

export function placeMenu(above: number, below: number): MenuPlacement {
  const up = above >= MENU_MIN_HEIGHT || above >= below
  return { side: up ? 'up' : 'down', maxHeight: Math.min(MENU_MAX_HEIGHT, up ? above : below) }
}
