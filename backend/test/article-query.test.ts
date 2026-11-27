/**
 * 文章查询与批量删除的校验 / 服务层测试。
 *
 * 隔离约定：
 * - 本文件**不连接任何真实数据库**：服务层通过注入的假句柄验证 SQL 与返回映射
 * - 校验函数都是纯函数，任何失败都不会触碰数据库
 */
import { describe, expect, test } from 'bun:test'
import {
  batchSoftDeleteArticles,
  buildArticleListWhere,
  escapeLikePattern,
  getArticleDetail,
  listAdminArticles,
  listPublicArticles,
  readPublicArticleDetail,
  readPublicArticleDetailWithViewCount,
} from '../src/services/article.service'
import type { ArticleDetailRow, ArticleListRow } from '../src/services/article.service'
import {
  ADMIN_ARTICLE_LIST_FIELDS,
  ARTICLE_KEYWORD_MAX_LENGTH,
  ARTICLE_PAGE_MAX,
  ARTICLE_PAGE_SIZE_MAX,
  BATCH_DELETE_MAX_IDS,
  TOURIST_ARTICLE_LIST_FIELDS,
  parseAdminArticleListQuery,
  parseArticleDetailQuery,
  parseBatchDeleteArticleRequest,
  parseTouristArticleListQuery,
} from '../src/utils/article-validation'
import { ErrorCode } from '../src/utils/response'
import { createFakeStore } from './support/fake-store'

/** 构造一行列表数据 */
function listRow(overrides: Partial<ArticleListRow> = {}): ArticleListRow {
  return {
    id: 1,
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

/** 同时响应列表查询与计数查询的假句柄 */
function createListStore(rows: ArticleListRow[], total = rows.length) {
  return createFakeStore({
    onQuery: (sql) => (sql.includes('COUNT(*)') ? [{ total }] : rows),
  })
}

describe('游客文章列表查询参数', () => {
  test('默认分页为 page=1 / pageSize=20', () => {
    const result = parseTouristArticleListQuery('')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({ categoryId: null, page: 1, pageSize: 20 })
  })

  test('接受 category_id / page / pageSize', () => {
    const result = parseTouristArticleListQuery('?category_id=3&page=2&pageSize=50')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({ categoryId: 3, page: 2, pageSize: 50 })
  })

  test('未知参数一律拒绝', () => {
    const result = parseTouristArticleListQuery('?keyword=公告')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('keyword')
    expect(TOURIST_ARTICLE_LIST_FIELDS).not.toContain('keyword')
  })

  test('重复查询参数一律拒绝', () => {
    const result = parseTouristArticleListQuery('?page=1&page=2')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('page')
  })

  test('非法数字与超界分页一律拒绝', () => {
    for (const search of [
      '?page=abc',
      '?page=1.5',
      '?page=-1',
      '?page=0',
      '?page=',
      `?page=${ARTICLE_PAGE_MAX + 1}`,
      '?pageSize=0',
      '?pageSize=101',
      '?pageSize=abc',
      '?category_id=0',
      '?category_id=-1',
      '?category_id=abc',
      '?category_id=1.5',
    ]) {
      expect(parseTouristArticleListQuery(search).ok).toBe(false)
    }
  })

  test('分页边界值合法', () => {
    expect(parseTouristArticleListQuery(`?page=${ARTICLE_PAGE_MAX}`).ok).toBe(true)
    expect(parseTouristArticleListQuery(`?pageSize=${ARTICLE_PAGE_SIZE_MAX}`).ok).toBe(true)
  })
})

describe('后台文章列表查询参数', () => {
  test('省略状态时不筛选状态', () => {
    const result = parseAdminArticleListQuery('')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({
      keyword: null,
      categoryId: null,
      status: null,
      page: 1,
      pageSize: 20,
    })
  })

  test('关键词去首尾空白，空值视为不筛选', () => {
    const trimmed = parseAdminArticleListQuery('?keyword=%20%20公告%20%20')
    expect(trimmed.ok).toBe(true)
    if (trimmed.ok) expect(trimmed.value.keyword).toBe('公告')

    const blank = parseAdminArticleListQuery('?keyword=%20%20')
    expect(blank.ok).toBe(true)
    if (blank.ok) expect(blank.value.keyword).toBeNull()
  })

  test('关键词超过 200 字符一律拒绝', () => {
    const result = parseAdminArticleListQuery(`?keyword=${'a'.repeat(ARTICLE_KEYWORD_MAX_LENGTH + 1)}`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('关键词')
  })

  test('状态只接受 0 / 1 / 2', () => {
    for (const status of ['0', '1', '2'] as const) {
      const result = parseAdminArticleListQuery(`?status=${status}`)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.status as number).toBe(Number(status))
    }
    for (const status of ['3', '-1', '01', 'published', '']) {
      expect(parseAdminArticleListQuery(`?status=${status}`).ok).toBe(false)
    }
  })

  test('未知参数与重复参数一律拒绝', () => {
    const unknown = parseAdminArticleListQuery('?sort=id')
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.message).toContain('sort')

    const duplicated = parseAdminArticleListQuery('?status=1&status=2')
    expect(duplicated.ok).toBe(false)
    expect(ADMIN_ARTICLE_LIST_FIELDS).toContain('status')
  })
})

describe('后台文章详情查询参数', () => {
  test('id 必填且必须是正安全整数', () => {
    expect(parseArticleDetailQuery('?id=123').ok).toBe(true)
    expect(parseArticleDetailQuery('').ok).toBe(false)
    expect(parseArticleDetailQuery('?id=0').ok).toBe(false)
    expect(parseArticleDetailQuery('?id=-1').ok).toBe(false)
    expect(parseArticleDetailQuery('?id=1.5').ok).toBe(false)
    expect(parseArticleDetailQuery('?id=abc').ok).toBe(false)
  })

  test('未知参数与重复参数一律拒绝', () => {
    expect(parseArticleDetailQuery('?id=1&slug=x').ok).toBe(false)
    expect(parseArticleDetailQuery('?id=1&id=2').ok).toBe(false)
  })
})

describe('批量删除请求体解析', () => {
  test('合法数组通过并按首次出现顺序去重', () => {
    const result = parseBatchDeleteArticleRequest({ ids: [3, 1, 3, 2, 1] })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.ids).toEqual([3, 1, 2])
  })

  test('请求体必须是 JSON 对象且只允许 ids', () => {
    expect(parseBatchDeleteArticleRequest(null).ok).toBe(false)
    expect(parseBatchDeleteArticleRequest([]).ok).toBe(false)
    expect(parseBatchDeleteArticleRequest('ids').ok).toBe(false)

    const unknown = parseBatchDeleteArticleRequest({ ids: [1], force: true })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.message).toContain('force')
  })

  test('ids 必须是数组，且原始长度在 1..100 之间', () => {
    expect(parseBatchDeleteArticleRequest({ ids: '1' }).ok).toBe(false)
    expect(parseBatchDeleteArticleRequest({ ids: [] }).ok).toBe(false)

    const tooMany = parseBatchDeleteArticleRequest({
      ids: Array.from({ length: BATCH_DELETE_MAX_IDS + 1 }, (_, index) => index + 1),
    })
    expect(tooMany.ok).toBe(false)

    const exact = parseBatchDeleteArticleRequest({
      ids: Array.from({ length: BATCH_DELETE_MAX_IDS }, (_, index) => index + 1),
    })
    expect(exact.ok).toBe(true)
  })

  test('每一项都必须是数字类型的正安全整数', () => {
    for (const ids of [[0], [-1], [1.5], ['1'], [true], [null]]) {
      expect(parseBatchDeleteArticleRequest({ ids }).ok).toBe(false)
    }
  })

  test('先完整校验再返回：任一项非法则整体失败', () => {
    const result = parseBatchDeleteArticleRequest({ ids: [1, 2, 'x'] })
    expect(result.ok).toBe(false)
  })
})

describe('列表筛选构建（权限条件由服务端固定）', () => {
  test('游客端固定只看已发布且未删除', () => {
    const where = buildArticleListWhere('public', {
      keyword: null,
      categoryId: null,
      status: null,
    })
    expect(where.sql).toContain('a.deleted_at IS NULL')
    expect(where.sql).toContain('a.status = ?')
    expect(where.params).toEqual([1])
  })

  test('后台端始终排除软删除文章，省略状态时不加状态条件', () => {
    const where = buildArticleListWhere('admin', {
      keyword: null,
      categoryId: null,
      status: null,
    })
    expect(where.sql).toContain('a.deleted_at IS NULL')
    expect(where.sql).not.toContain('a.status = ?')
    expect(where.params).toEqual([])
  })

  test('后台端按状态精确筛选', () => {
    const where = buildArticleListWhere('admin', {
      keyword: null,
      categoryId: null,
      status: 2,
    })
    expect(where.sql).toContain('a.status = ?')
    expect(where.params).toEqual([2])
  })

  test('分类按 id 精确筛选', () => {
    const where = buildArticleListWhere('public', {
      keyword: null,
      categoryId: 7,
      status: null,
    })
    expect(where.sql).toContain('a.category_id = ?')
    expect(where.params).toEqual([1, 7])
  })

  test('关键词匹配标题或摘要，% 与 _ 按普通字符处理', () => {
    const where = buildArticleListWhere('admin', {
      keyword: '100%_x',
      categoryId: null,
      status: null,
    })
    expect(where.sql).toContain("a.title LIKE ? ESCAPE '!'")
    expect(where.sql).toContain("a.summary LIKE ? ESCAPE '!'")
    expect(where.params).toEqual(['%100!%!_x%', '%100!%!_x%'])
  })

  test('转义函数只处理 ! % _ 三个字符', () => {
    expect(escapeLikePattern('100%')).toBe('100!%')
    expect(escapeLikePattern('a_b')).toBe('a!_b')
    expect(escapeLikePattern('a!b')).toBe('a!!b')
    expect(escapeLikePattern('普通文字')).toBe('普通文字')
  })
})

describe('列表查询（服务层）', () => {
  test('列表 SQL 不读取正文，并按固定顺序排序', async () => {
    const store = createListStore([listRow()])
    await listPublicArticles({ categoryId: null, page: 1, pageSize: 20 }, store)

    const listSql = store.queries[0].sql
    expect(listSql).not.toContain('a.content')
    expect(listSql).toContain('ORDER BY a.is_top DESC, a.published_at DESC, a.id DESC')
    expect(listSql).toContain('LEFT JOIN categories c ON c.id = a.category_id')
    expect(listSql).toContain('LEFT JOIN static_assets s ON s.id = a.cover_asset_id')
    expect(listSql).not.toContain('s.deleted_at')
  })

  test('后台列表按创建时间倒序排序', async () => {
    const store = createListStore([listRow()])
    await listAdminArticles(
      { keyword: null, categoryId: null, status: null, page: 1, pageSize: 20 },
      store,
    )
    expect(store.queries[0].sql).toContain('ORDER BY a.is_top DESC, a.created_at DESC, a.id DESC')
  })

  test('分页参数与偏移量正确绑定', async () => {
    const store = createListStore([])
    await listPublicArticles({ categoryId: null, page: 3, pageSize: 10 }, store)
    // 游客端固定带 status = 1，随后是 LIMIT / OFFSET
    expect(store.queries[0].params).toEqual([1, 10, 20])
  })

  test('返回 items / total / page / pageSize', async () => {
    const store = createListStore([listRow()], 42)
    const result = await listPublicArticles({ categoryId: null, page: 1, pageSize: 20 }, store)
    expect(result.total).toBe(42)
    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(20)
    expect(result.items).toHaveLength(1)
  })

  test('关联信息缺失时返回 null', async () => {
    const store = createListStore([listRow()])
    const result = await listPublicArticles({ categoryId: null, page: 1, pageSize: 20 }, store)
    expect(result.items[0].category).toBeNull()
    expect(result.items[0].cover).toBeNull()
  })

  test('关联信息存在时返回精简结构，且不拼接访问域名', async () => {
    const store = createListStore([
      listRow({
        category_id: 2,
        ref_category_id: 2,
        ref_category_name: '协会公告',
        ref_category_slug: 'announcement',
        cover_asset_id: 9,
        ref_cover_id: 9,
        ref_cover_path: 'article/cover.png',
        ref_cover_url: null,
      }),
    ])
    const result = await listPublicArticles({ categoryId: null, page: 1, pageSize: 20 }, store)
    expect(result.items[0].category).toEqual({ id: 2, name: '协会公告', slug: 'announcement' })
    expect(result.items[0].cover).toEqual({ id: 9, path: 'article/cover.png', url: null })
  })

  test('列表项不含正文', async () => {
    const store = createListStore([listRow()])
    const result = await listPublicArticles({ categoryId: null, page: 1, pageSize: 20 }, store)
    expect('content' in result.items[0]).toBe(false)
  })
})

describe('文章详情（服务层）', () => {
  test('后台详情包含正文', async () => {
    const store = createFakeStore({ onQuery: () => [detailRow()] })
    const detail = await getArticleDetail(1, store)
    expect(detail.content).toBe('# 正文\n\n内容')
  })

  test('后台详情不增加浏览量', async () => {
    const store = createFakeStore({ onQuery: () => [detailRow()] })
    await getArticleDetail(1, store)
    expect(store.executes).toHaveLength(0)
    expect(store.connection.begun).toBe(false)
  })

  test('后台详情查询排除软删除文章', async () => {
    const store = createFakeStore({ onQuery: () => [] })
    await expect(getArticleDetail(1, store)).rejects.toMatchObject({
      code: ErrorCode.ARTICLE_NOT_FOUND,
    })
    expect(store.queries[0].sql).toContain('a.deleted_at IS NULL')
  })

  test('游客详情只返回已发布且未删除的文章', async () => {
    const store = createFakeStore({ onQuery: () => [] })
    await expect(readPublicArticleDetail('news-1', store)).rejects.toMatchObject({
      code: ErrorCode.ARTICLE_NOT_FOUND,
    })
    expect(store.queries[0].sql).toContain('a.status = ?')
    expect(store.queries[0].sql).toContain('a.deleted_at IS NULL')
    expect(store.queries[0].params).toEqual(['news-1', 1])
  })

  test('游客详情（不计数）不写库、不开事务', async () => {
    const store = createFakeStore({ onQuery: () => [detailRow()] })
    const detail = await readPublicArticleDetail('news-1', store)
    expect(detail.content).toBe('# 正文\n\n内容')
    expect(store.executes).toHaveLength(0)
    expect(store.connection.begun).toBe(false)
  })
})

describe('浏览量自增（短事务）', () => {
  /** 依次响应：锁定行 -> 回读浏览量 -> 回读详情 */
  function createViewCountStore(viewCount = 42) {
    return createFakeStore({
      onQuery: (sql) => {
        if (sql.includes('FOR UPDATE')) return [{ id: 7 }]
        if (sql.includes('SELECT view_count')) return [{ view_count: viewCount }]
        return [detailRow({ id: 7 })]
      },
    })
  }

  test('GET 自增浏览量并在事务内回读', async () => {
    const store = createViewCountStore(43)
    const detail = await readPublicArticleDetailWithViewCount('news-1', store)

    expect(detail.viewCount).toBe(43)
    expect(store.connection.begun).toBe(true)
    expect(store.connection.committed).toBe(true)
    expect(store.connection.rolledBack).toBe(false)
    expect(store.connection.released).toBe(true)
  })

  test('自增语句不修改 updated_at，且到达上限时保持上限', async () => {
    const store = createViewCountStore()
    await readPublicArticleDetailWithViewCount('news-1', store)

    const update = store.executes[0]
    expect(update.sql).toContain('view_count = LEAST(view_count, 4294967294) + 1')
    expect(update.sql).toContain('updated_at = updated_at')
    expect(update.params).toEqual([7])
  })

  test('锁定查询使用 FOR UPDATE，避免并发丢计数', async () => {
    const store = createViewCountStore()
    await readPublicArticleDetailWithViewCount('news-1', store)
    expect(store.queries[0].sql).toContain('FOR UPDATE')
    expect(store.queries[0].inTransaction).toBe(true)
  })

  test('文章不可见时回滚并释放连接', async () => {
    const store = createFakeStore({ onQuery: () => [] })
    await expect(readPublicArticleDetailWithViewCount('news-1', store)).rejects.toMatchObject({
      code: ErrorCode.ARTICLE_NOT_FOUND,
    })
    expect(store.connection.rolledBack).toBe(true)
    expect(store.connection.committed).toBe(false)
    expect(store.connection.released).toBe(true)
  })

  test('事务中途失败时回滚并释放连接', async () => {
    const store = createFakeStore({
      onQuery: (sql) => {
        if (sql.includes('FOR UPDATE')) return [{ id: 7 }]
        throw new Error('boom')
      },
    })
    await expect(readPublicArticleDetailWithViewCount('news-1', store)).rejects.toThrow('boom')
    expect(store.connection.rolledBack).toBe(true)
    expect(store.connection.released).toBe(true)
  })
})

describe('批量软删除（服务层）', () => {
  /** 依次响应：锁定行 */
  function createBatchStore(existingIds: number[]) {
    return createFakeStore({
      onQuery: () => existingIds.map((id) => ({ id })),
      onExecute: () => ({ affectedRows: existingIds.length, insertId: 0 }),
    })
  }

  test('混合有效与无效 id：无效 id 记入 skippedIds', async () => {
    const store = createBatchStore([1, 3])
    const result = await batchSoftDeleteArticles([1, 2, 3], store)
    expect(result.deletedIds).toEqual([1, 3])
    expect(result.skippedIds).toEqual([2])
    expect(result.deletedCount).toBe(2)
  })

  test('重复 id 只删除一次，返回数组按去重后的输入顺序', async () => {
    const store = createBatchStore([1, 2])
    const result = await batchSoftDeleteArticles([2, 1, 2], store)
    expect(result.deletedIds).toEqual([2, 1])
    expect(result.deletedCount).toBe(2)
    expect(store.executes[0].params).toEqual([1, 2])
  })

  test('全部跳过时依然返回成功', async () => {
    const store = createBatchStore([])
    const result = await batchSoftDeleteArticles([5, 6], store)
    expect(result.deletedIds).toEqual([])
    expect(result.skippedIds).toEqual([5, 6])
    expect(result.deletedCount).toBe(0)
    expect(store.executes).toHaveLength(0)
    expect(store.connection.committed).toBe(true)
  })

  test('锁定顺序按 id 升序，避免重叠批量删除死锁', async () => {
    const store = createBatchStore([1, 2, 3])
    await batchSoftDeleteArticles([3, 1, 2], store)
    expect(store.queries[0].sql).toContain('ORDER BY id ASC')
    expect(store.queries[0].sql).toContain('FOR UPDATE')
    expect(store.queries[0].params).toEqual([1, 2, 3])
  })

  test('只写 deleted_at，评论与标签关联不受影响', async () => {
    const store = createBatchStore([1])
    await batchSoftDeleteArticles([1], store)
    const update = store.executes[0].sql
    expect(update).toContain('SET deleted_at = NOW()')
    expect(update).not.toContain('comments')
    expect(update).not.toContain('article_tags')
    expect(update).not.toContain('DELETE')
  })

  test('数据库失败时整批回滚并释放连接', async () => {
    const store = createFakeStore({
      onQuery: () => [{ id: 1 }],
      executeError: new Error('db down'),
    })
    await expect(batchSoftDeleteArticles([1], store)).rejects.toThrow('db down')
    expect(store.connection.rolledBack).toBe(true)
    expect(store.connection.committed).toBe(false)
    expect(store.connection.released).toBe(true)
  })
})
