/**
 * 统一响应体与业务错误码。
 *
 * 约定：所有接口返回 `{ code, message, data }`，
 * 同时使用 HTTP 状态码表达传输层语义（如 401 / 403 / 429）。
 */
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ApiResponse } from '../types'

/** 业务错误码 */
export const ErrorCode = {
  /** 成功 */
  SUCCESS: 0,
  /** 参数错误 / JSON 格式错误 / 接口不存在 */
  BAD_REQUEST: 40000,
  /** 未登录或登录已过期 */
  UNAUTHORIZED: 40100,
  /** 用户名或密码错误 */
  INVALID_CREDENTIALS: 40101,
  /** 无权限 */
  FORBIDDEN: 40300,
  /** 账号已被禁用 */
  ACCOUNT_DISABLED: 40301,
  /** 尝试次数过多 */
  TOO_MANY_ATTEMPTS: 42900,
  /** 服务器内部错误 */
  INTERNAL_ERROR: 50000,
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

/** 业务码 -> HTTP 状态码 */
export const ERROR_HTTP_STATUS: Record<number, ContentfulStatusCode> = {
  [ErrorCode.SUCCESS]: 200,
  [ErrorCode.BAD_REQUEST]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.INVALID_CREDENTIALS]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.ACCOUNT_DISABLED]: 403,
  [ErrorCode.TOO_MANY_ATTEMPTS]: 429,
  [ErrorCode.INTERNAL_ERROR]: 500,
}

/** 成功响应体 */
export function success<T>(data: T | null = null, message = '成功'): ApiResponse<T> {
  return { code: ErrorCode.SUCCESS, message, data }
}

/** 失败响应体 */
export function failure(code: number, message: string, data: null = null): ApiResponse<null> {
  return { code, message, data }
}

/** 业务异常：由路由层捕获后转成对应 HTTP 状态码的响应 */
export class AppError extends Error {
  readonly code: number
  readonly status: ContentfulStatusCode

  constructor(code: number, message: string, status?: ContentfulStatusCode) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = status ?? ERROR_HTTP_STATUS[code] ?? 500
  }
}

/** 判断是否为可预期的业务异常 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}
