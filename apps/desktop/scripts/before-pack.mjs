// electron-builder 的 beforePack 钩子：先检查 vendor/ 里的内核和 ripgrep，再从 CHANGELOG 生成这个版本的更新说明。
// Jenkins 等 CI 直接调 electron-builder 也会走这里，不用另加步骤。
import checkKernel from './check-kernel.mjs'
import { writeReleaseNotes } from './release-notes.mjs'

export default function beforePack(context) {
  checkKernel(context)
  writeReleaseNotes(context.packager.appInfo.version)
}
