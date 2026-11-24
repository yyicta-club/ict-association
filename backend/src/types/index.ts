/**
 * 全局共享类型定义。
 */

/** admins 表行（password_hash 仅在服务端内部使用，禁止回传前端） */
export type AdminRow = {
  id: number
  username: string
  password_hash: string
  nickname: string | null
  email: string | null
  /** 1 正常 / 0 禁用 */
  status: number
  last_login_at: string | null
  created_at: string
  updated_at: string
}

/** 对外暴露的管理员信息（不含密码哈希） */
export type AdminPublic = {
  id: number
  username: string
  nickname: string | null
  email: string | null
}

/** JWT 中的管理员载荷 */
export type JwtAdminPayload = {
  /** admins.id（字符串形式，符合 JWT sub 约定） */
  sub: string
  username: string
  nickname: string | null
  role: 'admin'
  /** 签发时间（秒） */
  iat: number
  /** 过期时间（秒） */
  exp: number
}

/** 统一响应体 */
export type ApiResponse<T = unknown> = {
  code: number
  message: string
  data: T | null
}

/** Hono 上下文变量 */
export type AppVariables = {
  /** 通过 adminAuth 中间件后写入的管理员信息 */
  admin: JwtAdminPayload
}

/** 运行时绑定（Bun Server 注入的能力） */
export type ServerBindings = {
  /** Bun Server 提供的客户端 IP 解析 */
  requestIP?: (request: Request) => { address: string } | null
}

/** Hono 应用环境类型 */
export type HonoEnv = {
  Bindings: ServerBindings
  Variables: AppVariables
}
