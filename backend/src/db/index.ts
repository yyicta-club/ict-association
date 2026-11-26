/**
 * MySQL 连接池与类型化查询助手。
 *
 * 设计要点：
 * - createPool 不会立即建立连接，MySQL 未启动时服务照样能起来，由 /health 暴露状态
 * - dateStrings: true —— DATETIME 直接以字符串返回，规避驱动时区转换的坑
 * - 所有查询走参数化语句，杜绝 SQL 注入
 */
import mysql from 'mysql2/promise'
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
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

/** 专用连接（需要跨多条语句保持同一会话时使用） */
export type DbConnection = PoolConnection

/** 执行查询并返回行数据 */
export async function query<T = RowDataPacket[]>(
  sql: string,
  params: SqlValue[] = [],
  connection?: DbConnection,
): Promise<T> {
  const runner = connection ?? pool
  const [rows] = await runner.execute(sql, params)
  return rows as unknown as T
}

/** 执行写操作，返回受影响行数与自增主键 */
export async function execute(
  sql: string,
  params: SqlValue[] = [],
  connection?: DbConnection,
): Promise<{ affectedRows: number; insertId: number }> {
  const runner = connection ?? pool
  const [result] = await runner.execute<ResultSetHeader>(sql, params)
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

/**
 * 借出一个专用连接。
 * 调用方必须负责 release 或 destroy，不能泄漏。
 */
export async function getConnection(): Promise<DbConnection> {
  return pool.getConnection()
}

/** 命名锁句柄 */
export type NamedLockHandle = {
  /** 锁名 */
  name: string
  /** 持有锁的连接 */
  connection: DbConnection
  /** 是否已经释放 */
  released: boolean
}

/** GET_LOCK / RELEASE_LOCK 的返回行 */
type LockRow = RowDataPacket & { acquired?: number | null; released?: number | null }

/**
 * 获取 MySQL 命名锁（GET_LOCK）。
 */
export async function acquireNamedLock(
  name: string,
  timeoutSeconds: number,
): Promise<NamedLockHandle | null> {
  const connection = await pool.getConnection()
  try {
    const [rows] = await connection.query<LockRow[]>('SELECT GET_LOCK(?, ?) AS acquired', [
      name,
      timeoutSeconds,
    ])
    const acquired = Number(rows[0]?.acquired ?? 0)
    if (acquired === 1) {
      return { name, connection, released: false }
    }
    // 0 = 等待超时；NULL = 出错（如锁名非法）
    connection.release()
    return null
  } catch (error) {
    connection.destroy()
    throw error
  }
}

/**
 * 释放命名锁（RELEASE_LOCK）并归还连接。
 */
export async function releaseNamedLock(handle: NamedLockHandle): Promise<void> {
  if (handle.released) return
  handle.released = true

  try {
    const [rows] = await handle.connection.query<LockRow[]>(
      'SELECT RELEASE_LOCK(?) AS released',
      [handle.name],
    )
    const released = Number(rows[0]?.released ?? 0)
    if (released !== 1) {
      handle.connection.destroy()
      return
    }
    handle.connection.release()
  } catch {
    handle.connection.destroy()
  }
}
