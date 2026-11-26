/**
 * 环境变量集中读取、默认值与启动校验。
 *
 * 约定：业务代码禁止直接访问 `process.env`，一律通过本模块导出的 `env`。
 * 这样可以保证默认值唯一来源、缺失项在启动时立刻暴露，而不是运行到一半才报错。
 */
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, parse, resolve } from 'node:path'
import { parseTrustedProxies } from '../utils/ip'
import type { TrustedProxyEntry } from '../utils/ip'

/** backend 根目录（src/config -> ../..） */
const BACKEND_ROOT = resolve(import.meta.dir, '..', '..')

/** 1 MiB 的字节数 */
export const MEBIBYTE = 1024 * 1024

/** 单个上传文件允许的最大字节数：5 MiB */
export const MAX_UPLOAD_FILE_BYTES = 5 * MEBIBYTE

/** 整个上传请求体允许的最大字节数：6 MiB */
export const MAX_UPLOAD_REQUEST_BYTES = 6 * MEBIBYTE

/** 单张图片允许的累计解码像素上限（防止压缩炸弹） */
export const MAX_UPLOAD_TOTAL_PIXELS = 40_000_000

export interface DbConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
  connectionLimit: number
}

export interface StaticFileConfig {
  /** 上传根目录（绝对路径）；分类子目录与文件名都在其下 */
  rootPath: string
  /** 单文件字节上限 */
  maxFileBytes: number
  /** 整个上传请求体字节上限 */
  maxRequestBytes: number
  /** 单张图片累计解码像素上限 */
  maxTotalPixels: number
  /** 上传限流窗口（毫秒） */
  rateLimitWindowMs: number
  /** 上传限流窗口内允许的最大次数 */
  rateLimitMax: number
}

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test'
  isProduction: boolean
  /** 后端监听端口（3000 留给 Nuxt 前端） */
  port: number
  db: DbConfig
  jwtSecret: string
  /** JWT 有效期，支持 30s / 30m / 12h / 7d / 2w 或纯秒数 */
  jwtExpiresIn: string
  /** CORS 来源白名单 */
  corsOrigins: string[]
  /** seed:admin 脚本使用的初始管理员 */
  adminInit: { username: string; password: string }
  /** 静态资源（图片上传）配置 */
  staticFile: StaticFileConfig
  /** 可信代理（IP / CIDR）；默认空数组 = 不信任任何代理 */
  trustedProxies: TrustedProxyEntry[]
}

/**
 * 极简 .env 解析器。
 * Bun 运行时本身会自动加载 .env，这里只是兜底，保证在任意 cwd / 任意运行时下行为一致。
 */
export function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
    if (quoted) {
      value = value.slice(1, -1)
    } else {
      // 未加引号时，# 之后视为注释
      const comment = value.indexOf('#')
      if (comment !== -1) value = value.slice(0, comment).trim()
    }
    if (key) result[key] = value
  }
  return result
}

/** 读取 .env 文件；已存在的真实环境变量优先，不会被覆盖 */
export function loadDotEnvFile(file: string, target: Record<string, string | undefined>): void {
  if (!existsSync(file)) return
  const parsed = parseDotEnv(readFileSync(file, 'utf8'))
  for (const [key, value] of Object.entries(parsed)) {
    if (target[key] === undefined) target[key] = value
  }
}

function toInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined) return fallback
  const trimmed = raw.trim()
  if (trimmed === '') return fallback
  const value = Number(trimmed)
  if (!Number.isInteger(value)) {
    throw new Error(`环境变量 ${name} 必须是整数，当前值: ${raw}`)
  }
  return value
}

/**
 * 校验并归一化上传根目录。
 * 必须是绝对路径，且不能是文件系统根目录（否则分类子目录会写错位置）。
 */
function resolveStaticFilePath(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  if (value === '') return ''
  if (!isAbsolute(value)) {
    throw new Error(`STATIC_FILE_PATH 必须是绝对路径，当前值: ${value}`)
  }
  const resolved = resolve(value)
  if (parse(resolved).root === resolved) {
    throw new Error(`STATIC_FILE_PATH 不能是文件系统根目录，当前值: ${value}`)
  }
  return resolved
}

/** 读取并组装全部配置 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  loadDotEnvFile(resolve(BACKEND_ROOT, '.env'), source as Record<string, string | undefined>)

  const nodeEnvRaw = (source.NODE_ENV ?? 'development').trim().toLowerCase()
  const nodeEnv: AppConfig['nodeEnv'] =
    nodeEnvRaw === 'production' ? 'production' : nodeEnvRaw === 'test' ? 'test' : 'development'

  const corsRaw = source.CORS_ORIGINS ?? ''
  const corsOrigins = corsRaw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (corsOrigins.length === 0) {
    corsOrigins.push('http://localhost:3000', 'http://127.0.0.1:3000')
  }

  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port: toInt(source.PORT, 8787, 'PORT'),
    db: {
      host: (source.DB_HOST ?? '127.0.0.1').trim(),
      port: toInt(source.DB_PORT, 3306, 'DB_PORT'),
      user: (source.DB_USER ?? 'root').trim(),
      password: source.DB_PASSWORD ?? '',
      database: (source.DB_NAME ?? 'ict_association').trim(),
      connectionLimit: toInt(source.DB_CONNECTION_LIMIT, 10, 'DB_CONNECTION_LIMIT'),
    },
    jwtSecret: (source.JWT_SECRET ?? '').trim(),
    jwtExpiresIn: (source.JWT_EXPIRES_IN ?? '7d').trim() || '7d',
    corsOrigins,
    adminInit: {
      username: (source.ADMIN_INIT_USERNAME ?? 'admin').trim() || 'admin',
      password: source.ADMIN_INIT_PASSWORD ?? '',
    },
    staticFile: {
      rootPath: resolveStaticFilePath(source.STATIC_FILE_PATH),
      maxFileBytes: MAX_UPLOAD_FILE_BYTES,
      maxRequestBytes: MAX_UPLOAD_REQUEST_BYTES,
      maxTotalPixels: MAX_UPLOAD_TOTAL_PIXELS,
      rateLimitWindowMs: toInt(source.STATIC_FILE_RATE_WINDOW_MS, 60_000, 'STATIC_FILE_RATE_WINDOW_MS'),
      rateLimitMax: toInt(source.STATIC_FILE_RATE_MAX, 10, 'STATIC_FILE_RATE_MAX'),
    },
    trustedProxies: parseTrustedProxies(source.TRUSTED_PROXIES),
  }
}

/**
 * 运行时启动校验：缺失关键配置时立刻拒绝启动。
 * 仅在服务入口调用；脚本（db:init / seed:admin）不需要 JWT 密钥。
 */
export function assertRuntimeEnv(config: AppConfig): void {
  const problems: string[] = []
  if (!config.jwtSecret) {
    problems.push('JWT_SECRET 未配置（请在 backend/.env 中设置 >= 32 位随机字符串）')
  } else if (config.jwtSecret.length < 32) {
    problems.push(`JWT_SECRET 长度不足 32 位（当前 ${config.jwtSecret.length} 位）`)
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    problems.push(`PORT 非法: ${config.port}`)
  }
  if (!config.db.database) {
    problems.push('DB_NAME 未配置')
  }
  if (!Number.isInteger(config.db.port) || config.db.port < 1 || config.db.port > 65535) {
    problems.push(`DB_PORT 非法: ${config.db.port}`)
  }
  if (!config.staticFile.rootPath) {
    problems.push('STATIC_FILE_PATH 未配置（上传目录绝对路径，示例见 backend/.env.example）')
  }
  if (config.staticFile.maxFileBytes < 1 || config.staticFile.maxFileBytes > MAX_UPLOAD_FILE_BYTES) {
    problems.push(`STATIC_FILE 单文件上限非法: ${config.staticFile.maxFileBytes}`)
  }
  if (config.staticFile.maxRequestBytes < config.staticFile.maxFileBytes) {
    problems.push('STATIC_FILE 请求体上限必须不小于单文件上限')
  }
  if (config.staticFile.rateLimitMax < 1) {
    problems.push(`STATIC_FILE_RATE_MAX 非法: ${config.staticFile.rateLimitMax}`)
  }
  if (problems.length > 0) {
    throw new Error(`启动配置校验失败:\n  - ${problems.join('\n  - ')}`)
  }
}

/** 全局配置单例 */
export const env: AppConfig = loadConfig()
