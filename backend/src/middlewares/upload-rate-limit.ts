/**
 * 上传限流：两个上传入口（管理员 / 游客）共用同一个 IP 配额。
 *
 * 设计要点：
 * - 固定窗口：60 秒内最多 10 次（可通过 STATIC_FILE_RATE_* 调整）
 * - 检查与计数在鉴权、multipart 解析之前同步完成；失败的请求同样消耗额度
 * - 超限时返回 429 + Retry-After，且不读取请求体
 * - 429 只写轻量控制台日志，不落库，避免限流请求持续写库
 */
import type { MiddlewareHandler } from 'hono'
import { env } from '../config/env'
import type { HonoEnv } from '../types'
import { getClientIp } from '../utils/request'
import { FixedWindowRateLimiter } from '../utils/rate-limit'
import { ErrorCode, failure } from '../utils/response'

/**
 * 上传限流器（进程内单例）。
 * 管理员上传与游客上传共用同一个实例，因此天然共享同一份 IP 配额。
 */
export const uploadRateLimiter = new FixedWindowRateLimiter({
  windowMs: env.staticFile.rateLimitWindowMs,
  max: env.staticFile.rateLimitMax,
  keyPrefix: 'static-file-upload',
})

/** 清空限流计数（测试与运维使用） */
export function resetUploadRateLimiter(): void {
  uploadRateLimiter.clear()
}

/**
 * 上传限流中间件。
 * 必须挂在鉴权与业务处理之前，否则失败请求不消耗额度、可被绕过。
 */
export const uploadRateLimit: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const ip = getClientIp(c)
  const decision = uploadRateLimiter.consume(ip)

  c.header('X-RateLimit-Limit', String(decision.limit))
  c.header('X-RateLimit-Remaining', String(decision.remaining))

  if (!decision.allowed) {
    const retryAfter = decision.retryAfterSeconds
    c.header('Retry-After', String(retryAfter))
    // 轻量日志：不落库，避免限流请求持续写库
    console.warn(
      `[rate-limit] 上传过于频繁 ip=${ip} path=${c.req.path} retryAfter=${retryAfter}s`,
    )
    return c.json(
      failure(ErrorCode.TOO_MANY_ATTEMPTS, `上传过于频繁，请 ${retryAfter} 秒后再试`),
      429,
    )
  }

  await next()
}
