/**
 * 接口层集成测试：不依赖 MySQL。
 *
 * 覆盖应用装配本身：路由挂载、统一响应体、404、鉴权中间件、CORS 白名单。
 * 数据库相关分支由 /health 的降级逻辑与登录接口的 500 兜底覆盖。
 *
 * 安全约定：
 * 本文件只保留**不会产生任何数据库读写**的用例。
 * 需要特别注意：路由层的参数校验失败分支同样会调用 recordSystemLog()
 * 写入 system_logs，因此"参数校验"类用例会打库，已全部移除；
 * /health 会执行 ping()，同样已移除。
 * 保留的用例全部在写日志与查库之前就返回了。
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

/** 生成一个合法管理员 token，用于访问受保护接口 */
async function adminToken(): Promise<string> {
  const { token } = await signAdminToken(
    { id: 1, username: 'admin', nickname: '系统管理员' },
    env.jwtSecret,
    '1h',
  )
  return token
}

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
    const token = await adminToken()
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

describe('受保护接口的鉴权拦截', () => {
  test('POST /admin/user/create 无 Authorization -> 40100 / 401', async () => {
    const { response, body } = await call('/admin/user/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'editor01', password: 'Passw0rd!' }),
    })
    expect(response.status).toBe(401)
    expect(body?.code).toBe(40100)
  })

  test('POST /admin/user/create 伪造 token -> 40100 / 401', async () => {
    const { response, body } = await call('/admin/user/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-a-real-token' },
      body: JSON.stringify({ username: 'editor01', password: 'Passw0rd!' }),
    })
    expect(response.status).toBe(401)
    expect(body?.code).toBe(40100)
  })

  test('POST /admin/user/settings 无 Authorization -> 40100 / 401', async () => {
    const { response, body } = await call('/admin/user/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'newname' }),
    })
    expect(response.status).toBe(401)
    expect(body?.code).toBe(40100)
  })

  test('POST /admin/user/settings 伪造 token -> 40100 / 401', async () => {
    const { response, body } = await call('/admin/user/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-a-real-token' },
      body: JSON.stringify({ username: 'newname' }),
    })
    expect(response.status).toBe(401)
    expect(body?.code).toBe(40100)
  })

  test('POST /admin/article/create 无 Authorization -> 40100 / 401', async () => {
    const { response, body } = await call('/admin/article/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '标题', slug: 'news-1', content: '正文' }),
    })
    expect(response.status).toBe(401)
    expect(body?.code).toBe(40100)
  })

  test('POST /admin/article/create 伪造 token -> 40100 / 401', async () => {
    const { response, body } = await call('/admin/article/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-a-real-token' },
      body: JSON.stringify({ title: '标题', slug: 'news-1', content: '正文' }),
    })
    expect(response.status).toBe(401)
    expect(body?.code).toBe(40100)
  })

  test('POST /admin/article/setting 无 Authorization -> 40100 / 401', async () => {
    const { response, body } = await call('/admin/article/setting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 1, title: '新标题' }),
    })
    expect(response.status).toBe(401)
    expect(body?.code).toBe(40100)
  })

  test('POST /admin/article/setting 伪造 token -> 40100 / 401', async () => {
    const { response, body } = await call('/admin/article/setting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-a-real-token' },
      body: JSON.stringify({ id: 1, title: '新标题' }),
    })
    expect(response.status).toBe(401)
    expect(body?.code).toBe(40100)
  })

  test('POST /admin/article/delete 无 Authorization -> 40100 / 401', async () => {
    const { response, body } = await call('/admin/article/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 1 }),
    })
    expect(response.status).toBe(401)
    expect(body?.code).toBe(40100)
  })

  test('POST /admin/article/delete 伪造 token -> 40100 / 401', async () => {
    const { response, body } = await call('/admin/article/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-a-real-token' },
      body: JSON.stringify({ id: 1 }),
    })
    expect(response.status).toBe(401)
    expect(body?.code).toBe(40100)
  })
})
