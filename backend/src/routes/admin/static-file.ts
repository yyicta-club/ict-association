/**
 * 后台静态资源路由：
 * - POST /admin/static-files/upload   上传图片
 * - GET  /admin/static-files/list     分页查询
 * - POST /admin/static-files/delete   软删除
 * - POST /admin/static-files/recover  恢复
 *
 * 安全约定：
 * - 整组接口都要管理员鉴权
 * - 上传限流挂在鉴权之前：失败请求同样消耗额度
 * - 查询参数全部校验并参数化；筛选片段只由服务端固定枚举生成
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import { adminAuth } from '../../middlewares/auth'
import { uploadRateLimit } from '../../middlewares/upload-rate-limit'
import { recordSystemLog } from '../../services/system-log.service'
import {
  DELETED_FILTERS,
  UPLOAD_CATEGORIES,
  isUploadCategory,
  listStaticAssets,
  recoverStaticAsset,
  softDeleteStaticAsset,
  validateAssetId,
} from '../../services/static-file.service'
import type { DeletedFilter, UploadCategory } from '../../services/static-file.service'
import type { HonoEnv } from '../../types'
import { parseEnum, parsePositiveInt } from '../../utils/query-params'
import { getClientIp, getRequestPath } from '../../utils/request'
import { AppError, ErrorCode, failure, success } from '../../utils/response'
import { createUploadHandler } from '../static-file-upload'

export const adminStaticFileRoutes = new Hono<HonoEnv>()

/** 列表默认每页条数 */
const DEFAULT_PAGE_SIZE = 20
/** 列表每页条数上限 */
const MAX_PAGE_SIZE = 100
/** 页码上限（避免 OFFSET 溢出） */
const MAX_PAGE = 1_000_000

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

/** 判断请求体是否为 JSON 对象（排除数组与 null） */
function isJsonObject(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
}

// ---------- POST /admin/static-files/upload ----------
// 限流必须在鉴权与 multipart 解析之前
adminStaticFileRoutes.use('/upload', uploadRateLimit)
adminStaticFileRoutes.use('/upload', adminAuth)
adminStaticFileRoutes.post(
  '/upload',
  createUploadHandler({
    allowedCategories: UPLOAD_CATEGORIES,
    operatorId: (c) => {
      const admin = c.get('admin')
      return admin ? Number(admin.sub) : null
    },
    operation: '管理员上传静态资源',
  }),
)

// ---------- GET /admin/static-files/list ----------
adminStaticFileRoutes.get('/list', adminAuth, async (c) => {
  const ip = getClientIp(c)
  const requestPath = getRequestPath(c)

  const writeLog = (level: 'INFO' | 'WARN', statusCode: number, detail: string) =>
    recordSystemLog({
      level,
      operation: '查询静态资源列表',
      module: 'static-file',
      operatorId: c.get('admin') ? Number(c.get('admin').sub) : null,
      ip,
      requestPath,
      statusCode,
      detail,
    })

  const raw = c.req.query()

  // 分类：可缺省；一旦提供就必须在白名单内（空串等非法值一律 400）
  let category: UploadCategory | null = null
  if (raw.category !== undefined) {
    const value = raw.category.trim()
    if (!isUploadCategory(value)) {
      await writeLog('WARN', 400, `查询失败: 分类非法 (${value})`)
      return c.json(
        failure(ErrorCode.BAD_REQUEST, `分类只能是 ${UPLOAD_CATEGORIES.join(' / ')}`),
        400,
      )
    }
    category = value
  }

  try {
    const deleted: DeletedFilter = parseEnum(
      raw.deleted,
      DELETED_FILTERS,
      'false',
      'deleted',
    )
    const page = Math.min(parsePositiveInt(raw.page, 1, 'page'), MAX_PAGE)
    const pageSize = Math.min(
      parsePositiveInt(raw.pageSize, DEFAULT_PAGE_SIZE, 'pageSize'),
      MAX_PAGE_SIZE,
    )

    const result = await listStaticAssets({ category, deleted, page, pageSize })
    await writeLog(
      'INFO',
      200,
      `查询成功: 共 ${result.total} 条, 第 ${result.page} 页, 每页 ${result.pageSize} 条`,
    )
    return c.json(success(result, '查询成功'), 200)
  } catch (error) {
    if (error instanceof AppError) {
      await writeLog('WARN', error.status, `查询失败: ${error.message}`)
      return c.json(failure(error.code, error.message), error.status)
    }
    throw error
  }
})

// ---------- POST /admin/static-files/delete ----------
adminStaticFileRoutes.post('/delete', adminAuth, async (c) => {
  const ip = getClientIp(c)
  const requestPath = getRequestPath(c)

  const writeLog = (level: 'INFO' | 'WARN', statusCode: number, detail: string) =>
    recordSystemLog({
      level,
      operation: '删除静态资源',
      module: 'static-file',
      operatorId: c.get('admin') ? Number(c.get('admin').sub) : null,
      ip,
      requestPath,
      statusCode,
      detail,
    })

  const body = await readJsonBody(c)
  if (body === null || !isJsonObject(body)) {
    await writeLog('WARN', 400, '删除失败: 请求体不是合法 JSON 对象')
    return c.json(failure(ErrorCode.BAD_REQUEST, '请求体必须是 JSON 对象'), 400)
  }

  let id: number
  try {
    id = validateAssetId(body.id)
  } catch (error) {
    if (error instanceof AppError) {
      await writeLog('WARN', error.status, `删除失败: ${error.message}`)
      return c.json(failure(error.code, error.message), error.status)
    }
    throw error
  }

  try {
    const asset = await softDeleteStaticAsset(id)
    await writeLog('INFO', 200, `删除成功: 资源 ID=${id}`)
    return c.json(success(asset, '删除成功'), 200)
  } catch (error) {
    if (error instanceof AppError) {
      await writeLog('WARN', error.status, `删除失败: ${error.message}`)
      return c.json(failure(error.code, error.message), error.status)
    }
    throw error
  }
})

// ---------- POST /admin/static-files/recover ----------
adminStaticFileRoutes.post('/recover', adminAuth, async (c) => {
  const ip = getClientIp(c)
  const requestPath = getRequestPath(c)

  const writeLog = (level: 'INFO' | 'WARN', statusCode: number, detail: string) =>
    recordSystemLog({
      level,
      operation: '恢复静态资源',
      module: 'static-file',
      operatorId: c.get('admin') ? Number(c.get('admin').sub) : null,
      ip,
      requestPath,
      statusCode,
      detail,
    })

  const body = await readJsonBody(c)
  if (body === null || !isJsonObject(body)) {
    await writeLog('WARN', 400, '恢复失败: 请求体不是合法 JSON 对象')
    return c.json(failure(ErrorCode.BAD_REQUEST, '请求体必须是 JSON 对象'), 400)
  }

  let id: number
  try {
    id = validateAssetId(body.id)
  } catch (error) {
    if (error instanceof AppError) {
      await writeLog('WARN', error.status, `恢复失败: ${error.message}`)
      return c.json(failure(error.code, error.message), error.status)
    }
    throw error
  }

  try {
    const asset = await recoverStaticAsset(id)
    await writeLog('INFO', 200, `恢复成功: 资源 ID=${id}`)
    return c.json(success(asset, '恢复成功'), 200)
  } catch (error) {
    if (error instanceof AppError) {
      await writeLog('WARN', error.status, `恢复失败: ${error.message}`)
      return c.json(failure(error.code, error.message), error.status)
    }
    throw error
  }
})
