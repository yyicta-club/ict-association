/**
 * Hono 应用组装：CORS -> 请求日志 -> 路由挂载 -> 健康检查 -> 404 -> 全局错误处理。
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { env } from './config/env'
import { ping } from './db'
import { logger } from './middlewares/logger'
import { adminRoutes } from './routes/admin'
import { touristRoutes } from './routes/tourist'
import type { HonoEnv } from './types'
import { ErrorCode, failure } from './utils/response'

export function createApp(): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>()

  // CORS：白名单之外的来源不返回跨域响应头，浏览器自行拦截
  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin) return undefined
        return env.corsOrigins.includes(origin) ? origin : ''
      },
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: ['Content-Length'],
      credentials: true,
      maxAge: 600,
    }),
  )

  app.use('*', logger)

  app.route('/admin', adminRoutes)
  app.route('/tourist', touristRoutes)

  // 健康检查：数据库不可用时返回 503 degraded
  app.get('/health', async (c) => {
    const dbUp = await ping()
    return c.json(
      {
        status: dbUp ? 'ok' : 'degraded',
        db: dbUp ? 'up' : 'down',
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      },
      dbUp ? 200 : 503,
    )
  })

  // 404：接口不存在
  app.notFound((c) => c.json(failure(ErrorCode.BAD_REQUEST, '接口不存在'), 404))

  // 全局兜底：绝不把堆栈泄露给客户端
  app.onError((error, c) => {
    console.error(`[error] ${c.req.method} ${c.req.path} ->`, error)
    return c.json(failure(ErrorCode.INTERNAL_ERROR, '服务器内部错误'), 500)
  })

  return app
}
