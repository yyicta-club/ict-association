/**
 * 内存固定窗口限流器（零依赖，单进程够用）。
 *
 * 多实例部署时需要把计数换成 Redis 等共享存储，
 * 届时只需替换本类的实现，调用方无需改动。
 */

export type RateLimitDecision = {
  /** 本次请求是否放行 */
  allowed: boolean
  /** 剩余可用次数 */
  remaining: number
  /** 窗口内允许的最大次数 */
  limit: number
  /** 建议的等待秒数（被拒绝时有效） */
  retryAfterSeconds: number
}

type Bucket = {
  count: number
  /** 窗口结束时间戳（毫秒） */
  resetAt: number
}

export type FixedWindowRateLimiterOptions = {
  /** 窗口长度（毫秒） */
  windowMs: number
  /** 窗口内允许的最大次数 */
  max: number
  /** 键前缀，便于多套限流规则共存 */
  keyPrefix?: string
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>()
  private readonly windowMs: number
  private readonly max: number
  private readonly keyPrefix: string
  private lastSweepAt = 0

  constructor(options: FixedWindowRateLimiterOptions) {
    if (options.windowMs <= 0) throw new Error('windowMs 必须大于 0')
    if (options.max <= 0) throw new Error('max 必须大于 0')
    this.windowMs = options.windowMs
    this.max = options.max
    this.keyPrefix = options.keyPrefix ?? ''
  }

  /** 查询当前是否放行（不计数） */
  check(key: string): RateLimitDecision {
    this.sweep()
    const now = Date.now()
    const bucket = this.buckets.get(this.resolveKey(key))
    if (!bucket || now >= bucket.resetAt) {
      return { allowed: true, remaining: this.max, limit: this.max, retryAfterSeconds: 0 }
    }
    const allowed = bucket.count < this.max
    return {
      allowed,
      remaining: Math.max(0, this.max - bucket.count),
      limit: this.max,
      retryAfterSeconds: allowed ? 0 : Math.ceil((bucket.resetAt - now) / 1000),
    }
  }

  /** 记录一次违规/失败（计数 +1） */
  hit(key: string): void {
    const now = Date.now()
    const resolved = this.resolveKey(key)
    const bucket = this.buckets.get(resolved)
    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(resolved, { count: 1, resetAt: now + this.windowMs })
      return
    }
    bucket.count += 1
  }

  /** 清空计数（登录成功后调用，避免正常用户被误伤） */
  reset(key: string): void {
    this.buckets.delete(this.resolveKey(key))
  }

  /** 当前桶数量（测试用） */
  get size(): number {
    return this.buckets.size
  }

  private resolveKey(key: string): string {
    return this.keyPrefix ? `${this.keyPrefix}:${key}` : key
  }

  /** 惰性清理过期桶：最多每个窗口清理一次，避免内存无限增长 */
  private sweep(): void {
    const now = Date.now()
    if (now - this.lastSweepAt < this.windowMs) return
    this.lastSweepAt = now
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) {
        this.buckets.delete(key)
      }
    }
  }
}
