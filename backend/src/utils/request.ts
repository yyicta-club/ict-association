/**
 * 请求相关的公共小工具。
 */
import type { Context } from 'hono'
import { env } from '../config/env'
import type { HonoEnv } from '../types'
import { resolveClientIp } from './ip'

/**
 * 获取客户端真实 IP。
 *
 * 安全约定（详见 utils/ip.ts）：
 * - 默认不信任任何代理：未配置 TRUSTED_PROXIES 时完全忽略 X-Forwarded-For / X-Real-IP
 * - 只有"连接对端地址"本身在 TRUSTED_PROXIES 内时，才采信转发头
 * - 代理链自右向左剥离可信节点，取第一个非可信地址作为真实客户端 IP
 */
export function getClientIp(c: Context<HonoEnv>): string {
  const remoteAddress = c.env?.requestIP?.(c.req.raw)?.address ?? null
  return resolveClientIp({
    remoteAddress,
    forwardedFor: c.req.header('x-forwarded-for'),
    realIp: c.req.header('x-real-ip'),
    trustedProxies: env.trustedProxies,
  }).ip
}

/** 获取请求路径（不含 query string） */
export function getRequestPath(c: Context<HonoEnv>): string {
  return new URL(c.req.url).pathname
}
