/**
 * 管理员账户业务逻辑：创建新账户 + 修改当前登录管理员自己的账户。
 *
 * 安全约定：
 * - 密码只经 hashPassword 生成哈希后入库，明文绝不落库、不入日志、不回传
 * - 查重与唯一索引双层防御：先查重给出友好提示，再用 ER_DUP_ENTRY 兜底并发冲突
 * - 查重走数据库比较，排序规则 utf8mb4_0900_ai_ci 大小写不敏感，Admin 与 admin 视为冲突
 */
import { execute, query } from '../db'
import type { AdminRow } from '../types'
import { hashPassword } from '../utils/password'
import { AppError, ErrorCode } from '../utils/response'

/** 创建管理员的输入（已完成格式校验） */
export type CreateAdminInput = {
  username: string
  password: string
  /** null 表示不填写邮箱 */
  email: string | null
}

/** 创建结果：只回传公开字段，绝不含密码哈希 */
export type CreateAdminResult = {
  id: number
  username: string
  email: string | null
}

/** 修改管理员设置的输入：字段为 undefined 表示"不修改该字段" */
export type UpdateAdminInput = {
  username?: string
  password?: string
  /** null 表示清空邮箱；undefined 表示不修改 */
  email?: string | null
}

/** 修改结果 */
export type UpdateAdminResult = {
  id: number
  username: string
  email: string | null
  /** 本次实际发生变更的字段，便于前端提示与日志记录 */
  changedFields: string[]
}

/**
 * 更新计划：只包含真正发生变化的字段。
 * 由纯函数 buildAdminUpdatePlan 生成，便于直接单测。
 */
export type AdminUpdatePlan = {
  /** UPDATE 的 SET 子句（不含 updated_at） */
  sets: string[]
  /** 与 sets 一一对应的参数值 */
  values: (string | null)[]
  /** 发生变化的字段名 */
  changedFields: string[]
}

/**
 * 纯函数：比对当前值与待更新值，生成只包含变化字段的更新计划。
 *
 * 规则：
 * - 字段值为 undefined -> 不修改该字段
 * - 字段值与当前值相同 -> 不修改该字段（避免无谓写库）
 * - email 传 null 或空串 -> 清空邮箱（写 NULL）
 */
export function buildAdminUpdatePlan(
  current: { username: string; email: string | null },
  input: { username?: string; email?: string | null },
): AdminUpdatePlan {
  const sets: string[] = []
  const values: (string | null)[] = []
  const changedFields: string[] = []

  if (input.username !== undefined && input.username !== current.username) {
    sets.push('username = ?')
    values.push(input.username)
    changedFields.push('username')
  }

  if (input.email !== undefined && input.email !== current.email) {
    sets.push('email = ?')
    values.push(input.email)
    changedFields.push('email')
  }

  return { sets, values, changedFields }
}

/**
 * 判断是否 MySQL 唯一索引冲突。
 * mysql2 的错误对象上带有 code 属性。
 */
function isDuplicateEntryError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    return (error as { code?: unknown }).code === 'ER_DUP_ENTRY'
  }
  return false
}

/**
 * 把驱动层的唯一索引冲突翻译成友好业务错误。
 * 非冲突错误原样抛出，交给全局 onError 兜底 500。
 */
function translateDuplicateError(error: unknown): never {
  if (!isDuplicateEntryError(error)) {
    throw error
  }
  const detail = error instanceof Error ? error.message : String(error)
  // MySQL 的报错信息里会带上冲突的索引名
  if (detail.includes('uk_email')) {
    throw new AppError(ErrorCode.EMAIL_EXISTS, '邮箱已被占用')
  }
  throw new AppError(ErrorCode.USERNAME_EXISTS, '账户名已存在')
}

/**
 * 按账户名查询管理员 id；excludeId 用于修改场景排除自身。
 */
async function findIdByUsername(username: string, excludeId?: number): Promise<number | null> {
  const rows = await query<Pick<AdminRow, 'id'>[]>(
    excludeId === undefined
      ? 'SELECT id FROM admins WHERE username = ? LIMIT 1'
      : 'SELECT id FROM admins WHERE username = ? AND id <> ? LIMIT 1',
    excludeId === undefined ? [username] : [username, excludeId],
  )
  return rows[0]?.id ?? null
}

/**
 * 按邮箱查询管理员 id；excludeId 用于修改场景排除自身。
 */
async function findIdByEmail(email: string, excludeId?: number): Promise<number | null> {
  const rows = await query<Pick<AdminRow, 'id'>[]>(
    excludeId === undefined
      ? 'SELECT id FROM admins WHERE email = ? LIMIT 1'
      : 'SELECT id FROM admins WHERE email = ? AND id <> ? LIMIT 1',
    excludeId === undefined ? [email] : [email, excludeId],
  )
  return rows[0]?.id ?? null
}

/**
 * 创建管理员账户。
 * 失败时抛出 AppError（业务码 + HTTP 状态码），由路由层统一转成响应。
 */
export async function createAdmin(input: CreateAdminInput): Promise<CreateAdminResult> {
  // 1. 账户名查重
  if ((await findIdByUsername(input.username)) !== null) {
    throw new AppError(ErrorCode.USERNAME_EXISTS, '账户名已存在')
  }

  // 2. 邮箱查重（邮箱可选，非空才查）
  if (input.email !== null && (await findIdByEmail(input.email)) !== null) {
    throw new AppError(ErrorCode.EMAIL_EXISTS, '邮箱已被占用')
  }

  // 3. 生成密码哈希
  const passwordHash = await hashPassword(input.password)

  // 4. 落库
  try {
    const result = await execute(
      'INSERT INTO admins (username, password_hash, email, status) VALUES (?, ?, ?, 1)',
      [input.username, passwordHash, input.email],
    )
    return {
      id: result.insertId,
      username: input.username,
      email: input.email,
    }
  } catch (error) {
    // 并发写入时唯一索引会先于查重生效，这里兜底翻译
    translateDuplicateError(error)
  }
}

/**
 * 修改当前登录管理员自己的账户（账户名 / 密码 / 邮箱，支持部分更新）。
 *
 * - 只更新实际发生变化的字段，未变化的字段不进 SET 子句
 * - 改账户名不改 id，当前 token 仍然有效
 */
export async function updateAdminSettings(
  adminId: number,
  input: UpdateAdminInput,
): Promise<UpdateAdminResult> {
  // 1. 读取当前记录
  const rows = await query<AdminRow[]>(
    `SELECT id, username, password_hash, nickname, email, status, last_login_at, created_at, updated_at
       FROM admins
      WHERE id = ?
      LIMIT 1`,
    [adminId],
  )
  const current = rows[0]
  if (!current) {
    throw new AppError(ErrorCode.ADMIN_NOT_FOUND, '管理员不存在')
  }

  // 2. 纯函数计算变更字段（未变化的字段不进 SET 子句）
  const plan = buildAdminUpdatePlan(current, input)

  // 3. 变更字段的查重（排除自身）
  if (plan.changedFields.includes('username') && input.username !== undefined) {
    if ((await findIdByUsername(input.username, adminId)) !== null) {
      throw new AppError(ErrorCode.USERNAME_EXISTS, '账户名已存在')
    }
  }
  if (plan.changedFields.includes('email') && input.email) {
    if ((await findIdByEmail(input.email, adminId)) !== null) {
      throw new AppError(ErrorCode.EMAIL_EXISTS, '邮箱已被占用')
    }
  }

  // 4. 密码变更：无法与当前值比较（存的是哈希），只要传了就更新
  const sets = [...plan.sets]
  const values = [...plan.values]
  const changedFields = [...plan.changedFields]
  if (input.password !== undefined) {
    sets.push('password_hash = ?')
    values.push(await hashPassword(input.password))
    changedFields.push('password')
  }

  // 5. 没有任何变化：直接回显当前资料，不产生写操作
  if (sets.length === 0) {
    return {
      id: current.id,
      username: current.username,
      email: current.email,
      changedFields: [],
    }
  }

  // 6. 落库
  sets.push('updated_at = NOW()')
  try {
    await execute(`UPDATE admins SET ${sets.join(', ')} WHERE id = ?`, [...values, adminId])
  } catch (error) {
    translateDuplicateError(error)
  }

  // 7. 回读最新资料（数据库为准，避免大小写等归一化差异）
  const updated = await query<Pick<AdminRow, 'id' | 'username' | 'email'>[]>(
    'SELECT id, username, email FROM admins WHERE id = ? LIMIT 1',
    [adminId],
  )

  return {
    id: updated[0]?.id ?? current.id,
    username: updated[0]?.username ?? current.username,
    email: updated[0]?.email ?? current.email,
    changedFields,
  }
}
