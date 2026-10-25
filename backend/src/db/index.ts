import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'
import { drizzle as drizzleBetterSqlite } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'
import { initSqliteSchema, initLibsqlSchema } from './sqlite-schema.js'
import { maybeAutoImportMysql } from './mysql-import.js'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type { ResultSet } from '@libsql/client'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// src/db → 上三级为仓库根（与 utils/paths.ts 的推断层级一致）
const repoRoot = path.resolve(__dirname, '../../..')

// ─── 双 driver 分支 ─────────────────────────────────────────────
// Serverless（Vercel + Turso）：DATABASE_URL 为 libsql:/wss:/https: 时走 libSQL HTTP 驱动，
// 库文件在远端，无 WAL/pragma、无本地目录、无 MySQL 迁移。
// 其余情况维持 better-sqlite3 本地文件语义：桌面版 SQLITE_PATH（userData 下）；
// dev 默认仓库根 data/。
// 注意：勿沿用旧文件名 huobao_drama.db —— 那是早期 SQLite 时代的遗留库，表名重叠但列不同
export const dbPath = process.env.SQLITE_PATH || path.join(repoRoot, 'data', 'huobao.sqlite3')

// DATABASE_URL 优先；兼容 Vercel Storage 市场 Turso 集成自动注入的 TURSO_* 命名，
// 绑定存储后无需手动再配同名镜像变量
const databaseUrl = (process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL || '').trim()
// libsql:/wss:/https: → Turso 等远端；file: → libSQL 本地文件模式（无原生依赖，
// 供本地/CI 端到端验证 libSQL 分支，无需真实 Turso 实例）
const useLibsql = /^(libsql|wss|https?|file):/i.test(databaseUrl)

// 统一对外类型：两种 driver 的查询构建器（select/insert/update/delete + await）完全一致。
// 唯一差异是 .get()/.run() 等会话方法的同步/异步语义——代码库约定不直接使用
// （app-settings.ts 已 async 化），行数/自增 id 一律经 affectedRows/getInsertId 取（unknown 接收）
export type DB = BaseSQLiteDatabase<'async', ResultSet, typeof schema>

export let db: DB

if (useLibsql) {
  // 动态 import：@libsql/client 含平台原生包，不能进 desktop 的 esbuild bundle
  // （desktop/scripts/build-backend.mjs 已将其列入 external，桌面版永远不会走此分支）
  const [{ createClient }, { drizzle: drizzleLibsql }] = await Promise.all([
    import('@libsql/client'),
    import('drizzle-orm/libsql'),
  ])
  const client = createClient({
    url: databaseUrl,
    authToken: process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || undefined,
  })
  // 启动建表（幂等 DDL + 种子补缺）；libSQL 无连接就绪问题，首次请求自动握手
  await initLibsqlSchema(client)
  db = drizzleLibsql(client, { schema }) as unknown as DB
  console.log(`🗄️ libSQL 数据库已连接: ${databaseUrl.replace(/^[^:]+:\/\//, 'libsql://***@')}`)
} else {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  const sqlite = new Database(dbPath)

  // WAL：生成任务轮询与页面读并发时不互相阻塞；busy_timeout 兜底写锁竞争
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.pragma('synchronous = NORMAL')

  /** 启动建表（DDL 幂等重放 + 种子补缺）。SQLite 无连接就绪问题，无需重试 */
  initSqliteSchema(sqlite)

  // MySQL 老用户一次性自动迁移：仅在显式配置 MySQL + 空库 + 无标记时触发（详见 mysql-import.ts 头注释）
  await maybeAutoImportMysql(sqlite, dbPath)

  db = drizzleBetterSqlite(sqlite, { schema }) as unknown as DB
}

/** 两种 driver 的 insert 结果都带 lastInsertRowid（libSQL 可能是 bigint），统一转 number */
export function getInsertId(result: unknown) {
  const res = result as { lastInsertRowid?: number | bigint } | undefined
  if (res?.lastInsertRowid === undefined || res.lastInsertRowid === null) {
    throw new Error('SQLite insert did not return lastInsertRowid')
  }
  return Number(res.lastInsertRowid)
}

/** 双 driver 兼容的受影响行数：better-sqlite3 是 changes，libSQL 是 rowsAffected */
export function affectedRows(result: unknown): number {
  const res = result as { changes?: number; rowsAffected?: number } | undefined
  return Number(res?.changes ?? res?.rowsAffected ?? 0)
}

export { schema }
