/**
 * 游客端文章路由：
 * - GET /tourist/articles        已发布文章列表（分类筛选 + 分页）
 * - GET /tourist/articles/:slug  文章详情（同时递增浏览量）
 *
 * 安全约定：
 * - 公开接口，只返回 `status = 1`（已发布）且 `deleted_at IS NULL` 的文章
 * - 列表 SQL 不读正文；详情才回显原始 Markdown
 * - 浏览量按每次有效 GET 计数，不按用户或 IP 去重；HEAD / OPTIONS 不计数
 * - 详情响应带 `Cache-Control: no-store`，避免 CDN / 浏览器缓存住计数的响应
 * - 参数格式错误在调用文章服务之前返回，不产生任何数据库读写
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import {
  listPublicArticles,
  readPublicArticleDetail,
  readPublicArticleDetailWithViewCount,
} from '../../services/article.service'
import type { HonoEnv } from '../../types'
import { parseTouristArticleListQuery, validateArticleSlug } from '../../utils/article-validation'
import { AppError, ErrorCode, failure, success } from '../../utils/response'

export const touristArticleRoutes = new Hono<HonoEnv>()

/** 取当前请求的查询字符串（含前导 `?`，没有则为空串） */
function searchOf(c: Context<HonoEnv>): string {
  return new URL(c.req.url).search
}

// ---------- GET /tourist/articles ----------
touristArticleRoutes.get('/', async (c) => {
  // 1. 纯函数校验：失败时不触碰数据库
  const parsed = parseTouristArticleListQuery(searchOf(c))
  if (!parsed.ok) {
    return c.json(failure(ErrorCode.BAD_REQUEST, parsed.message), 400)
  }

  // 2. 只返回已发布且未删除的文章（可见范围由服务端固定）
  try {
    const result = await listPublicArticles(parsed.value, c.env?.articleStore)
    return c.json(success(result, '查询成功'), 200)
  } catch (error) {
    if (error instanceof AppError) {
      return c.json(failure(error.code, error.message), error.status)
    }
    throw error
  }
})

// ---------- GET /tourist/articles/:slug ----------
touristArticleRoutes.get('/:slug', async (c) => {
  // 1. slug 复用既有规则校验：格式不合法直接 400，不查询数据库
  const slug = validateArticleSlug(c.req.param('slug'))
  if (!slug.ok) {
    return c.json(failure(ErrorCode.BAD_REQUEST, slug.message), 400)
  }

  // 2. 只在真正的 GET 请求上计数（HEAD / OPTIONS 不计数）
  const shouldCount = c.req.method === 'GET'

  try {
    const article = shouldCount
      ? await readPublicArticleDetailWithViewCount(slug.value, c.env?.articleStore)
      : await readPublicArticleDetail(slug.value, c.env?.articleStore)

    // 详情带浏览量，任何缓存都会让计数失真
    c.header('Cache-Control', 'no-store')
    return c.json(success(article, '查询成功'), 200)
  } catch (error) {
    if (error instanceof AppError) {
      c.header('Cache-Control', 'no-store')
      return c.json(failure(error.code, error.message), error.status)
    }
    throw error
  }
})
