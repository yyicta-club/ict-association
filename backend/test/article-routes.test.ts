/**
 * 文章查询与批量删除的接口层测试。
 *
 * 隔离约定：
 * - 通过 `app.request(path, init, { articleStore })` 注入**假数据库句柄**，
 *   本文件完全不连接任何真实数据库（开发库 / 业务库都不碰）
 * - 审计日志同样走注入的句柄，不会往 system_logs 写真实数据
 */
import { describe, expect, test } from 'bun:test'
import { createApp } from '../src/app'
import { env } from '../src/config/env'
import type { ArticleDetailRow, ArticleListRow } from '../src/services/article.service'
import { signAdminToken } from '../src/utils/jwt'
import { ErrorCode } from '../src/utils/response'
import { createFakeStore } from './support/fake-store'
import type { FakeStore } from './support/fake-store'

const app = createApp()

/** 统一响应体 */
type JsonBody = {
  code?: number
  message?: string
  data?: unknown
}

/** 构造一行列表数据 */
function listRow(overrides: Partial<ArticleListRow> = {}): ArticleListRow {
  return {
    id: 7,
    title: '协会公告',
    slug: 'news-1',
    summary: '一段摘要',
    cover_asset_id: null,
    category_id: null,
    status: 1,
    is_top: 0,
    view_count: 3,
    published_at: '2026-11-27 10:00:00',
    created_at: '2026-11-27 09:00:00',
    updated_at: '2026-11-27 10:00:00',
    deleted_at: null,
    ref_category_id: null,
    ref_category_name: null,
    ref_category_slug: null,
    ref_cover_id: null,
    ref_cover_path: null,
    ref_cover_url: null,
    ...overrides,
  }
}

/** 构造一行详情数据 */
function detailRow(overrides: Partial<ArticleDetailRow> = {}): ArticleDetailRow {
  return { ...listRow(), content: '# 正文\n\n内容', ...overrides }
}

/** 生成一个合法管理员 token */
async function adminToken(): Promise<string> {
  const { token } = await signAdminToken(
    { id: 1, username: 'admin', nickname: '系统管理员' },
    env.jwtSecret,
    '1h',
  )
  return token
}

/** 发起一次请求（注入假数据库句柄） */
async function call(
  path: string,
  store: FakeStore,
  init?: RequestInit & { token?: string },
): Promise<{ response: Response; body: JsonBody | null; store: FakeStore }> {
  const headers = new Headers(init?.headers)
  if (init?.token) headers.set('Authorization', `Bearer ${init.token}`)
  const response = await app.request(
    path,
    { ...init, headers },
    { articleStore: store },
  )
  let body: JsonBody | null = null
  try {
    body = (await response.json()) as JsonBody
  } catch {
    body = null
  }
  return { response, body, store }
}

/** 同时响应列表、计数与详情查询的假句柄 */
function createStore(options: { rows?: ArticleListRow[]; detail?: ArticleDetailRow | null } = {}) {
  const rows = options.rows ?? [listRow()]
  return createFakeStore({
    onQuery: (sql) => {
      if (sql.includes('COUNT(*)')) return [{ total: rows.length }]
      if (sql.includes('FOR UPDATE')) return [{ id: 7 }]
      if (sql.includes('SELECT view_count')) return [{ view_count: 42 }]
      if (sql.includes('a.content')) return options.detail === null ? [] : [options.detail ?? detailRow()]
      return rows
    },
  })
}

describe('游客文章接口的公开性', () => {
  test('GET /tourist/articles 无需鉴权即可查询', async () => {
    const store = createStore()
    const { response, body } = await call('/tourist/articles', store)
    expect(response.status).toBe(200)
    expect(body?.code).toBe(0)
  })

  test('列表只返回已发布且未删除的文章', async () => {
    const store = createStore()
    await call('/tourist/articles', store)
    const sql = store.queries[0].sql
    expect(sql).toContain('a.status = ?')
    expect(sql).toContain('a.deleted_at IS NULL')
    expect(store.queries[0].params).toContain(1)
  })

  test('列表返回 items / total / page / pageSize', async () => {
    const store = createStore()
    const { body } = await call('/tourist/articles?page=1&pageSize=20', store)
    const data = body?.data as { items?: unknown[]; total?: number; page?: number; pageSize?: number }
    expect(Array.isArray(data?.items)).toBe(true)
    expect(data?.total).toBe(1)
    expect(data?.page).toBe(1)
    expect(data?.pageSize).toBe(20)
  })

  test('列表项不含正文，但附带分类与封面字段', async () => {
    const store = createStore({
      rows: [
        listRow({
          ref_category_id: 2,
          ref_category_name: '协会公告',
          ref_category_slug: 'announcement',
          ref_cover_id: 9,
          ref_cover_path: 'article/cover.png',
          ref_cover_url: null,
        }),
      ],
    })
    const { body } = await call('/tourist/articles', store)
    const data = body?.data as { items?: Record<string, unknown>[] }
    const item = data?.items?.[0] ?? {}
    expect('content' in item).toBe(false)
    expect(item.category).toEqual({ id: 2, name: '协会公告', slug: 'announcement' })
    expect(item.cover).toEqual({ id: 9, path: 'article/cover.png', url: null })
  })

  test('参数错误在触碰数据库之前返回', async () => {
    for (const path of [
      '/tourist/articles?status=1',
      '/tourist/articles?page=abc',
      '/tourist/articles?page=0',
      '/tourist/articles?pageSize=101',
      '/tourist/articles?page=1&page=2',
    ]) {
      const store = createStore()
      const { response, body } = await call(path, store)
      expect(response.status).toBe(400)
      expect(body?.code).toBe(ErrorCode.BAD_REQUEST)
      expect(store.calls).toHaveLength(0)
    }
  })
})

describe('游客文章详情', () => {
  test('返回正文并递增浏览量', async () => {
    const store = createStore()
    const { response, body } = await call('/tourist/articles/news-1', store)
    expect(response.status).toBe(200)
    const data = body?.data as { content?: string; viewCount?: number }
    expect(data?.content).toBe('# 正文\n\n内容')
    expect(data?.viewCount).toBe(42)
    expect(store.executes[0].sql).toContain('view_count = LEAST(view_count, 4294967294) + 1')
  })

  test('详情响应带 Cache-Control: no-store', async () => {
    const store = createStore()
    const { response } = await call('/tourist/articles/news-1', store)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('HEAD 请求不计数', async () => {
    const store = createStore()
    const { response } = await call('/tourist/articles/news-1', store, { method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(store.executes).toHaveLength(0)
  })

  test('文章不存在或不可见时统一返回 404 / 40403', async () => {
    const store = createStore({ detail: null })
    const { response, body } = await call('/tourist/articles/missing', store)
    expect(response.status).toBe(404)
    expect(body?.code).toBe(ErrorCode.ARTICLE_NOT_FOUND)
  })

  test('slug 格式非法返回 400 且不查询数据库', async () => {
    const store = createStore()
    const { response, body } = await call('/tourist/articles/Invalid-Slug', store)
    expect(response.status).toBe(400)
    expect(body?.code).toBe(ErrorCode.BAD_REQUEST)
    expect(store.calls).toHaveLength(0)
  })
})

describe('后台文章列表与详情', () => {
  test('未携带 token 一律 401', async () => {
    for (const path of ['/admin/article/list', '/admin/article/detail?id=1']) {
      const store = createStore()
      const { response, body } = await call(path, store)
      expect(response.status).toBe(401)
      expect(body?.code).toBe(ErrorCode.UNAUTHORIZED)
      expect(store.calls).toHaveLength(0)
    }
  })

  test('列表省略状态时不加状态条件，但始终排除软删除文章', async () => {
    const store = createStore()
    const token = await adminToken()
    const { response, body } = await call('/admin/article/list', store, { token })
    expect(response.status).toBe(200)
    expect(body?.code).toBe(0)
    const sql = store.queries[0].sql
    expect(sql).toContain('a.deleted_at IS NULL')
    expect(sql).not.toContain('a.status = ?')
  })

  test('列表按状态筛选', async () => {
    const store = createStore()
    const token = await adminToken()
    await call('/admin/article/list?status=2', store, { token })
    expect(store.queries[0].sql).toContain('a.status = ?')
    expect(store.queries[0].params).toContain(2)
  })

  test('列表按关键词匹配标题或摘要', async () => {
    const store = createStore()
    const token = await adminToken()
    await call('/admin/article/list?keyword=100%25', store, { token })
    expect(store.queries[0].sql).toContain("a.title LIKE ? ESCAPE '!'")
    expect(store.queries[0].params).toContain('%100!%%')
  })

  test('列表参数错误返回 400 且不触碰数据库', async () => {
    const token = await adminToken()
    for (const path of [
      '/admin/article/list?sort=id',
      '/admin/article/list?page=1&page=2',
      '/admin/article/list?page=abc',
      '/admin/article/list?pageSize=0',
      '/admin/article/list?status=3',
      '/admin/article/list?category_id=-1',
    ]) {
      const store = createStore()
      const { response, body } = await call(path, store, { token })
      expect(response.status).toBe(400)
      expect(body?.code).toBe(ErrorCode.BAD_REQUEST)
      expect(store.calls).toHaveLength(0)
    }
  })

  test('详情返回正文且不增加浏览量', async () => {
    const store = createStore()
    const token = await adminToken()
    const { response, body } = await call('/admin/article/detail?id=7', store, { token })
    expect(response.status).toBe(200)
    const data = body?.data as { content?: string }
    expect(data?.content).toBe('# 正文\n\n内容')
    expect(store.executes).toHaveLength(0)
  })

  test('详情 id 缺失或非法返回 400', async () => {
    const token = await adminToken()
    for (const path of ['/admin/article/detail', '/admin/article/detail?id=abc', '/admin/article/detail?id=0']) {
      const store = createStore()
      const { response, body } = await call(path, store, { token })
      expect(response.status).toBe(400)
      expect(body?.code).toBe(ErrorCode.BAD_REQUEST)
      expect(store.calls).toHaveLength(0)
    }
  })

  test('详情文章不存在或已删除时返回 404 / 40403', async () => {
    const store = createStore({ detail: null })
    const token = await adminToken()
    const { response, body } = await call('/admin/article/detail?id=7', store, { token })
    expect(response.status).toBe(404)
    expect(body?.code).toBe(ErrorCode.ARTICLE_NOT_FOUND)
  })
})

describe('后台批量软删除', () => {
  test('未携带 token 一律 401', async () => {
    const store = createStore()
    const { response, body } = await call('/admin/article/batch-delete', store, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [1] }),
    })
    expect(response.status).toBe(401)
    expect(body?.code).toBe(ErrorCode.UNAUTHORIZED)
    expect(store.calls).toHaveLength(0)
  })

  test('返回 deletedIds / skippedIds / deletedCount', async () => {
    const store = createFakeStore({
      onQuery: () => [{ id: 1 }, { id: 3 }],
      onExecute: () => ({ affectedRows: 2, insertId: 0 }),
    })
    const token = await adminToken()
    const { response, body } = await call('/admin/article/batch-delete', store, {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [1, 2, 3] }),
    })
    expect(response.status).toBe(200)
    const data = body?.data as { deletedIds?: number[]; skippedIds?: number[]; deletedCount?: number }
    expect(data?.deletedIds).toEqual([1, 3])
    expect(data?.skippedIds).toEqual([2])
    expect(data?.deletedCount).toBe(2)
  })

  test('请求体不合法时返回 400 且不触碰数据库', async () => {
    const token = await adminToken()
    const cases = [
      'not json',
      JSON.stringify({ ids: '1' }),
      JSON.stringify({ ids: [] }),
      JSON.stringify({ ids: ['1'] }),
      JSON.stringify({ ids: [0] }),
      JSON.stringify({ ids: [1], force: true }),
    ]
    for (const body of cases) {
      const store = createStore()
      const { response } = await call('/admin/article/batch-delete', store, {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      expect(response.status).toBe(400)
      expect(store.queries).toHaveLength(0)
      // 参数格式错误在写审计之前返回
      expect(store.executes.filter((item) => item.sql.includes('system_logs'))).toHaveLength(0)
    }
  })

  test('请求体超过 8 KiB 返回 413', async () => {
    const store = createStore()
    const token = await adminToken()
    const { response, body } = await call('/admin/article/batch-delete', store, {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [1], padding: 'x'.repeat(9000) }),
    })
    expect(response.status).toBe(413)
    expect(body?.code).toBe(ErrorCode.REQUEST_TOO_LARGE)
    expect(store.queries).toHaveLength(0)
    expect(store.executes.filter((item) => item.sql.includes('system_logs'))).toHaveLength(0)
  })

  test('只记录操作者、数量与 id，不记录完整请求体', async () => {
    const store = createFakeStore({
      onQuery: () => [{ id: 1 }],
      onExecute: () => ({ affectedRows: 1, insertId: 0 }),
    })
    const token = await adminToken()
    await call('/admin/article/batch-delete', store, {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [1] }),
    })

    const audit = store.executes.find((call) => call.sql.includes('system_logs'))
    expect(audit).toBeDefined()
    const detail = String(audit?.params[7] ?? '')
    expect(detail).toContain('批量删除成功')
    expect(detail).toContain('成功 1 个')
    expect(detail).not.toContain('"ids"')
  })
})
