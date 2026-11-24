/**
 * 接口层集成测试：不依赖 MySQL。
 *
 * 覆盖应用装配本身：路由挂载、统一响应体、404、鉴权中间件、CORS 白名单。
 * 数据库相关分支由 /health 的降级逻辑与登录接口的 500 兜底覆盖。
 */
import { describe, expect, test } from 'bun:test'
import { createApp } from '../src/app'
import { env } from '../src/config/env'
import { signAdminToken } from '../src/utils/jwt'

const app = createApp()

/** 统一响应体 */
type JsonBody = {
  code?: number
  message?: string
  data?: unknown
  status?: string
  db?: string
}

/** 发起一次请求并解析响应体 */
async function call(path: string, init?: RequestInit) {
  const response = await app.request(path, init)
  let body: JsonBody | null = null
  try {
    body = (await response.json()) as JsonBody
  } catch {
    body = null
  }
  return { response, body }
}

describe('健康检查', () => {
  test('始终返回 status 与 db 字段，数据库不可用时为 503 degraded', async () => {
    const { response, body } = await call('/health')
    expect(body !== null).toBe(true)
    expect(body?.status === 'ok' || body?.status === 'degraded').toBe(true)
    expect(body?.db === 'up' || body?.db === 'down').toBe(true)

    if (body?.db === 'down') {
      expect(response.status).toBe(503)
      expect(body?.status).toBe('degraded')
    } else {
      expect(response.status).toBe(200)
      expect(body?.status).toBe('ok')
    }
  })
})

describe('POST /admin/login 参数校验', () => {
  test('非法 JSON -> 40000 / 400', async () => {
    const { response, body } = await call('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    expect(response.status).toBe(400)
    expect(body?.code).toBe(40000)
    expect(body?.message).toBe('请求体必须是合法的 JSON')
  })

  test('缺少用户名或密码 -> 40000 / 400', async () => {
    const { response, body } = await call('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin' }),
    })
    expect(response.status).toBe(400)
    expect(body?.code).toBe(40000)
    expect(body?.message).toBe('用户名和密码不能为空')
  })

  test('数据库不可用时兜底为 50000 / 500，且不泄露堆栈', async () => {
    const { response, body } = await call('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'whatever-123456' }),
    })
    // 有 MySQL 时会走正常登录（200/40101），无 MySQL 时由全局 onError 兜底
    expect([200, 401, 403, 429, 500].includes(response.status)).toBe(true)
    expect(typeof body?.code).toBe('number')
    expect(body?.data).toBeNull()
    if (response.status === 500) {
      expect(body?.code).toBe(50000)
      expect(body?.message).toBe('服务器内部错误')
      expect(JSON.stringify(body).includes('stack')).toBe(false)
    }
  })
})

describe('鉴权中间件', () => {
  test('无 Authorization -> 40100 / 401', async () => {
    const { response, body } = await call('/admin/me')
    expect(response.status).toBe(401)
    expect(body?.code).toBe(40100)
  })

  test('伪造 token -> 40100 / 401', async () => {
    const { response, body } = await call('/admin/me', {
      headers: { Authorization: 'Bearer not-a-real-token' },
    })
    expect(response.status).toBe(401)
    expect(body?.code).toBe(40100)
  })

  test('合法 token -> 放行并回显当前管理员', async () => {
    const { token } = await signAdminToken(
      { id: 1, username: 'admin', nickname: '系统管理员' },
      env.jwtSecret,
      '1h',
    )
    const { response, body } = await call('/admin/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(200)
    expect(body?.code).toBe(0)
    const data = body?.data as { id?: number; username?: string; role?: string } | null
    expect(data?.id).toBe(1)
    expect(data?.username).toBe('admin')
    expect(data?.role).toBe('admin')
  })
})

describe('路由与错误处理', () => {
  test('未知路由 -> 40000 / 404', async () => {
    const { response, body } = await call('/definitely-not-a-route')
    expect(response.status).toBe(404)
    expect(body?.code).toBe(40000)
    expect(body?.message).toBe('接口不存在')
  })

  test('/tourist 占位接口可用', async () => {
    const { response, body } = await call('/tourist/ping')
    expect(response.status).toBe(200)
    expect(body?.code).toBe(0)
  })
})

describe('CORS 白名单', () => {
  test('白名单来源返回 Allow-Origin', async () => {
    const response = await app.request('/admin/login', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
      },
    })
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
  })

  test('非白名单来源不返回 Allow-Origin', async () => {
    const response = await app.request('/admin/login', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://evil.example.com',
        'Access-Control-Request-Method': 'POST',
      },
    })
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})
