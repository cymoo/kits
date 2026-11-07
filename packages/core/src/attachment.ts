// 能交给系统应用打开的附件。脚本和网页不算：Windows 上 .js 这类文件打开就执行了，这些只在文件夹里选中
const OPENABLE =
  /\.(docx|pdf|md|markdown|txt|log|csv|tsv|json|jsonl|yaml|yml|xml|png|jpe?g|gif|webp)$/i

export function canOpenAttachment(name: string): boolean {
  return OPENABLE.test(name)
}
