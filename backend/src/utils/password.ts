/**
 * 密码哈希工具（基于 Bun 原生 Bun.password，零额外依赖）。
 *
 * - 新密码统一使用 argon2id：memoryCost 64MiB / timeCost 3，兼顾强度与登录耗时
 * - 校验时兼容历史 bcrypt 哈希（Bun 会按 `$2b$` / `$argon2id$` 前缀自动识别算法）
 * - 全流程不落明文
 */

const ARGON2_OPTIONS = {
  algorithm: 'argon2id',
  memoryCost: 65536,
  timeCost: 3,
} as const

/** 生成 PHC 字符串格式的密码哈希，可直接存入 admins.password_hash */
export async function hashPassword(password: string): Promise<string> {
  if (!password) {
    throw new Error('密码不能为空')
  }
  return Bun.password.hash(password, ARGON2_OPTIONS)
}

/**
 * 校验密码是否与哈希匹配。
 * 哈希格式非法或参数错误时返回 false，绝不抛出异常。
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) return false
  try {
    return await Bun.password.verify(password, hash)
  } catch {
    return false
  }
}

/**
 * 假哈希校验：用户名不存在时执行一次等价耗时的校验，抹平响应时间差异，
 * 防止攻击者通过耗时差异枚举出有效用户名。
 */
let dummyHashPromise: Promise<string> | null = null

function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = Bun.password.hash('dummy-password-for-timing-equalization', ARGON2_OPTIONS)
  }
  return dummyHashPromise
}

export async function dummyVerify(password: string): Promise<void> {
  const hash = await getDummyHash()
  await verifyPassword(password, hash)
}
