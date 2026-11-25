/**
 * 管理员账户路由：POST /admin/user/create、POST /admin/user/settings
 *
 * 约定：
 * - 整组路由统一挂 adminAuth，未登录一律 401
 * - 参数校验在本层完成（复用 utils/validation 的纯函数）
 * - 业务异常（AppError）在此转成统一响应体，其余异常交给全局 onError 兜底
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import { adminAuth } from '../../middlewares/auth'
import { createAdmin, updateAdminSettings } from '../../services/admin-user.service'
import { recordSystemLog } from '../../services/system-log.service'
import type { HonoEnv } from '../../types'
import { getClientIp, getRequestPath } from '../../utils/request'
import { AppError, ErrorCode, failure, success } from '../../utils/response'
import { validateEmail, validatePassword, validateUsername } from '../../utils/validation'

export const adminUserRoutes = new Hono<HonoEnv>()

// 整组接口都要登录后才能操作
adminUserRoutes.use('*', adminAuth)

/**
 * 解析 JSON 请求体。
 * 解析失败返回 null，由调用方转成 400。
 */
async function readJsonBody(c: Context<HonoEnv>): Promise<unknown> {
  try {
    return await c.req.json<unknown>()
  } catch {
    return null
  }
}

/**
 * 判断请求体是否为 JSON 对象（排除数组与 null）。
 */
function isJsonObject(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
}

// ---------- POST /admin/user/create ----------
adminUserRoutes.post('/create', async (c) => {
  const operatorId = Number(c.get('admin').sub)
  const ip = getClientIp(c)
  const requestPath = getRequestPath(c)

  const writeLog = (level: 'INFO' | 'WARN', statusCode: number, detail: string) =>
    recordSystemLog({
      level,
      operation: '创建管理员',
      module: 'user',
      operatorId,
      ip,
      requestPath,
      statusCode,
      detail,
    })

  // 1. 解析 JSON
  const body = await readJsonBody(c)
  if (body === null) {
    await writeLog('WARN', 400, '请求体不是合法 JSON')
    return c.json(failure(ErrorCode.BAD_REQUEST, '请求体必须是合法的 JSON'), 400)
  }
  if (!isJsonObject(body)) {
    await writeLog('WARN', 400, '请求体不是 JSON 对象')
    return c.json(failure(ErrorCode.BAD_REQUEST, '请求体必须是 JSON 对象'), 400)
  }

  // 2. 字段校验
  const username = validateUsername(body.username)
  if (!username.ok) {
    await writeLog('WARN', 400, `参数校验失败: ${username.message}`)
    return c.json(failure(ErrorCode.BAD_REQUEST, username.message), 400)
  }

  const password = validatePassword(body.password)
  if (!password.ok) {
    await writeLog('WARN', 400, '参数校验失败: 密码长度不合法')
    return c.json(failure(ErrorCode.BAD_REQUEST, password.message), 400)
  }

  const email = validateEmail(body.email)
  if (!email.ok) {
    await writeLog('WARN', 400, '参数校验失败: 邮箱格式不合法')
    return c.json(failure(ErrorCode.BAD_REQUEST, email.message), 400)
  }

  // 3. 业务处理
  try {
    const result = await createAdmin({
      username: username.value,
      password: password.value,
      email: email.value,
    })
    await writeLog('INFO', 200, `管理员 ${result.username} 创建成功`)
    return c.json(success(result, '创建成功'), 200)
  } catch (error) {
    if (error instanceof AppError) {
      await writeLog('WARN', error.status, `创建管理员失败: ${error.message}`)
      return c.json(failure(error.code, error.message), error.status)
    }
    throw error
  }
})

// ---------- POST /admin/user/settings ----------
adminUserRoutes.post('/settings', async (c) => {
  const adminId = Number(c.get('admin').sub)
  const ip = getClientIp(c)
  const requestPath = getRequestPath(c)

  const writeLog = (level: 'INFO' | 'WARN', statusCode: number, detail: string) =>
    recordSystemLog({
      level,
      operation: '修改管理员资料',
      module: 'user',
      // 操作者可能已被删除（如 token 尚未过期），
      // system-log.service 会在外键冲突时降级为 operator_id 置空
      operatorId: adminId,
      ip,
      requestPath,
      statusCode,
      detail,
    })

  // 1. 解析 JSON
  const body = await readJsonBody(c)
  if (body === null) {
    await writeLog('WARN', 400, '请求体不是合法 JSON')
    return c.json(failure(ErrorCode.BAD_REQUEST, '请求体必须是合法的 JSON'), 400)
  }
  if (!isJsonObject(body)) {
    await writeLog('WARN', 400, '请求体不是 JSON 对象')
    return c.json(failure(ErrorCode.BAD_REQUEST, '请求体必须是 JSON 对象'), 400)
  }

  // 2. 部分更新：三个字段都可选，缺失即"不修改"
  const hasUsername = 'username' in body
  const hasPassword = 'password' in body
  const hasEmail = 'email' in body

  if (!hasUsername && !hasPassword && !hasEmail) {
    await writeLog('WARN', 400, '未提供任何待修改字段')
    return c.json(failure(ErrorCode.BAD_REQUEST, '至少需要提供一个要修改的字段'), 400)
  }

  const input: Parameters<typeof updateAdminSettings>[1] = {}

  if (hasUsername) {
    const username = validateUsername(body.username)
    if (!username.ok) {
      await writeLog('WARN', 400, `参数校验失败: ${username.message}`)
      return c.json(failure(ErrorCode.BAD_REQUEST, username.message), 400)
    }
    input.username = username.value
  }

  if (hasPassword) {
    const password = validatePassword(body.password)
    if (!password.ok) {
      await writeLog('WARN', 400, '参数校验失败: 密码长度不合法')
      return c.json(failure(ErrorCode.BAD_REQUEST, password.message), 400)
    }
    input.password = password.value
  }

  if (hasEmail) {
    const email = validateEmail(body.email)
    if (!email.ok) {
      await writeLog('WARN', 400, '参数校验失败: 邮箱格式不合法')
      return c.json(failure(ErrorCode.BAD_REQUEST, email.message), 400)
    }
    // 空字符串经校验后为 null，语义是"清空邮箱"
    input.email = email.value
  }

  // 3. 业务处理
  try {
    const result = await updateAdminSettings(adminId, input)
    await writeLog(
      'INFO',
      200,
      `管理员 ${result.username} 修改成功，变更字段: ${result.changedFields.join(', ') || '无'}`,
    )
    return c.json(success(result, '修改成功'), 200)
  } catch (error) {
    if (error instanceof AppError) {
      await writeLog('WARN', error.status, `修改管理员资料失败: ${error.message}`)
      return c.json(failure(error.code, error.message), error.status)
    }
    throw error
  }
})
