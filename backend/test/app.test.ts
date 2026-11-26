/**
 * 接口层集成测试：不依赖 MySQL。
 *
 * 覆盖应用装配本身：路由挂载、统一响应体、404、鉴权中间件、CORS 白名单。
 * 数据库相关分支由 /health 的降级逻辑与登录接口的 500 兜底覆盖。
 *
 * 重要：test/setup.ts 在应用导入前已把 src/db 替换为内存假数据库、
 * 把系统日志替换为内存记录，因此本文件的所有用例都不会访问任何真实数据库。
 */
import { describe, expect, test } from 'bun:test'
import { createApp } from '../src/app'
import { env } from '../src/config/env'
import { execute } from '../src/db'
import { signAdminToken } from '../src/utils/jwt'

const app = createApp()

/**
 * 删除测试过程中创建的临时管理员账户。
 * 这里的 execute 已被 test/setup.ts 替换为内存假库，不会碰到真实数据库。
 */
async function cleanupTestAdmin(username: string): Promise<void> {
  try {
    await execute('DELETE FROM admins WHERE username = ?', [username])
  } catch {
    // 清理失败不影响测试结论
  }
}

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

// ---------- 管理员账户管理接口 ----------

/** 生成一个合法管理员 token，用于访问受保护接口 */
async function adminToken(): Promise<string> {
  const { token } = await signAdminToken(
    { id: 1, username: 'admin', nickname: '系统管理员' },
    env.jwtSecret,
    '1h',
  )
  return token
}

/**
 * 生成一个指向"不存在管理员"的 token。
 *
 * 用它访问写接口时，服务层只会查一次库就返回 404，
 * 因此测试可以覆盖到业务分支，又不会对数据库产生任何写操作
 * （数据库已被替换为内存假库，测试绝不污染真实数据）。
 */
async function ghostToken(): Promise<string> {
  const { token } = await signAdminToken(
    { id: 999999999, username: 'ghost', nickname: null },
    env.jwtSecret,
    '1h',
  )
  return token
}

/** 带 token 的 JSON POST */
async function callJson(path: string, payload: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return call(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
}

describe('POST /admin/user/create 鉴权', () => {
  test('无 Authorization -> 40100 / 401', async () => {
    const { response, body } = await call('/admin/user/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'editor01', password: 'Passw0rd!' }),
    })
    expect(response.status).toBe(401)
    expect(body?.code).toBe(40100)
  })

  test('伪造 token -> 40100 / 401', async () => {
    const { response, body } = await call('/admin/user/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-a-real-token' },
      body: JSON.stringify({ username: 'editor01', password: 'Passw0rd!' }),
    })
    expect(response.status).toBe(401)
    expect(body?.code).toBe(40100)
  })
})

describe('POST /admin/user/create 参数校验', () => {
  test('非法 JSON -> 40000 / 400', async () => {
    const token = await adminToken()
    const { response, body } = await call('/admin/user/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: 'not-json',
    })
    expect(response.status).toBe(400)
    expect(body?.code).toBe(40000)
    expect(body?.message).toBe('请求体必须是合法的 JSON')
  })

  test('请求体不是 JSON 对象 -> 40000 / 400', async () => {
    const token = await adminToken()
    const { response, body } = await callJson('/admin/user/create', ['admin'], token)
    expect(response.status).toBe(400)
    expect(body?.code).toBe(40000)
  })

  test('缺少用户名 -> 40000 / 400', async () => {
    const token = await adminToken()
    const { response, body } = await callJson('/admin/user/create', { password: 'Passw0rd!' }, token)
    expect(response.status).toBe(400)
    expect(body?.code).toBe(40000)
    expect(body?.message).toBe('用户名不能为空')
  })

  test('缺少密码 -> 40000 / 400', async () => {
    const token = await adminToken()
    const { response, body } = await callJson('/admin/user/create', { username: 'editor01' }, token)
    expect(response.status).toBe(400)
    expect(body?.code).toBe(40000)
    expect(body?.message).toBe('密码不能为空')
  })

  test('密码不足 8 位 -> 40000 / 400', async () => {
    const token = await adminToken()
    const { response, body } = await callJson(
      '/admin/user/create',
      { username: 'editor01', password: 'short' },
      token,
    )
    expect(response.status).toBe(400)
    expect(body?.code).toBe(40000)
    expect(body?.message).toBe('密码至少 8 位')
  })

  test('用户名字符非法 -> 40000 / 400', async () => {
    const token = await adminToken()
    const { response, body } = await callJson(
      '/admin/user/create',
      { username: 'editor 01!', password: 'Passw0rd!' },
      token,
    )
    expect(response.status).toBe(400)
    expect(body?.code).toBe(40000)
  })

  test('邮箱格式错误 -> 40000 / 400', async () => {
    const token = await adminToken()
    const { response, body } = await callJson(
      '/admin/user/create',
      { username: 'editor01', password: 'Passw0rd!', email: 'not-an-email' },
      token,
    )
    expect(response.status).toBe(400)
    expect(body?.code).toBe(40000)
    expect(body?.message).toBe('邮箱格式不正确')
  })

  test('参数合法 -> 进入业务分支（成功 / 冲突 / 数据库不可用兜底）', async () => {
    const token = await adminToken()
    // 使用当前登录管理员自己的用户名，必然命中唯一约束 -> 409，不会新增账户
    const { response, body } = await callJson(
      '/admin/user/create',
      { username: 'admin', password: 'Passw0rd!' },
      token,
    )
    expect([200, 409, 500].includes(response.status)).toBe(true)
    expect(typeof body?.code).toBe('number')
    if (response.status === 409) {
      expect(body?.code).toBe(40901)
      expect(body?.message).toBe('账户名已存在')
      expect(body?.data).toBeNull()
    }
    if (response.status === 500) {
      expect(body?.code).toBe(50000)
      expect(JSON.stringify(body).includes('stack')).toBe(false)
    }
  })

  test('创建成功 -> 返回 id / username / email，且不泄露密码哈希', async () => {
    const token = await adminToken()
    const username = `test_tmp_${Date.now().toString(36)}`
    const { response, body } = await callJson(
      '/admin/user/create',
      { username, password: 'Passw0rd!', email: `${username}@example.com` },
      token,
    )
    try {
      expect(response.status).toBe(200)
      expect(body?.code).toBe(0)
      expect(body?.message).toBe('创建成功')
      const data = body?.data as { id?: number; username?: string; email?: string } | null
      expect(typeof data?.id).toBe('number')
      expect(data?.username).toBe(username)
      expect(data?.email).toBe(`${username}@example.com`)
      // 绝不回传 password_hash
      expect(JSON.stringify(body)).not.toContain('password')
      expect(JSON.stringify(body)).not.toContain('hash')
    } finally {
      // 无论断言是否通过都清理掉临时账户
      await cleanupTestAdmin(username)
    }
  })
})

describe('POST /admin/user/settings 鉴权', () => {
  test('无 Authorization -> 40100 / 401', async () => {
    const { response, body } = await call('/admin/user/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'newname' }),
    })
    expect(response.status).toBe(401)
    expect(body?.code).toBe(40100)
  })

  test('伪造 token -> 40100 / 401', async () => {
    const { response, body } = await call('/admin/user/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-a-real-token' },
      body: JSON.stringify({ username: 'newname' }),
    })
    expect(response.status).toBe(401)
    expect(body?.code).toBe(40100)
  })
})

describe('POST /admin/user/settings 参数校验', () => {
  test('非法 JSON -> 40000 / 400', async () => {
    const token = await adminToken()
    const { response, body } = await call('/admin/user/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: 'not-json',
    })
    expect(response.status).toBe(400)
    expect(body?.code).toBe(40000)
    expect(body?.message).toBe('请求体必须是合法的 JSON')
  })

  test('三个字段都未提供 -> 40000 / 400', async () => {
    const token = await adminToken()
    const { response, body } = await callJson('/admin/user/settings', {}, token)
    expect(response.status).toBe(400)
    expect(body?.code).toBe(40000)
    expect(body?.message).toBe('至少需要提供一个要修改的字段')
  })

  test('用户名为空串 -> 40000 / 400', async () => {
    const token = await adminToken()
    const { response, body } = await callJson('/admin/user/settings', { username: '   ' }, token)
    expect(response.status).toBe(400)
    expect(body?.code).toBe(40000)
    expect(body?.message).toBe('用户名不能为空')
  })

  test('密码不足 8 位 -> 40000 / 400', async () => {
    const token = await adminToken()
    const { response, body } = await callJson('/admin/user/settings', { password: 'short' }, token)
    expect(response.status).toBe(400)
    expect(body?.code).toBe(40000)
    expect(body?.message).toBe('密码至少 8 位')
  })

  test('邮箱格式错误 -> 40000 / 400', async () => {
    const token = await adminToken()
    const { response, body } = await callJson('/admin/user/settings', { email: 'bad@' }, token)
    expect(response.status).toBe(400)
    expect(body?.code).toBe(40000)
    expect(body?.message).toBe('邮箱格式不正确')
  })

  test('只传密码 -> 校验通过并进入业务分支', async () => {
    const token = await ghostToken()
    const { response, body } = await callJson('/admin/user/settings', { password: 'NewPass123' }, token)
    // 幽灵 id 一定查不到记录 -> 404；数据库不可用时由全局 onError 兜底 500
    expect([404, 500].includes(response.status)).toBe(true)
    expect(typeof body?.code).toBe('number')
    if (response.status === 404) {
      expect(body?.code).toBe(40401)
      expect(body?.message).toBe('管理员不存在')
      expect(body?.data).toBeNull()
    }
    if (response.status === 500) {
      expect(body?.code).toBe(50000)
      expect(JSON.stringify(body).includes('stack')).toBe(false)
    }
  })

  test('只传邮箱（清空语义）-> 校验通过并进入业务分支', async () => {
    const token = await ghostToken()
    const { response, body } = await callJson('/admin/user/settings', { email: '' }, token)
    expect([404, 500].includes(response.status)).toBe(true)
    expect(body?.message).not.toBe('邮箱格式不正确')
  })

  test('账户名 + 邮箱组合 -> 校验通过并进入业务分支', async () => {
    const token = await ghostToken()
    const { response, body } = await callJson(
      '/admin/user/settings',
      { username: 'ghost-renamed', email: 'ghost@example.com' },
      token,
    )
    expect([404, 500].includes(response.status)).toBe(true)
    expect(typeof body?.code).toBe('number')
  })
})
