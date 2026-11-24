/**
 * 请求相关的公共小工具。
 */
import type { Context } from 'hono'
import type { HonoEnv } from '../types'

/**
 * 获取客户端真实 IP。
 * 优先读取反向代理写入的 X-Forwarded-For / X-Real-IP，
 * 其次回退到 Bun Server 提供的 requestIP，最后为 unknown。
 */
export function getClientIp(c: Context<HonoEnv>): string {
  const forwardedFor = c.req.header('x-forwarded-for')
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim()
    if (first) return first
  }
  const realIp = c.req.header('x-real-ip')
  if (realIp) return realIp.trim()

  const address = c.env?.requestIP?.(c.req.raw)?.address
  return address ?? 'unknown'
}

/** 获取请求路径（不含 query string） */
export function getRequestPath(c: Context<HonoEnv>): string {
  return new URL(c.req.url).pathname
}
