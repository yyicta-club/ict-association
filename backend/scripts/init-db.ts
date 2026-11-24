/**
 * 数据库初始化脚本：执行 src/db/v1.sql 创建数据库、全部表结构与种子数据。
 *
 * 安全约定：
 * - v1.sql 开头是 DROP DATABASE IF EXISTS，会清空目标库中的全部数据
 * - 因此脚本先探测目标库是否已存在：已存在且未显式传 --force 时直接拒绝执行
 * - 数据库名不写死在 SQL 里，执行前按 env.db.database（DB_NAME）动态替换
 *
 * 用法：
 *   bun run db:init              # 首次初始化
 *   bun run db:init -- --force   # 强制重建（会清空该库全部数据）
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { env } from '../src/config/env'

/** SQL 脚本路径：backend/src/db/v1.sql */
const SQL_FILE = resolve(import.meta.dir, '../src/db/v1.sql')

/** 强制重建标记 */
const FORCE_FLAG = '--force'

/** 脚本内部的可预期错误：只输出友好文案，不输出调用栈 */
class ScriptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScriptError'
  }
}

/** 提取异常的可读信息 */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** 提取驱动 / socket 层面的错误码 */
function codeOf(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

/**
 * 连接失败时给出可操作的排查指引（MySQL 未启动 / 账号密码错误）。
 */
function describeConnectionError(error: unknown): string {
  const code = codeOf(error)
  const detail = messageOf(error)

  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ENOTFOUND') {
    return [
      `MySQL 连接失败（${code}）：${detail}`,
      '',
      '  请先启动 MySQL 服务，然后检查 backend/.env 中的连接配置:',
      `    DB_HOST=${env.db.host}`,
      `    DB_PORT=${env.db.port}`,
      `    DB_USER=${env.db.user}`,
      '    DB_PASSWORD=（请自行核对是否正确）',
    ].join('\n')
  }

  if (code === 'ER_ACCESS_DENIED_ERROR') {
    return [
      `MySQL 认证失败：${detail}`,
      '',
      '  请检查 backend/.env 中的 DB_USER / DB_PASSWORD 配置是否正确。',
    ].join('\n')
  }

  return `连接 MySQL 失败：${detail}`
}

/**
 * 将 SQL 脚本中硬编码的数据库名替换为 env.db.database（DB_NAME）。
 *
 * 只针对 CREATE/DROP DATABASE 与 USE 三类语句做替换，
 * 绝不触碰表名、列名等其它标识符；原有的反引号引用风格保持不变。
 */
function rewriteDatabaseName(sql: string, database: string): string {
  return sql
    .replace(
      /\b(CREATE|DROP)\s+DATABASE\s+(IF\s+EXISTS\s+)?`?(\w+)`?/gi,
      (match: string, keyword: string, ifExists: string | undefined, _name: string) => {
        const quoted = match.includes('`')
        const quote = quoted ? '`' : ''
        return `${keyword} DATABASE ${ifExists ?? ''}${quote}${database}${quote}`
      },
    )
    .replace(
      /\bUSE\s+`?(\w+)`?/gi,
      (match: string, _name: string) => {
        const quote = match.includes('`') ? '`' : ''
        return `USE ${quote}${database}${quote}`
      },
    )
}

async function main(): Promise<void> {
  const database = env.db.database
  const force = process.argv.includes(FORCE_FLAG)

  console.log(`[db:init] 正在读取 SQL 文件：${SQL_FILE}`)
  let rawSql: string
  try {
    rawSql = readFileSync(SQL_FILE, 'utf8')
  } catch (error) {
    throw new ScriptError(`读取 SQL 文件失败：${SQL_FILE}\n  ${messageOf(error)}`)
  }

  const sql = rewriteDatabaseName(rawSql, database)
  const tableCount = (sql.match(/CREATE\s+TABLE/gi) ?? []).length
  console.log(`[db:init] 目标数据库：${database}（共 ${tableCount} 张表待创建）`)

  let connection: Connection | null = null
  try {
    try {
      // 故意不指定 database：建库与切库都由 SQL 脚本自身完成
      connection = await mysql.createConnection({
        host: env.db.host,
        port: env.db.port,
        user: env.db.user,
        password: env.db.password,
        multipleStatements: true,
        charset: 'utf8mb4',
      })
    } catch (error) {
      throw new ScriptError(describeConnectionError(error))
    }
    console.log(`[db:init] MySQL 连接成功：${env.db.host}:${env.db.port}`)

    // 建库前先探测目标库是否已存在，避免误删数据
    // 用 query（客户端转义参数）而非 execute（服务端预处理），规避 SHOW 语句的预处理兼容性限制
    const [rows] = await connection.query<RowDataPacket[]>('SHOW DATABASES LIKE ?', [database])
    const exists = rows.length > 0

    if (exists) {
      if (!force) {
        throw new ScriptError(
          [
            `数据库 "${database}" 已存在。`,
            '',
            '  v1.sql 会先执行 DROP DATABASE，重复初始化将清空该库中的全部数据。',
            '  如确认需要重建，请执行：bun run db:init -- --force',
          ].join('\n'),
        )
      }
      console.warn(`[db:init] ⚠ 警告：数据库 "${database}" 已存在，将被强制重建，现有数据会全部丢失！`)
    } else {
      console.log(`[db:init] 数据库 "${database}" 不存在，开始创建`)
    }

    console.log('[db:init] 正在执行建表脚本 ...')
    await connection.query(sql)
    console.log(`[db:init] ✅ 初始化完成：数据库 "${database}" 已创建，${tableCount} 张表与种子数据已写入`)
  } finally {
    if (connection) {
      await connection.end()
      console.log('[db:init] 数据库连接已关闭')
    }
  }
}

try {
  await main()
} catch (error) {
  if (error instanceof ScriptError) {
    console.error(`[db:init] ❌ ${error.message}`)
  } else {
    console.error(`[db:init] ❌ 初始化失败：${messageOf(error)}`)
  }
  process.exitCode = 1
}
