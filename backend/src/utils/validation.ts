/**
 * 账户相关字段的纯校验函数（无副作用，便于单测）。
 *
 * 约定：
 * - 返回值统一为 Result 形式：成功带 value，失败带可直接展示给用户的中文文案
 * - 长度上限与 admins 表结构对齐，避免写入时才发现超长
 */

/** 用户名最大长度，对齐 admins.username VARCHAR(50) */
export const USERNAME_MAX_LENGTH = 50

/** 密码最小长度，与 scripts/seed-admin.ts 的 MIN_PASSWORD_LENGTH 保持一致 */
export const PASSWORD_MIN_LENGTH = 8

/** 密码最大长度，限制超长输入拖垮 argon2 哈希 */
export const PASSWORD_MAX_LENGTH = 128

/** 邮箱最大长度，对齐 admins.email VARCHAR(255) */
export const EMAIL_MAX_LENGTH = 255

/** 用户名字符集：字母、数字、下划线、中划线、点 */
const USERNAME_PATTERN = /^[A-Za-z0-9_.-]+$/

/** 邮箱格式：本地部分@域名，域名至少包含一级点号后缀 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** 校验结果 */
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string }

/**
 * 校验并归一化用户名。
 * 去除首尾空白；仅允许字母、数字、下划线、中划线与点。
 */
export function validateUsername(raw: unknown): ValidationResult<string> {
  if (raw === undefined || raw === null) {
    return { ok: false, message: '用户名不能为空' }
  }
  if (typeof raw !== 'string') {
    return { ok: false, message: '用户名必须是字符串' }
  }
  const value = raw.trim()
  if (value === '') {
    return { ok: false, message: '用户名不能为空' }
  }
  if (value.length > USERNAME_MAX_LENGTH) {
    return { ok: false, message: `用户名长度不能超过 ${USERNAME_MAX_LENGTH} 位` }
  }
  if (!USERNAME_PATTERN.test(value)) {
    return { ok: false, message: '用户名只能包含字母、数字、下划线、中划线和点' }
  }
  return { ok: true, value }
}

/**
 * 校验密码。
 * 密码不做 trim（首尾空格也属于密码内容），只校验长度。
 */
export function validatePassword(raw: unknown): ValidationResult<string> {
  if (raw === undefined || raw === null) {
    return { ok: false, message: '密码不能为空' }
  }
  if (typeof raw !== 'string') {
    return { ok: false, message: '密码必须是字符串' }
  }
  if (raw.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `密码至少 ${PASSWORD_MIN_LENGTH} 位` }
  }
  if (raw.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, message: `密码长度不能超过 ${PASSWORD_MAX_LENGTH} 位` }
  }
  return { ok: true, value: raw }
}

/**
 * 校验并归一化邮箱。
 *
 * - undefined / null / 空串 -> null（创建时视为未填写；修改时视为清空邮箱）
 * - 非法格式 -> 失败
 */
export function validateEmail(raw: unknown): ValidationResult<string | null> {
  if (raw === undefined || raw === null) {
    return { ok: true, value: null }
  }
  if (typeof raw !== 'string') {
    return { ok: false, message: '邮箱必须是字符串' }
  }
  const value = raw.trim()
  if (value === '') {
    return { ok: true, value: null }
  }
  if (value.length > EMAIL_MAX_LENGTH) {
    return { ok: false, message: `邮箱长度不能超过 ${EMAIL_MAX_LENGTH} 位` }
  }
  if (!EMAIL_PATTERN.test(value)) {
    return { ok: false, message: '邮箱格式不正确' }
  }
  return { ok: true, value }
}
