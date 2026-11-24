/**
 * MySQL 连接池与类型化查询助手。
 *
 * 设计要点：
 * - createPool 不会立即建立连接，MySQL 未启动时服务照样能起来，由 /health 暴露状态
 * - dateStrings: true —— DATETIME 直接以字符串返回，规避驱动时区转换的坑
 * - 所有查询走参数化语句，杜绝 SQL 注入
 */
import mysql from 'mysql2/promise'
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { env } from '../config/env'

/** 全局连接池 */
export const pool: Pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  connectionLimit: env.db.connectionLimit,
  waitForConnections: true,
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
})

/** 允许的参数化查询取值 */
export type SqlValue = string | number | bigint | boolean | Date | Buffer | Uint8Array | null

/** 执行查询并返回行数据 */
export async function query<T = RowDataPacket[]>(sql: string, params: SqlValue[] = []): Promise<T> {
  const [rows] = await pool.execute(sql, params)
  return rows as unknown as T
}

/** 执行写操作，返回受影响行数与自增主键 */
export async function execute(
  sql: string,
  params: SqlValue[] = [],
): Promise<{ affectedRows: number; insertId: number }> {
  const [result] = await pool.execute<ResultSetHeader>(sql, params)
  return { affectedRows: result.affectedRows, insertId: result.insertId }
}

/** 健康检查探活：数据库可用返回 true，不可用返回 false（不抛异常） */
export async function ping(): Promise<boolean> {
  try {
    await query<RowDataPacket[]>('SELECT 1 AS ok')
    return true
  } catch {
    return false
  }
}

/** 关闭连接池（进程退出时调用） */
export async function closePool(): Promise<void> {
  await pool.end()
}
