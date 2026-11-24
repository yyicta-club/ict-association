/**
 * 管理员登录业务逻辑 + 登录日志落库。
 *
 * 安全约定：
 * - 用户名不存在时执行一次假哈希校验，抹平耗时差异，防止用户名枚举
 * - 用户名不存在 与 密码错误 返回完全相同的业务码与文案
 * - 日志中绝不记录密码与 token
 */
import { env } from '../config/env'
import { execute, query } from '../db'
import type { AdminPublic, AdminRow } from '../types'
import { signAdminToken } from '../utils/jwt'
import { dummyVerify, verifyPassword } from '../utils/password'
import { AppError, ErrorCode } from '../utils/response'

export type LoginInput = {
  username: string
  password: string
}

export type LoginResult = {
  token: string
  /** token 有效期（秒） */
  expiresIn: number
  admin: AdminPublic
}

export type LoginLogInput = {
  level: 'INFO' | 'WARN' | 'ERROR'
  operation: string
  module: string
  operatorId: number | null
  ip: string
  requestPath: string
  statusCode: number
  detail: string | null
}

/**
 * 执行登录。
 * 失败时抛出 AppError（业务码 + HTTP 状态码），由路由层统一转成响应。
 */
export async function performLogin(input: LoginInput): Promise<LoginResult> {
  const rows = await query<AdminRow[]>(
    `SELECT id, username, password_hash, nickname, email, status, last_login_at, created_at, updated_at
       FROM admins
      WHERE username = ?
      LIMIT 1`,
    [input.username],
  )
  const admin = rows[0]

  // 用户不存在：执行等价的假校验，抹平响应时间差异
  if (!admin) {
    await dummyVerify(input.password)
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, '用户名或密码错误')
  }

  const matched = await verifyPassword(input.password, admin.password_hash)
  if (!matched) {
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, '用户名或密码错误')
  }

  if (admin.status !== 1) {
    throw new AppError(ErrorCode.ACCOUNT_DISABLED, '账号已被禁用，请联系系统管理员')
  }

  await execute('UPDATE admins SET last_login_at = NOW() WHERE id = ?', [admin.id])

  const { token, expiresIn } = await signAdminToken(admin, env.jwtSecret, env.jwtExpiresIn)

  return {
    token,
    expiresIn,
    admin: {
      id: admin.id,
      username: admin.username,
      nickname: admin.nickname,
      email: admin.email,
    },
  }
}

/**
 * 写入登录日志。
 * 日志写入失败绝不影响登录结果，异常只打印到控制台。
 */
export async function recordLoginLog(input: LoginLogInput): Promise<void> {
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
    console.error('[system-logs] 写入登录日志失败（已忽略，不影响登录结果）:', error)
  }
}
