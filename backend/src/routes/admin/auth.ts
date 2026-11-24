/**
 * 管理员认证路由：POST /admin/login
 */
import { Hono } from 'hono'
import { performLogin, recordLoginLog } from '../../services/admin-auth.service'
import type { HonoEnv } from '../../types'
import { getClientIp, getRequestPath } from '../../utils/request'
import { FixedWindowRateLimiter } from '../../utils/rate-limit'
import { AppError, ErrorCode, failure, success } from '../../utils/response'

/**
 * 登录限流：同一 IP + 用户名，10 分钟内最多 10 次失败尝试。
 * 仅统计失败次数，登录成功即清零，避免正常用户被误伤。
 */
const loginLimiter = new FixedWindowRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  keyPrefix: 'admin-login',
})

export const adminAuthRoutes = new Hono<HonoEnv>()

adminAuthRoutes.post('/login', async (c) => {
  const ip = getClientIp(c)
  const requestPath = getRequestPath(c)

  const writeLog = (level: 'INFO' | 'WARN', statusCode: number, detail: string) =>
    recordLoginLog({
      level,
      operation: '管理员登录',
      module: 'auth',
      operatorId: null,
      ip,
      requestPath,
      statusCode,
      detail,
    })

  // 1. 解析 JSON
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    await writeLog('WARN', 400, '请求体不是合法 JSON')
    return c.json(failure(ErrorCode.BAD_REQUEST, '请求体必须是合法的 JSON'), 400)
  }

  // 2. 字段校验
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    await writeLog('WARN', 400, '请求体不是 JSON 对象')
    return c.json(failure(ErrorCode.BAD_REQUEST, '用户名和密码不能为空'), 400)
  }
  const payload = body as Record<string, unknown>
  const username = payload.username
  const password = payload.password
  if (
    typeof username !== 'string' ||
    username.trim() === '' ||
    typeof password !== 'string' ||
    password === ''
  ) {
    await writeLog('WARN', 400, '用户名或密码缺失')
    return c.json(failure(ErrorCode.BAD_REQUEST, '用户名和密码不能为空'), 400)
  }
  const usernameValue = username.trim()

  // 3. 限流
  const limitKey = `${ip}|${usernameValue.toLowerCase()}`
  const decision = loginLimiter.check(limitKey)
  if (!decision.allowed) {
    await writeLog('WARN', 429, `登录尝试过于频繁, username=${usernameValue}`)
    return c.json(failure(ErrorCode.TOO_MANY_ATTEMPTS, '尝试次数过多，请 10 分钟后再试'), 429)
  }

  try {
    // 4~8. 校验账号 -> 更新登录时间 -> 签发 token
    const result = await performLogin({ username: usernameValue, password })
    loginLimiter.reset(limitKey)
    await recordLoginLog({
      level: 'INFO',
      operation: '管理员登录',
      module: 'auth',
      operatorId: result.admin.id,
      ip,
      requestPath,
      statusCode: 200,
      detail: `管理员 ${result.admin.username} 登录成功`,
    })
    return c.json(
      success(
        {
          token: result.token,
          expiresIn: result.expiresIn,
          admin: result.admin,
        },
        '登录成功',
      ),
      200,
    )
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === ErrorCode.INVALID_CREDENTIALS) {
        loginLimiter.hit(limitKey)
      }
      await writeLog('WARN', error.status, `登录失败: ${error.message}, username=${usernameValue}`)
      return c.json(failure(error.code, error.message), error.status)
    }
    // 未预期的异常交给全局 onError 兜底
    throw error
  }
})
