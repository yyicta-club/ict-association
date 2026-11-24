/**
 * 管理员鉴权中间件。
 *
 * 后续所有 /admin 写接口直接挂载 `adminAuth` 即可；
 * 校验通过后把管理员信息写入 `c.var.admin`。
 */
import type { MiddlewareHandler } from 'hono'
import { env } from '../config/env'
import type { HonoEnv } from '../types'
import { verifyAdminToken } from '../utils/jwt'
import { ErrorCode, failure } from '../utils/response'

export const adminAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const header = c.req.header('Authorization') ?? ''
  const [scheme, token] = header.split(' ')

  if (!scheme || !/^Bearer$/i.test(scheme) || !token) {
    return c.json(failure(ErrorCode.UNAUTHORIZED, '未登录或登录已过期'), 401)
  }

  try {
    const payload = await verifyAdminToken(token.trim(), env.jwtSecret)
    c.set('admin', payload)
  } catch {
    return c.json(failure(ErrorCode.UNAUTHORIZED, '未登录或登录已过期'), 401)
  }

  await next()
}
