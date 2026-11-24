/**
 * 请求日志中间件：记录 method / path / status / 耗时。
 */
import type { MiddlewareHandler } from 'hono'
import type { HonoEnv } from '../types'
import { getClientIp } from '../utils/request'

export const logger: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const start = performance.now()
  try {
    await next()
  } finally {
    const duration = Math.round((performance.now() - start) * 100) / 100
    console.log(
      `[http] ${c.req.method} ${c.req.path} ${c.res.status} ${duration}ms ip=${getClientIp(c)}`,
    )
  }
}
