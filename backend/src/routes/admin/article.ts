/**
 * 管理员文章路由：
 * - POST /admin/article/create   创建文章
 * - POST /admin/article/setting  部分修改文章
 * - POST /admin/article/delete   软删除文章
 *
 * 约定：
 * - 整组路由统一挂 adminAuth，未登录一律 401
 * - 参数校验在路由层完成（复用 utils/article-validation 的纯函数），
 *   任何校验失败都在触碰数据库之前就返回 400
 * - 业务异常（AppError）在此转成统一响应体，其余异常交给全局 onError 兜底
 * - 审计日志只记录操作名、文章 id、状态与变更字段，绝不记录正文或完整请求体
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import { adminAuth } from '../../middlewares/auth'
import {
  createArticle,
  softDeleteArticle,
  updateArticle,
} from '../../services/article.service'
import type { CreateArticleInput, UpdateArticleInput } from '../../services/article.service'
import { recordSystemLog } from '../../services/system-log.service'
import type { HonoEnv } from '../../types'
import {
  parseCreateArticleRequest,
  parseDeleteArticleRequest,
  parseUpdateArticleRequest,
} from '../../utils/article-validation'
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
  return recordSystemLog({
    level,
    operation,
    module: 'article',
    operatorId: c.get('admin') ? Number(c.get('admin').sub) : null,
    ip: getClientIp(c),
    requestPath: getRequestPath(c),
    statusCode,
    detail,
  })
}

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
