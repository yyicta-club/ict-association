import { describe, expect, test } from 'bun:test'
import { sign } from 'hono/jwt'
import { buildAdminUpdatePlan } from '../src/services/admin-user.service'
import { parseExpiresIn, signAdminToken, verifyAdminToken } from '../src/utils/jwt'
import { dummyVerify, hashPassword, verifyPassword } from '../src/utils/password'
import { FixedWindowRateLimiter } from '../src/utils/rate-limit'
import { ERROR_HTTP_STATUS, ErrorCode, failure, success } from '../src/utils/response'
import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  validateEmail,
  validatePassword,
  validateUsername,
} from '../src/utils/validation'

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

  test('账户管理相关错误码与 HTTP 状态码映射', () => {
    expect(ERROR_HTTP_STATUS[ErrorCode.ADMIN_NOT_FOUND]).toBe(404)
    expect(ERROR_HTTP_STATUS[ErrorCode.ADMIN_CONFLICT]).toBe(409)
    expect(ERROR_HTTP_STATUS[ErrorCode.USERNAME_EXISTS]).toBe(409)
    expect(ERROR_HTTP_STATUS[ErrorCode.EMAIL_EXISTS]).toBe(409)
    expect(ErrorCode.ADMIN_NOT_FOUND).toBe(40401)
    expect(ErrorCode.USERNAME_EXISTS).toBe(40901)
    expect(ErrorCode.EMAIL_EXISTS).toBe(40902)
  })
})

describe('validation', () => {
  test('用户名：合法值去除首尾空白', () => {
    const result = validateUsername('  editor01  ')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('editor01')
  })

  test('用户名：空值 / 非字符串 / 非法字符 / 超长均失败', () => {
    expect(validateUsername('').ok).toBe(false)
    expect(validateUsername('   ').ok).toBe(false)
    expect(validateUsername(undefined).ok).toBe(false)
    expect(validateUsername(null).ok).toBe(false)
    expect(validateUsername(123).ok).toBe(false)
    expect(validateUsername('editor 01').ok).toBe(false)
    expect(validateUsername('editor@01').ok).toBe(false)
    expect(validateUsername('a'.repeat(USERNAME_MAX_LENGTH + 1)).ok).toBe(false)
  })

  test('用户名：缺失与空白都提示"不能为空"', () => {
    const missing = validateUsername(undefined)
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.message).toBe('用户名不能为空')
    const blank = validateUsername('   ')
    expect(blank.ok).toBe(false)
    if (!blank.ok) expect(blank.message).toBe('用户名不能为空')
  })

  test('用户名：允许字母数字下划线中划线点', () => {
    for (const name of ['admin', 'editor_01', 'a-b.c', 'Admin2026']) {
      expect(validateUsername(name).ok).toBe(true)
    }
  })

  test('密码：长度边界', () => {
    expect(validatePassword('a'.repeat(PASSWORD_MIN_LENGTH)).ok).toBe(true)
    expect(validatePassword('a'.repeat(PASSWORD_MIN_LENGTH - 1)).ok).toBe(false)
    expect(validatePassword(12345678).ok).toBe(false)
  })

  test('密码：缺失提示"不能为空"', () => {
    const missing = validatePassword(undefined)
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.message).toBe('密码不能为空')
  })

  test('密码：保留首尾空格（不 trim）', () => {
    const result = validatePassword('  Passw0rd!  ')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('  Passw0rd!  ')
  })

  test('邮箱：undefined / null / 空串都归一化为 null', () => {
    for (const raw of [undefined, null, '', '   ']) {
      const result = validateEmail(raw)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toBeNull()
    }
  })

  test('邮箱：合法地址去除首尾空白', () => {
    const result = validateEmail('  editor01@example.com  ')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('editor01@example.com')
  })

  test('邮箱：非法格式 / 非字符串 / 超长均失败', () => {
    expect(validateEmail('not-an-email').ok).toBe(false)
    expect(validateEmail('bad@').ok).toBe(false)
    expect(validateEmail('a@b').ok).toBe(false)
    expect(validateEmail(123).ok).toBe(false)
    expect(validateEmail(`${'a'.repeat(EMAIL_MAX_LENGTH)}@example.com`).ok).toBe(false)
  })
})

describe('buildAdminUpdatePlan（只更新变化字段）', () => {
  const current = { username: 'admin', email: 'admin@example.com' }

  test('未提供任何字段 -> 空计划', () => {
    const plan = buildAdminUpdatePlan(current, {})
    expect(plan.sets).toEqual([])
    expect(plan.values).toEqual([])
    expect(plan.changedFields).toEqual([])
  })

  test('字段值与当前值相同 -> 不进入 SET 子句', () => {
    const plan = buildAdminUpdatePlan(current, {
      username: 'admin',
      email: 'admin@example.com',
    })
    expect(plan.sets).toEqual([])
    expect(plan.changedFields).toEqual([])
  })

  test('只改账户名 -> 只含 username', () => {
    const plan = buildAdminUpdatePlan(current, { username: 'newName' })
    expect(plan.sets).toEqual(['username = ?'])
    expect(plan.values).toEqual(['newName'])
    expect(plan.changedFields).toEqual(['username'])
  })

  test('只改邮箱 -> 只含 email', () => {
    const plan = buildAdminUpdatePlan(current, { email: 'new@example.com' })
    expect(plan.sets).toEqual(['email = ?'])
    expect(plan.values).toEqual(['new@example.com'])
    expect(plan.changedFields).toEqual(['email'])
  })

  test('清空邮箱（传 null）-> 写入 null 值', () => {
    const plan = buildAdminUpdatePlan(current, { email: null })
    expect(plan.sets).toEqual(['email = ?'])
    expect(plan.values).toEqual([null])
    expect(plan.changedFields).toEqual(['email'])
  })

  test('当前邮箱已为空时传 null -> 不变更', () => {
    const plan = buildAdminUpdatePlan({ username: 'admin', email: null }, { email: null })
    expect(plan.sets).toEqual([])
    expect(plan.changedFields).toEqual([])
  })

  test('同时改账户名与邮箱 -> 两个字段都在计划里', () => {
    const plan = buildAdminUpdatePlan(current, {
      username: 'newName',
      email: 'new@example.com',
    })
    expect(plan.sets).toEqual(['username = ?', 'email = ?'])
    expect(plan.values).toEqual(['newName', 'new@example.com'])
    expect(plan.changedFields).toEqual(['username', 'email'])
  })
})
