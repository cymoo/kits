// 输入框里的图片附件。和主进程 attachments/extract.ts 同一份规则：这里只是先挡一下，主进程按文件头再认一次。

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const IMAGE_NAME = /\.(png|jpe?g|gif|webp)$/i

export function isImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  return IMAGE_TYPES.has(file.type) || IMAGE_NAME.test(file.name)
}

// 粘贴板里的图片。同时有文字时按文字粘贴：Word、Excel 复制内容时会顺带一张渲染图
export function pastedImages(data: Pick<DataTransfer, 'files' | 'getData'>): File[] {
  if (data.getData('text/plain')) return []
  return [...data.files].filter(isImageFile)
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
