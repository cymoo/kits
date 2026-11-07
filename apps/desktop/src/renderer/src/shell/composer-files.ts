// 输入框里的附件。图片和主进程 attachments/extract.ts 同一份规则：这里只是先挡一下，主进程按文件头再认一次。

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const IMAGE_NAME = /\.(png|jpe?g|gif|webp)$/i

export function isImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  return IMAGE_TYPES.has(file.type) || IMAGE_NAME.test(file.name)
}

export interface Transferred {
  files: File[]
  // 文件夹的名字。文件夹在这里也是一个 File，读内容时才报错，所以先分出来
  folders: string[]
}

// 拖进来或粘贴进来的文件
export function transferredFiles(data: Pick<DataTransfer, 'items'>): Transferred {
  const out: Transferred = { files: [], folders: [] }
  for (const item of data.items) {
    const file = item.kind === 'file' ? item.getAsFile() : null
    if (!file) continue
    if (item.webkitGetAsEntry()?.isDirectory) out.folders.push(file.name)
    else out.files.push(file)
  }
  return out
}

// 粘贴板里的文件。只有图片又有文字时按文字粘贴：Word、Excel 复制内容时会顺带一张渲染图
export function pastedFiles(data: Pick<DataTransfer, 'items' | 'getData'>): Transferred {
  const got = transferredFiles(data)
  const rendered = !got.folders.length && got.files.every(isImageFile)
  return rendered && data.getData('text/plain') ? { files: [], folders: [] } : got
}

// 第一张解不开的图片。文件头对、内容坏的图片内核会整轮报错，发之前用浏览器解一遍
export async function brokenImage(files: File[]): Promise<File | undefined> {
  for (const file of files.filter(isImageFile)) {
    try {
      const bitmap = await createImageBitmap(file)
      bitmap.close()
    } catch {
      return file
    }
  }
  return undefined
}
