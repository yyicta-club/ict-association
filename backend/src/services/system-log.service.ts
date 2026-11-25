/**
 * 系统日志落库（system_logs 表）。
 *
 * 安全约定：
 * - 日志写入失败绝不影响主流程，异常只打印到控制台
 * - 绝不记录密码、密码哈希与 token
 */
import { execute } from '../db'

export type SystemLogInput = {
  level: 'INFO' | 'WARN' | 'ERROR'
  /** 操作名，如 管理员登录 / 创建管理员 */
  operation: string
  /** 模块名，如 auth / user */
  module: string
  /** 操作者 admins.id；游客或系统操作为 null */
  operatorId: number | null
  ip: string
  requestPath: string
  statusCode: number
  /** 详情：参数摘要（务必脱敏，不存密码） */
  detail: string | null
}

/**
 * 判断是否为 system_logs.operator_id 的外键约束失败。
 *
 * 场景：操作者账户已被删除，但 token 尚未过期，
 * 此时写入 operator_id 会触发 ER_NO_REFERENCED_ROW_2。
 */
function isOperatorForeignKeyError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    return (error as { code?: unknown }).code === 'ER_NO_REFERENCED_ROW_2'
  }
  return false
}

/**
 * 写入一条系统日志。
 *
 * 写入失败只记录到控制台，不向上抛出，避免审计日志拖垮业务接口。
 * 外键冲突时降级为"操作者置空"再写一次，尽量保住审计记录。
 */
export async function recordSystemLog(input: SystemLogInput): Promise<void> {
  try {
    await execute(
      `INSERT INTO system_logs (level, operation, module, operator_id, ip, request_path, status_code, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.level,
        input.operation,
        input.module,
        input.operatorId,
        input.ip,
        input.requestPath,
        input.statusCode,
        input.detail,
      ],
    )
  } catch (error) {
    if (input.operatorId !== null && isOperatorForeignKeyError(error)) {
      // 操作者已不存在：置空 operator_id 再写一次，保留审计记录
      try {
        await execute(
          `INSERT INTO system_logs (level, operation, module, operator_id, ip, request_path, status_code, detail)
           VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
          [
            input.level,
            input.operation,
            input.module,
            input.ip,
            input.requestPath,
            input.statusCode,
            input.detail,
          ],
        )
        return
      } catch (fallbackError) {
        console.error('[system-logs] 写入系统日志失败（已忽略，不影响主流程）:', fallbackError)
      }
      return
    }
    console.error('[system-logs] 写入系统日志失败（已忽略，不影响主流程）:', error)
  }
}
