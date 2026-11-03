import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { migrate } from 'drizzle-orm/node-sqlite/migrator'

// 用 Node 内置的 node:sqlite，没有原生依赖，不用为 Electron 重编。

export type Database = ReturnType<typeof openDatabase>['db']

export function openDatabase(file: string, migrationsFolder: string) {
  const sqlite = new DatabaseSync(file)
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA foreign_keys = ON')
  const db = drizzle({ client: sqlite })
  migrate(db, { migrationsFolder })
  return {
    db,
    close() {
      sqlite.close()
    },
  }
}
