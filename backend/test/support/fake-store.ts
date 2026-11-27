/**
 * 假数据库句柄（测试专用）。
 *
 * 目的：让服务层与路由层的自动化测试**完全不接触任何真实数据库**，
 * 既不会连到开发库 / 业务库，也不会写脏数据。
 *
 * 约定：
 * - 记录每一次 query / execute 调用，便于断言 SQL 与参数
 * - 假连接记录事务生命周期（begin / commit / rollback / release）
 * - 查询结果由测试用例自己决定（`onQuery` 回调）
 */
import type { DbConnection, DbStore, SqlValue } from '../../src/db'

/** 记录的一次 SQL 调用 */
export type SqlCall = {
  sql: string
  params: SqlValue[]
  /** 是否在事务连接上执行 */
  inTransaction: boolean
}

/** 假连接：只记录事务生命周期，不做任何真实数据库操作 */
export class FakeConnection {
  /** 是否已开启事务 */
  begun = false
  /** 是否已提交 */
  committed = false
  /** 是否已回滚 */
  rolledBack = false
  /** 是否已归还 */
  released = false

  async beginTransaction(): Promise<void> {
    this.begun = true
  }

  async commit(): Promise<void> {
    this.committed = true
  }

  async rollback(): Promise<void> {
    this.rolledBack = true
  }

  release(): void {
    this.released = true
  }
}

/** 假句柄的可配置项 */
export type FakeStoreOptions = {
  /** 查询结果回调：按 SQL 与参数返回行数据 */
  onQuery?: (sql: string, params: SqlValue[]) => unknown[] | Promise<unknown[]>
  /** 写操作结果回调 */
  onExecute?: (
    sql: string,
    params: SqlValue[],
  ) => { affectedRows: number; insertId: number } | Promise<{ affectedRows: number; insertId: number }>
  /** 查询时抛出的错误（用于验证回滚分支） */
  queryError?: Error
  /** 写操作时抛出的错误（用于验证回滚分支） */
  executeError?: Error
}

/** 假数据库句柄 */
export type FakeStore = DbStore & {
  /** 全部调用记录 */
  calls: SqlCall[]
  /** 查询调用记录 */
  queries: SqlCall[]
  /** 写操作调用记录 */
  executes: SqlCall[]
  /** 假连接 */
  connection: FakeConnection
}

/** 创建一个假数据库句柄 */
export function createFakeStore(options: FakeStoreOptions = {}): FakeStore {
  const calls: SqlCall[] = []
  const queries: SqlCall[] = []
  const executes: SqlCall[] = []
  const connection = new FakeConnection()

  const store: FakeStore = {
    calls,
    queries,
    executes,
    connection,

    async query<T>(sql: string, params: SqlValue[] = [], conn?: DbConnection): Promise<T> {
      const call: SqlCall = { sql, params, inTransaction: conn !== undefined }
      calls.push(call)
      queries.push(call)
      if (options.queryError) throw options.queryError
      const rows = options.onQuery ? await options.onQuery(sql, params) : []
      return rows as T
    },

    async execute(
      sql: string,
      params: SqlValue[] = [],
      conn?: DbConnection,
    ): Promise<{ affectedRows: number; insertId: number }> {
      const call: SqlCall = { sql, params, inTransaction: conn !== undefined }
      calls.push(call)
      executes.push(call)
      if (options.executeError) throw options.executeError
      return options.onExecute
        ? await options.onExecute(sql, params)
        : { affectedRows: 1, insertId: 0 }
    },

    async getConnection(): Promise<DbConnection> {
      return connection as unknown as DbConnection
    },
  }

  return store
}

/** 判断 SQL 是否命中某个片段 */
export function sqlHas(sql: string, fragment: string): boolean {
  return sql.includes(fragment)
}
