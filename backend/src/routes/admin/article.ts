/**
 * 管理员文章路由：
 * - GET  /admin/article/list          分页查询文章
 * - GET  /admin/article/detail         按 id 查询文章详情（含正文）
 * - POST /admin/article/create         创建文章
 * - POST /admin/article/setting        部分修改文章
 * - POST /admin/article/delete         软删除文章
 * - POST /admin/article/batch-delete   批量软删除文章
 *
 * 约定：
 * - 整组路由统一挂 adminAuth，未登录一律 401
 * - 参数校验在路由层完成（复用 utils/article-validation 的纯函数），
 *   任何校验失败都在触碰数据库之前就返回 400
 * - 业务异常（AppError）在此转成统一响应体，其余异常交给全局 onError 兜底
 * - 审计日志只记录操作名、文章 id、数量与变更字段，绝不记录正文或完整请求体
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import { adminAuth } from '../../middlewares/auth'
import {
  batchSoftDeleteArticles,
  createArticle,
  getArticleDetail,
  listAdminArticles,
  softDeleteArticle,
  updateArticle,
} from '../../services/article.service'
import type { CreateArticleInput, UpdateArticleInput } from '../../services/article.service'
import { recordSystemLog } from '../../services/system-log.service'
import type { HonoEnv } from '../../types'
import {
  BATCH_DELETE_BODY_MAX_BYTES,
  parseAdminArticleListQuery,
  parseArticleDetailQuery,
  parseBatchDeleteArticleRequest,
  parseCreateArticleRequest,
  parseDeleteArticleRequest,
  parseUpdateArticleRequest,
} from '../../utils/article-validation'
import { readLimitedBody } from '../../utils/multipart'
import { getClientIp, getRequestPath } from '../../utils/request'
import { AppError, ErrorCode, failure, success } from '../../utils/response'

export const adminArticleRoutes = new Hono<HonoEnv>()

// 整组接口都要登录后才能操作
adminArticleRoutes.use('*', adminAuth)

/**
 * 解析 JSON 请求体。
 * 解析失败返回 null，由调用方转成 400。
 */
async function readJsonBody(c: Context<HonoEnv>): Promise<unknown> {
  try {
    return await c.req.json<unknown>()
  } catch {
    return null
  }
}

/** 取当前请求的查询字符串（含前导 `?`，没有则为空串） */
function searchOf(c: Context<HonoEnv>): string {
  return new URL(c.req.url).search
}

/**
 * 写审计日志。
 *
 * 详情只允许出现文章 id、状态、变更字段名等元信息：
 * 绝不写入正文、标题、摘要等用户内容，也不写入完整请求体。
 */
function writeAuditLog(
  c: Context<HonoEnv>,
  operation: string,
  level: 'INFO' | 'WARN',
  statusCode: number,
  detail: string,
): Promise<void> {
  return recordSystemLog(
    {
      level,
      operation,
      module: 'article',
      operatorId: c.get('admin') ? Number(c.get('admin').sub) : null,
      ip: getClientIp(c),
      requestPath: getRequestPath(c),
      statusCode,
      detail,
    },
    c.env?.articleStore,
  )
}

// ---------- GET /admin/article/list ----------
adminArticleRoutes.get('/list', async (c) => {
  // 1. 纯函数校验：失败时不触碰数据库
  const parsed = parseAdminArticleListQuery(searchOf(c))
  if (!parsed.ok) {
    return c.json(failure(ErrorCode.BAD_REQUEST, parsed.message), 400)
  }

  // 2. 始终排除软删除文章；省略状态时查询草稿 / 已发布 / 已下架
  try {
    const result = await listAdminArticles(parsed.value, c.env?.articleStore)
    return c.json(success(result, '查询成功'), 200)
  } catch (error) {
    if (error instanceof AppError) {
      return c.json(failure(error.code, error.message), error.status)
    }
    throw error
  }
})

// ---------- GET /admin/article/detail ----------
adminArticleRoutes.get('/detail', async (c) => {
  // 1. 纯函数校验：失败时不触碰数据库
  const parsed = parseArticleDetailQuery(searchOf(c))
  if (!parsed.ok) {
    return c.json(failure(ErrorCode.BAD_REQUEST, parsed.message), 400)
  }

  // 2. 返回未删除文章的完整内容（不增加浏览量）
  try {
    const article = await getArticleDetail(parsed.value.id, c.env?.articleStore)
    return c.json(success(article, '查询成功'), 200)
  } catch (error) {
    if (error instanceof AppError) {
      return c.json(failure(error.code, error.message), error.status)
    }
    throw error
  }
})

// ---------- POST /admin/article/create ----------
adminArticleRoutes.post('/create', async (c) => {
  const body = await readJsonBody(c)
  if (body === null) {
    await writeAuditLog(c, '创建文章', 'WARN', 400, '参数校验失败: 请求体不是合法 JSON')
    return c.json(failure(ErrorCode.BAD_REQUEST, '请求体必须是合法的 JSON'), 400)
  }

  // 1. 纯函数校验：失败时不触碰数据库
  const parsed = parseCreateArticleRequest(body)
  if (!parsed.ok) {
    await writeAuditLog(c, '创建文章', 'WARN', 400, `参数校验失败: ${parsed.message}`)
    return c.json(failure(ErrorCode.BAD_REQUEST, parsed.message), 400)
  }

  // 2. 业务处理（关联资源校验 + 落库）
  const input: CreateArticleInput = parsed.value
  try {
    const article = await createArticle(input)
    await writeAuditLog(
      c,
      '创建文章',
      'INFO',
      200,
      `创建成功: id=${article.id}, status=${article.status}, is_top=${article.isTop ? 1 : 0}`,
    )
    return c.json(success(article, '创建成功'), 200)
  } catch (error) {
    if (error instanceof AppError) {
      await writeAuditLog(c, '创建文章', 'WARN', error.status, `创建文章失败: ${error.message}`)
      return c.json(failure(error.code, error.message), error.status)
    }
    throw error
  }
})

// ---------- POST /admin/article/setting ----------
adminArticleRoutes.post('/setting', async (c) => {
  const body = await readJsonBody(c)
  if (body === null) {
    await writeAuditLog(c, '修改文章', 'WARN', 400, '参数校验失败: 请求体不是合法 JSON')
    return c.json(failure(ErrorCode.BAD_REQUEST, '请求体必须是合法的 JSON'), 400)
  }

  // 1. 纯函数校验：失败时不触碰数据库
  const parsed = parseUpdateArticleRequest(body)
  if (!parsed.ok) {
    await writeAuditLog(c, '修改文章', 'WARN', 400, `参数校验失败: ${parsed.message}`)
    return c.json(failure(ErrorCode.BAD_REQUEST, parsed.message), 400)
  }

  // 2. 业务处理（只更新请求中提供的字段）
  const { id, ...rest } = parsed.value
  const input: UpdateArticleInput = rest
  try {
    const result = await updateArticle(id, input)
    await writeAuditLog(
      c,
      '修改文章',
      'INFO',
      200,
      `修改成功: id=${id}, 变更字段: ${result.changedFields.join(', ') || '无'}`,
    )
    return c.json(success({ ...result.article, changedFields: result.changedFields }, '修改成功'), 200)
  } catch (error) {
    if (error instanceof AppError) {
      await writeAuditLog(c, '修改文章', 'WARN', error.status, `修改文章失败: ${error.message}`)
      return c.json(failure(error.code, error.message), error.status)
    }
    throw error
  }
})

// ---------- POST /admin/article/delete ----------
adminArticleRoutes.post('/delete', async (c) => {
  const body = await readJsonBody(c)
  if (body === null) {
    await writeAuditLog(c, '删除文章', 'WARN', 400, '参数校验失败: 请求体不是合法 JSON')
    return c.json(failure(ErrorCode.BAD_REQUEST, '请求体必须是合法的 JSON'), 400)
  }

  // 1. 纯函数校验：失败时不触碰数据库
  const parsed = parseDeleteArticleRequest(body)
  if (!parsed.ok) {
    await writeAuditLog(c, '删除文章', 'WARN', 400, `参数校验失败: ${parsed.message}`)
    return c.json(failure(ErrorCode.BAD_REQUEST, parsed.message), 400)
  }

  // 2. 业务处理（只写 deleted_at 标记）
  const { id } = parsed.value
  try {
    const article = await softDeleteArticle(id)
    await writeAuditLog(c, '删除文章', 'INFO', 200, `删除成功: id=${id}`)
    return c.json(success(article, '删除成功'), 200)
  } catch (error) {
    if (error instanceof AppError) {
      await writeAuditLog(c, '删除文章', 'WARN', error.status, `删除文章失败: ${error.message}`)
      return c.json(failure(error.code, error.message), error.status)
    }
    throw error
  }
})

// ---------- POST /admin/article/batch-delete ----------
adminArticleRoutes.post('/batch-delete', async (c) => {
  // 1. 限长读取请求体（8 KiB）：按**实际读到的字节数**判断，不信任 Content-Length
  let bodyText: string
  try {
    const bytes = await readLimitedBody(c.req.raw, BATCH_DELETE_BODY_MAX_BYTES)
    bodyText = new TextDecoder().decode(bytes)
  } catch (error) {
    // 请求体不合法：在调用文章服务与写审计之前直接返回
    if (error instanceof AppError) {
      return c.json(failure(error.code, error.message), error.status)
    }
    throw error
  }

  let body: unknown
  try {
    body = JSON.parse(bodyText) as unknown
  } catch {
    return c.json(failure(ErrorCode.BAD_REQUEST, '请求体必须是合法的 JSON'), 400)
  }

  // 2. 纯函数校验：失败时不触碰数据库，也不写审计
  const parsed = parseBatchDeleteArticleRequest(body)
  if (!parsed.ok) {
    return c.json(failure(ErrorCode.BAD_REQUEST, parsed.message), 400)
  }

  // 3. 业务处理：同一事务内按 id 升序锁定有效文章并统一软删除
  const { ids } = parsed.value
  try {
    const result = await batchSoftDeleteArticles(ids, c.env?.articleStore)
    await writeAuditLog(
      c,
      '批量删除文章',
      'INFO',
      200,
      `批量删除成功: 请求 ${ids.length} 个, 成功 ${result.deletedCount} 个, 跳过 ${result.skippedIds.length} 个, 已删除 ids=[${result.deletedIds.join(', ')}]`,
    )
    return c.json(success(result, '删除成功'), 200)
  } catch (error) {
    if (error instanceof AppError) {
      await writeAuditLog(c, '批量删除文章', 'WARN', error.status, `批量删除失败: ${error.message}`)
      return c.json(failure(error.code, error.message), error.status)
    }
    throw error
  }
})
