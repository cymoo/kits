import { existsSync, readFileSync } from 'node:fs'
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

export class SecretStore {
  private values: Record<string, Stored>

  constructor(
    private readonly file: string,
    private readonly encryptor: Encryptor,
  ) {
    this.values = existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, Stored>)
      : {}
  }

  get encrypted(): boolean {
    return this.encryptor.isAvailable()
  }

  set(key: string, value: string): void {
    this.values[key] = this.encryptor.isAvailable()
      ? { enc: 'safe', data: this.encryptor.encrypt(value).toString('base64') }
      : { enc: 'plain', data: Buffer.from(value, 'utf8').toString('base64') }
    this.save()
  }

  get(key: string): string | undefined {
    const stored = this.values[key]
    if (!stored) return undefined
    const buf = Buffer.from(stored.data, 'base64')
    return stored.enc === 'safe' ? this.encryptor.decrypt(buf) : buf.toString('utf8')
  }

  has(key: string): boolean {
    return key in this.values
  }

  remove(key: string): void {
    if (!(key in this.values)) return
    delete this.values[key]
    this.save()
  }

  private save(): void {
    writeFileAtomic(this.file, `${JSON.stringify(this.values, null, 2)}\n`)
  }
}
