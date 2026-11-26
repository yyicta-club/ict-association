/**
 * 查询参数校验（纯函数，无副作用）。
 *
 * 约定：
 * - 参数缺省时返回默认值；提供了但非法时返回失败，由调用方转成 400
 * - 所有取值都必须是"服务端固定枚举 + 整数"，杜绝拼接进 SQL 的字符串
 */
import { AppError, ErrorCode } from './response'

/**
 * 校验正整数参数。
 *
 * 约定：参数**缺省**时返回默认值；参数**存在**（含空串）时必须合法，否则 400。
 *
 * @param raw 原始查询参数（undefined 表示未提供）
 * @param fallback 未提供时的默认值
 * @param name 参数名（用于报错文案）
 */
export function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined) return fallback
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new AppError(ErrorCode.BAD_REQUEST, `${name} 必须是正整数`)
  }
  const value = Number(trimmed)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppError(ErrorCode.BAD_REQUEST, `${name} 必须是正整数`)
  }
  return value
}

/**
 * 校验枚举参数。
 *
 * 约定：参数**缺省**时返回默认值；参数**存在**（含空串）时必须落在枚举内，否则 400。
 *
 * @param raw 原始查询参数（undefined 表示未提供）
 * @param allowed 允许的取值枚举
 * @param fallback 未提供时的默认值
 * @param name 参数名（用于报错文案）
 */
export function parseEnum<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
  name: string,
): T {
  if (raw === undefined) return fallback
  const value = raw.trim() as T
  if (!allowed.includes(value)) {
    throw new AppError(ErrorCode.BAD_REQUEST, `${name} 只能是 ${allowed.join(' / ')}`)
  }
  return value
}
