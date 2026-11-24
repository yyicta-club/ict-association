/**
 * JWT 工具（基于 Hono 内置 hono/jwt，HS256 对称签名，零额外依赖）。
 */
import { sign, verify } from 'hono/jwt'
import type { JwtAdminPayload } from '../types'

const ALGORITHM = 'HS256'

const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
}

/**
 * 解析有效期字符串为秒数。
 * 支持：30s / 30m / 12h / 7d / 2w / 纯秒数（如 600）
 */
export function parseExpiresIn(value: string): number {
  const raw = value.trim().toLowerCase()
  if (!raw) {
    throw new Error('有效期不能为空')
  }
  if (/^\d+$/.test(raw)) {
    return Number(raw)
  }
  const matched = /^(\d+)\s*(s|m|h|d|w)$/.exec(raw)
  if (!matched) {
    throw new Error(`无法解析有效期: ${value}（示例：30s / 30m / 12h / 7d / 2w）`)
  }
  const amount = Number(matched[1])
  const factor = UNIT_SECONDS[matched[2]]
  if (!factor) {
    throw new Error(`无法解析有效期: ${value}`)
  }
  return amount * factor
}

/** 签发管理员 token */
export async function signAdminToken(
  admin: { id: number; username: string; nickname: string | null },
  secret: string,
  expiresIn = '7d',
): Promise<{ token: string; expiresIn: number }> {
  if (!secret) {
    throw new Error('JWT 密钥不能为空')
  }
  const ttl = parseExpiresIn(expiresIn)
  const issuedAt = Math.floor(Date.now() / 1000)
  const payload: JwtAdminPayload = {
    sub: String(admin.id),
    username: admin.username,
    nickname: admin.nickname,
    role: 'admin',
    iat: issuedAt,
    exp: issuedAt + ttl,
  }
  const token = await sign(payload, secret, ALGORITHM)
  return { token, expiresIn: ttl }
}

/**
 * 校验并解析管理员 token。
 * 签名不匹配 / 已过期 / 格式非法时抛出异常，由调用方转成 401 响应。
 */
export async function verifyAdminToken(token: string, secret: string): Promise<JwtAdminPayload> {
  if (!token || !secret) {
    throw new Error('token 或密钥缺失')
  }
  const payload = await verify(token, secret, ALGORITHM)
  return {
    sub: String(payload.sub ?? ''),
    username: String(payload.username ?? ''),
    nickname: typeof payload.nickname === 'string' ? payload.nickname : null,
    role: 'admin',
    iat: Number(payload.iat ?? 0),
    exp: Number(payload.exp ?? 0),
  }
}
