// secrets 的键名，和 @kits/core 的 gatewaySecretKey 一致（渲染进程不能引 core 的入口）
export function gatewaySecretKey(id: string): string {
  return `gateway:${id}`
}
