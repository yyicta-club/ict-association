/**
 * 静态资源（图片）业务逻辑：上传落盘 + 落库、列表、软删除与恢复。
 *
 * 安全约定：
 * - 分类白名单在后端强制执行；文章 / 图库仅管理员可上传，评论允许管理员与游客上传
 * - 先写文件、后写数据库：数据库明确失败时删除本次产生的文件；
 *   落库结果无法确认时保留文件并记录待核查事件，避免误删已经关联成功的文件
 * - 查询参数全部参数化；筛选与排序片段只由服务端固定枚举生成
 * - 响应只提供资源元数据，绝不暴露磁盘绝对路径
 */
import { env } from '../config/env'
import { execute, query } from '../db'
import type { SqlValue } from '../db'
import { inspectImage } from '../utils/image-inspect'
import { AppError, ErrorCode } from '../utils/response'
import { recordSystemLog } from './system-log.service'
import { removeStoredFile, sanitizeOriginalFileName, writeStoredFile } from './static-file-storage.service'

/** 允许上传的分类（全部） */
export const UPLOAD_CATEGORIES = ['article', 'gallery', 'comment'] as const

export type UploadCategory = (typeof UPLOAD_CATEGORIES)[number]

/** 仅管理员可上传的分类：文章配图、图库 */
export const ADMIN_ONLY_UPLOAD_CATEGORIES = ['article', 'gallery'] as const

/** 管理员与游客均可上传的分类：评论配图 */
export const SHARED_UPLOAD_CATEGORIES = ['comment'] as const

/** 删除状态筛选枚举 */
export const DELETED_FILTERS = ['false', 'true', 'all'] as const
export type DeletedFilter = (typeof DELETED_FILTERS)[number]

/** static_assets 表行 */
export type StaticAssetRow = {
  id: number
  filename: string
  path: string
  url: string | null
  mime_type: string | null
  category: string
  size_bytes: number | null
  md5: string | null
  uploader_id: number | null
  created_at: string
  deleted_at: string | null
}

/** 对外暴露的资源元数据（不含磁盘绝对路径） */
export type StaticAssetMetadata = {
  id: number
  /** 清洗后的原始文件名（仅展示） */
  filename: string
  /** 存储相对路径，如 article/2f1c....png */
  path: string
  /** 对外访问地址；未接 CDN 时为 null */
  url: string | null
  mimeType: string
  category: string
  sizeBytes: number
  /** 上传者 admins.id；游客上传为 null */
  uploaderId: number | null
  createdAt: string
  /** 软删除时间；未删除为 null */
  deletedAt: string | null
}

/** 判断是否为受支持的分类 */
export function isUploadCategory(raw: unknown): raw is UploadCategory {
  return typeof raw === 'string' && (UPLOAD_CATEGORIES as readonly string[]).includes(raw)
}

/**
 * 校验分类：未知分类 -> 400；已知但当前身份无权限 -> 403。
 */
export function resolveUploadCategory(
  raw: string,
  allowed: readonly UploadCategory[],
): UploadCategory {
  const value = raw.trim()
  if (!isUploadCategory(value)) {
    throw new AppError(
      ErrorCode.BAD_REQUEST,
      `分类只能是 ${UPLOAD_CATEGORIES.join(' / ')}`,
    )
  }
  if (!allowed.includes(value)) {
    throw new AppError(ErrorCode.FORBIDDEN, '当前身份无权上传该分类')
  }
  return value
}

/** 数据库行 -> 对外元数据 */
function toMetadata(row: StaticAssetRow): StaticAssetMetadata {
  return {
    id: row.id,
    filename: row.filename,
    path: row.path,
    url: row.url ?? null,
    mimeType: row.mime_type ?? 'application/octet-stream',
    category: row.category,
    sizeBytes: Number(row.size_bytes ?? 0),
    uploaderId: row.uploader_id ?? null,
    createdAt: row.created_at,
    deletedAt: row.deleted_at ?? null,
  }
}

/**
 * 这些驱动错误码意味着"语句可能已经发出、但结果没拿到"，
 * 此时无法判断是否已经提交，删除文件可能误删已关联成功的文件，因此必须保留文件。
 */
const UNCERTAIN_COMMIT_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTCONN',
])

/** 判断落库结果是否"无法确认" */
export function isUncertainCommitError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' && UNCERTAIN_COMMIT_CODES.has(code)
  }
  return false
}

/** 按 id 查询资源行 */
async function findAssetRow(id: number): Promise<StaticAssetRow | null> {
  const rows = await query<StaticAssetRow[]>(
    `SELECT id, filename, path, url, mime_type, category, size_bytes, md5, uploader_id, created_at, deleted_at
       FROM static_assets
      WHERE id = ?
      LIMIT 1`,
    [id],
  )
  return rows[0] ?? null
}

/** 上传输入 */
export type UploadStaticAssetInput = {
  category: UploadCategory
  /** 客户端提交的原始文件名（仅展示） */
  originalFileName: string
  /** 文件内容 */
  data: Uint8Array
  /** 上传者 admins.id；游客上传为 null */
  uploaderId: number | null
  /** 客户端 IP（写审计日志用） */
  ip: string
  /** 请求路径（写审计日志用） */
  requestPath: string
}

/**
 * 上传一张图片：校验 -> 落盘 -> 落库。
 *
 * 落库失败时：
 * - 明确失败（语法错误、外键冲突等）-> 删除本次写入的文件
 * - 结果无法确认（连接中断等）-> 保留文件并记录待核查事件
 */
export async function uploadStaticAsset(
  input: UploadStaticAssetInput,
): Promise<StaticAssetMetadata> {
  if (input.data.byteLength === 0) {
    throw new AppError(ErrorCode.BAD_REQUEST, '上传文件不能为空')
  }
  if (input.data.byteLength > env.staticFile.maxFileBytes) {
    throw new AppError(
      ErrorCode.FILE_TOO_LARGE,
      `单个文件不能超过 ${env.staticFile.maxFileBytes} 字节`,
    )
  }
  if (!env.staticFile.rootPath) {
    throw new Error('STATIC_FILE_PATH 未配置')
  }

  // 1. 图片校验（签名 + 完整解码 + 像素上限）
  const inspection = await inspectImage(input.data, {
    maxTotalPixels: env.staticFile.maxTotalPixels,
  })

  // 2. 落盘（路径固定为 <分类>/<UUID>.<扩展名>）
  const stored = await writeStoredFile({
    rootPath: env.staticFile.rootPath,
    category: input.category,
    extension: inspection.extension,
    data: input.data,
  })

  // 3. 落库
  const filename = sanitizeOriginalFileName(input.originalFileName)
  try {
    const result = await execute(
      `INSERT INTO static_assets (filename, path, url, mime_type, category, size_bytes, md5, uploader_id)
       VALUES (?, ?, NULL, ?, ?, ?, NULL, ?)`,
      [
        filename,
        stored.relativePath,
        inspection.mimeType,
        input.category,
        stored.size,
        input.uploaderId,
      ],
    )

    const row = await findAssetRow(result.insertId).catch(() => null)
    if (row) return toMetadata(row)

    return {
      id: result.insertId,
      filename,
      path: stored.relativePath,
      url: null,
      mimeType: inspection.mimeType,
      category: input.category,
      sizeBytes: stored.size,
      uploaderId: input.uploaderId,
      createdAt: new Date().toISOString(),
      deletedAt: null,
    }
  } catch (error) {
    if (isUncertainCommitError(error)) {
      // 落库结果无法确认：保留文件并记录待核查事件，避免误删已经关联成功的文件
      await recordSystemLog({
        level: 'ERROR',
        operation: '静态资源落库结果待核查',
        module: 'static-file',
        operatorId: input.uploaderId,
        ip: input.ip,
        requestPath: input.requestPath,
        statusCode: 500,
        detail: `文件已写入但落库结果无法确认，需人工核查；相对路径=${stored.relativePath}`,
      })
      throw error
    }

    // 明确失败：清理本次产生的文件
    await removeStoredFile(stored.absolutePath).catch(() => false)
    throw error
  }
}

/** 列表查询输入 */
export type ListStaticAssetsInput = {
  /** 分类筛选；null 表示不限 */
  category: UploadCategory | null
  /** 删除状态筛选 */
  deleted: DeletedFilter
  page: number
  pageSize: number
}

/** 列表查询结果 */
export type ListStaticAssetsResult = {
  items: StaticAssetMetadata[]
  total: number
  page: number
  pageSize: number
}

/**
 * 生成 WHERE 子句。
 * 片段只由服务端固定枚举拼装，参数一律走占位符。
 */
function buildWhereClause(input: ListStaticAssetsInput): string {
  const conditions: string[] = []
  if (input.deleted === 'false') {
    conditions.push('deleted_at IS NULL')
  } else if (input.deleted === 'true') {
    conditions.push('deleted_at IS NOT NULL')
  }
  if (input.category) {
    conditions.push('category = ?')
  }
  return conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
}

/** 生成与 WHERE 子句对应的参数 */
function buildWhereParams(input: ListStaticAssetsInput): SqlValue[] {
  const params: SqlValue[] = []
  if (input.category) {
    params.push(input.category)
  }
  return params
}

/** 分页查询资源列表（按 id 倒序） */
export async function listStaticAssets(
  input: ListStaticAssetsInput,
): Promise<ListStaticAssetsResult> {
  const where = buildWhereClause(input)
  const params = buildWhereParams(input)

  const rows = await query<StaticAssetRow[]>(
    `SELECT id, filename, path, url, mime_type, category, size_bytes, md5, uploader_id, created_at, deleted_at
       FROM static_assets${where}
      ORDER BY id DESC
      LIMIT ? OFFSET ?`,
    [...params, input.pageSize, (input.page - 1) * input.pageSize],
  )

  const totalRows = await query<{ total: number }[]>(
    `SELECT COUNT(*) AS total FROM static_assets${where}`,
    params,
  )

  return {
    items: rows.map(toMetadata),
    total: Number(totalRows[0]?.total ?? 0),
    page: input.page,
    pageSize: input.pageSize,
  }
}

/**
 * 软删除：只改删除状态，文件与关联关系保持不变。
 * 重复删除返回成功；资源不存在返回 404。
 */
export async function softDeleteStaticAsset(id: number): Promise<StaticAssetMetadata> {
  const row = await findAssetRow(id)
  if (!row) {
    throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, '资源不存在')
  }

  if (row.deleted_at === null) {
    await execute(
      'UPDATE static_assets SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [id],
    )
    const updated = await findAssetRow(id)
    if (updated) return toMetadata(updated)
    return { ...toMetadata(row), deletedAt: new Date().toISOString() }
  }

  // 已经删除过：幂等返回成功
  return toMetadata(row)
}

/**
 * 恢复：只改删除状态，文件与关联关系保持不变。
 * 重复恢复返回成功；资源不存在返回 404。
 */
export async function recoverStaticAsset(id: number): Promise<StaticAssetMetadata> {
  const row = await findAssetRow(id)
  if (!row) {
    throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, '资源不存在')
  }

  if (row.deleted_at !== null) {
    await execute(
      'UPDATE static_assets SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL',
      [id],
    )
    const updated = await findAssetRow(id)
    if (updated) return toMetadata(updated)
    return { ...toMetadata(row), deletedAt: null }
  }

  // 本来就没删除：幂等返回成功
  return toMetadata(row)
}

/** 校验资源 id：必须是正安全整数 */
export function validateAssetId(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppError(ErrorCode.BAD_REQUEST, 'id 必须是正整数')
  }
  return value
}
