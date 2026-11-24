import { describe, expect, test } from 'bun:test'
import { sign } from 'hono/jwt'
import { parseExpiresIn, signAdminToken, verifyAdminToken } from '../src/utils/jwt'
import { dummyVerify, hashPassword, verifyPassword } from '../src/utils/password'
import { FixedWindowRateLimiter } from '../src/utils/rate-limit'
import { ERROR_HTTP_STATUS, ErrorCode, failure, success } from '../src/utils/response'

const TEST_SECRET = 'unit-test-secret-key-0123456789abcdef'

describe('password', () => {
  test('哈希 -> 校验往返', async () => {
    const hash = await hashPassword('correct-horse-battery')
    expect(hash.startsWith('$argon2id$')).toBe(true)
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true)
  })

  test('错误密码校验失败', async () => {
    const hash = await hashPassword('correct-horse-battery')
    expect(await verifyPassword('wrong-password', hash)).toBe(false)
  })

  test('相同密码两次哈希结果不同（随机盐）', async () => {
    const first = await hashPassword('same-password')
    const second = await hashPassword('same-password')
    expect(first).not.toBe(second)
    expect(await verifyPassword('same-password', first)).toBe(true)
    expect(await verifyPassword('same-password', second)).toBe(true)
  })

  test('非法哈希不抛异常', async () => {
    expect(await verifyPassword('any', 'not-a-valid-hash')).toBe(false)
    expect(await verifyPassword('', '')).toBe(false)
  })

  test('dummyVerify 正常返回（用于摊平耗时）', async () => {
    expect(await dummyVerify('whatever')).toBeUndefined()
  })
})

describe('jwt', () => {
  test('签发 -> 校验往返', async () => {
    const { token, expiresIn } = await signAdminToken(
      { id: 1, username: 'admin', nickname: '系统管理员' },
      TEST_SECRET,
      '7d',
    )
    expect(expiresIn).toBe(604800)

    const payload = await verifyAdminToken(token, TEST_SECRET)
    expect(payload.sub).toBe('1')
    expect(payload.username).toBe('admin')
    expect(payload.nickname).toBe('系统管理员')
    expect(payload.role).toBe('admin')
    expect(payload.exp - payload.iat).toBe(604800)
  })

  test('篡改的 token 被拒绝', async () => {
    const { token } = await signAdminToken({ id: 1, username: 'admin', nickname: null }, TEST_SECRET, '1h')
    const tampered = `${token.slice(0, -3)}xyz`
    await expect(verifyAdminToken(tampered, TEST_SECRET)).rejects.toThrow()
  })

  test('错误密钥被拒绝', async () => {
    const { token } = await signAdminToken({ id: 1, username: 'admin', nickname: null }, TEST_SECRET, '1h')
    await expect(verifyAdminToken(token, 'another-secret-key-0123456789abcdef')).rejects.toThrow()
  })

  test('过期 token 被拒绝', async () => {
    const now = Math.floor(Date.now() / 1000)
    const expired = await sign(
      { sub: '1', username: 'admin', role: 'admin', iat: now - 100, exp: now - 10 },
      TEST_SECRET,
      'HS256',
    )
    await expect(verifyAdminToken(expired, TEST_SECRET)).rejects.toThrow()
  })
})

describe('parseExpiresIn', () => {
  test('支持常见单位', () => {
    expect(parseExpiresIn('30s')).toBe(30)
    expect(parseExpiresIn('30m')).toBe(1800)
    expect(parseExpiresIn('12h')).toBe(43200)
    expect(parseExpiresIn('7d')).toBe(604800)
    expect(parseExpiresIn('2w')).toBe(1209600)
    expect(parseExpiresIn('600')).toBe(600)
  })

  test('非法值抛异常', () => {
    expect(() => parseExpiresIn('abc')).toThrow()
    expect(() => parseExpiresIn('')).toThrow()
  })
})

describe('rate-limit', () => {
  test('超过阈值后拒绝', () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 60_000, max: 2 })
    expect(limiter.check('a').allowed).toBe(true)
    limiter.hit('a')
    expect(limiter.check('a').allowed).toBe(true)
    limiter.hit('a')
    expect(limiter.check('a').allowed).toBe(false)
  })

  test('reset 后恢复', () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 60_000, max: 1 })
    limiter.hit('a')
    expect(limiter.check('a').allowed).toBe(false)
    limiter.reset('a')
    expect(limiter.check('a').allowed).toBe(true)
  })

  test('不同 key 相互独立', () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 60_000, max: 1 })
    limiter.hit('a')
    expect(limiter.check('a').allowed).toBe(false)
    expect(limiter.check('b').allowed).toBe(true)
  })
})

describe('response', () => {
  test('success 结构', () => {
    expect(success({ id: 1 }, '登录成功')).toEqual({ code: 0, message: '登录成功', data: { id: 1 } })
  })

  test('failure 结构', () => {
    expect(failure(ErrorCode.INVALID_CREDENTIALS, '用户名或密码错误')).toEqual({
      code: 40101,
      message: '用户名或密码错误',
      data: null,
    })
  })

  test('错误码与 HTTP 状态码映射', () => {
    expect(ERROR_HTTP_STATUS[ErrorCode.SUCCESS]).toBe(200)
    expect(ERROR_HTTP_STATUS[ErrorCode.BAD_REQUEST]).toBe(400)
    expect(ERROR_HTTP_STATUS[ErrorCode.UNAUTHORIZED]).toBe(401)
    expect(ERROR_HTTP_STATUS[ErrorCode.INVALID_CREDENTIALS]).toBe(401)
    expect(ERROR_HTTP_STATUS[ErrorCode.FORBIDDEN]).toBe(403)
    expect(ERROR_HTTP_STATUS[ErrorCode.ACCOUNT_DISABLED]).toBe(403)
    expect(ERROR_HTTP_STATUS[ErrorCode.TOO_MANY_ATTEMPTS]).toBe(429)
    expect(ERROR_HTTP_STATUS[ErrorCode.INTERNAL_ERROR]).toBe(500)
  })
})
