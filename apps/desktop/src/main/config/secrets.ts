import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { writeFileAtomic } from './atomic'

// 密钥表（phase1-implementation 2.3 节）：{userData}/secrets.json，值用系统钥匙串加密（Electron safeStorage）。
// 键：`gateway:<id>`、`mcp:<服务名>:<变量名>`。配置文件里只留占位，密钥不进 ~/.kits。
// 系统不支持加密时（Linux 没装钥匙串）退化成 base64 明文，并标出来，设置页提示。

export interface Encryptor {
  isAvailable(): boolean
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

type Stored = { enc: 'safe' | 'plain'; data: string }

function isStore(v: unknown): v is Record<string, Stored> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  return Object.values(v).every(
    (x) =>
      typeof x === 'object' &&
      x !== null &&
      ((x as Stored).enc === 'safe' || (x as Stored).enc === 'plain') &&
      typeof (x as Stored).data === 'string',
  )
}

export class SecretStore {
  private values: Record<string, Stored> = {}
  // 文件坏了或读不了时的原因；坏文件备份成 secrets.json.broken-<时间>，从空表开始，不让应用打不开
  // 保存成功后清掉
  loadError: string | undefined
  // 坏文件还没备份成功：保存前要先补上备份，补不上就不保存，免得把还能恢复的旧密钥盖掉
  private backup: string | undefined

  constructor(
    private readonly file: string,
    private readonly encryptor: Encryptor,
    now: () => number = Date.now,
  ) {
    if (!existsSync(file)) return
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (!isStore(parsed)) throw new Error('格式不对')
      this.values = parsed
    } catch (e) {
      const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-')
      this.backup = `${file}.broken-${stamp}`
      // 备份失败也不拦启动，保存时再试
      const backedUp = this.tryBackup()
      const reason = e instanceof Error ? e.message : String(e)
      this.loadError = backedUp
        ? `${file} 读取失败（${reason}），已备份，需要重新填写密钥`
        : `${file} 读取失败（${reason}），备份也没成功，原文件先留着；保存密钥前会再试一次备份`
    }
  }

  private tryBackup(): boolean {
    if (!this.backup) return true
    try {
      copyFileSync(this.file, this.backup)
      this.backup = undefined
      return true
    } catch {
      return false
    }
  }

  get encrypted(): boolean {
    return this.encryptor.isAvailable()
  }

  set(key: string, value: string): void {
    const stored: Stored = this.encryptor.isAvailable()
      ? { enc: 'safe', data: this.encryptor.encrypt(value).toString('base64') }
      : { enc: 'plain', data: Buffer.from(value, 'utf8').toString('base64') }
    this.save({ ...this.values, [key]: stored })
  }

  get(key: string): string | undefined {
    const stored = this.values[key]
    if (!stored) return undefined
    const buf = Buffer.from(stored.data, 'base64')
    try {
      return stored.enc === 'safe' ? this.encryptor.decrypt(buf) : buf.toString('utf8')
    } catch {
      // 换了机器或钥匙串被重置，解不开就当没有
      return undefined
    }
  }

  // 解不开的值不算有（换了机器或钥匙串被重置），界面据此提示重新填写
  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  remove(key: string): void {
    if (!(key in this.values)) return
    const { [key]: _, ...rest } = this.values
    this.save(rest)
  }

  // 先落盘，成功了再换内存里的表：写失败时 get / has 还是旧值，可以重试
  private save(next: Record<string, Stored>): void {
    if (!this.tryBackup()) throw new Error(`${this.file} 损坏且备份失败，先腾出磁盘空间再保存`)
    writeFileAtomic(this.file, `${JSON.stringify(next, null, 2)}\n`, 0o600)
    this.values = next
    this.loadError = undefined
  }
}
