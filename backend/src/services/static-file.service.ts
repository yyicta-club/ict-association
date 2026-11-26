/**
 * 静态资源（图片）业务逻辑：上传落盘 + 落库、列表、软删除与恢复。
 *
 * 安全约定：
 * - 分类白名单在后端强制执行；文章 / 图库仅管理员可上传，评论允许管理员与游客上传
 * - 指纹去重：同分类 + 文件字节完全一致视为重复，复用原资源（必要时恢复软删除记录）
 * - 去重用 MySQL 命名锁串行化同一把指纹，并发上传同一图片只会生成一份文件与一条记录
 * - 先写文件、后写数据库：数据库明确失败时删除本次产生的文件；
 *   落库结果无法确认时保留文件并记录待核查事件，避免误删已经关联成功的文件
 * - 查询参数全部参数化；筛选与排序片段只由服务端固定枚举生成
 * - 响应只提供资源元数据，绝不暴露磁盘绝对路径
 */
import { env } from '../config/env'
import { acquireNamedLock, execute, query, releaseNamedLock } from '../db'
import type { DbConnection, SqlValue } from '../db'
import { inspectImage } from '../utils/image-inspect'
import { AppError, ErrorCode } from '../utils/response'
import { recordSystemLog } from './system-log.service'
import {
  DEDUP_LOCK_TIMEOUT_SECONDS,
  buildDedupLockName,
  computeFingerprint,
  inspectStoredFile,
} from './static-file-dedup.service'
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
async function findAssetRow(
  id: number,
  connection?: DbConnection,
): Promise<StaticAssetRow | null> {
  const rows = await query<StaticAssetRow[]>(
    `SELECT id, filename, path, url, mime_type, category, size_bytes, md5, uploader_id, created_at, deleted_at
       FROM static_assets
      WHERE id = ?
      LIMIT 1`,
    [id],
    connection,
  )
  return rows[0] ?? null
}

/**
 * 按「分类 + 指纹」查询已有资源。
 *
 * 历史数据 md5 为 NULL，不会命中（SQL 里 NULL 不等于任何值），
 * 因此去重只对本次功能上线后保存指纹的资源生效，不需要回填历史数据。
 */
async function findAssetByFingerprint(
  category: UploadCategory,
  fingerprint: string,
  connection?: DbConnection,
): Promise<StaticAssetRow | null> {
  const rows = await query<StaticAssetRow[]>(
    `SELECT id, filename, path, url, mime_type, category, size_bytes, md5, uploader_id, created_at, deleted_at
       FROM static_assets
      WHERE category = ?
        AND md5 = ?
      LIMIT 1`,
    [category, fingerprint],
    connection,
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

/** 上传结果的三种形态（内部使用，不暴露指纹） */
export type UploadOutcome =
  /** 首次上传：新建了文件与数据库记录 */
  | 'created'
  /** 指纹命中：复用了已有资源，未产生新文件与新记录 */
  | 'reused'
  /** 指纹命中且原记录处于软删除：已清空 deleted_at 恢复原资源 */
  | 'restored'

/** 上传结果 */
export type UploadStaticAssetResult = {
  asset: StaticAssetMetadata
  outcome: UploadOutcome
}

/**
 * 上传一张图片：校验 -> 指纹 -> 加锁 -> 查重 -> 复用/恢复/新建。
 *
 * 去重规则：同分类 + 文件字节完全一致视为重复。
 * - 命中且原记录未删除 -> 复用，返回原资源（不新增文件与记录，不改首次上传的文件名与上传者）
 * - 命中且原记录已软删除 -> 清空 deleted_at 后返回原资源
 * - 命中但磁盘文件核对不通过 -> 返回资源冲突错误，不覆盖文件、不恢复记录，并记录核查日志
 *
 * 落库失败时：
 * - 明确失败（语法错误、外键冲突等）-> 删除本次写入的文件
 * - 结果无法确认（连接中断等）-> 保留文件并记录待核查事件
 */
export async function uploadStaticAsset(
  input: UploadStaticAssetInput,
): Promise<UploadStaticAssetResult> {
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

  // 2. 计算指纹（对实际保存的原始字节）
  const fingerprint = computeFingerprint(input.data)

  // 3. 获取并发锁：同一「分类 + 指纹」串行化
  const lockName = buildDedupLockName({
    database: env.db.database,
    category: input.category,
    fingerprint,
  })
  const lock = await acquireNamedLock(lockName, DEDUP_LOCK_TIMEOUT_SECONDS)
  if (!lock) {
    throw new AppError(
      ErrorCode.DEDUP_LOCK_TIMEOUT,
      '同一资源正在处理中，请稍后重试',
    )
  }

  // 4. 锁与业务 SQL 共用同一条连接；所有退出路径都会释放锁并归还连接
  try {
    return await uploadWithinLock(input, fingerprint, inspection, lock.connection)
  } finally {
    await releaseNamedLock(lock)
  }
}

/**
 * 持锁执行上传：拿到锁后重新查重，再决定复用 / 恢复 / 新建。
 */
async function uploadWithinLock(
  input: UploadStaticAssetInput,
  fingerprint: string,
  inspection: { extension: string; mimeType: string },
  connection: DbConnection,
): Promise<UploadStaticAssetResult> {
  // 1. 拿到锁后重新查重（等待锁期间可能已有别人写入）
  const existing = await findAssetByFingerprint(input.category, fingerprint, connection)
  if (existing) {
    return reuseExistingAsset(input, existing, fingerprint, connection)
  }

  // 2. 未命中：落盘（路径固定为 <分类>/<UUID>.<扩展名>）
  const stored = await writeStoredFile({
    rootPath: env.staticFile.rootPath,
    category: input.category,
    extension: inspection.extension,
    data: input.data,
  })

  // 3. 落库（同一连接，指纹一并写入）
  const filename = sanitizeOriginalFileName(input.originalFileName)
  try {
    const result = await execute(
      `INSERT INTO static_assets (filename, path, url, mime_type, category, size_bytes, md5, uploader_id)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
      [
        filename,
        stored.relativePath,
        inspection.mimeType,
        input.category,
        stored.size,
        fingerprint,
        input.uploaderId,
      ],
      connection,
    )

    const row = await findAssetRow(result.insertId, connection).catch(() => null)
    if (row) return { asset: toMetadata(row), outcome: 'created' }

    return {
      asset: {
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
      },
      outcome: 'created',
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

/**
 * 复用命中指纹的已有资源。
 *
 * - 先核对磁盘上的真实文件（大小 + 字节），避免 MD5 碰撞被误判成重复
 * - 核对不通过时**不覆盖文件、不恢复记录**，只记录核查日志并返回资源冲突错误
 * - 原记录处于软删除时清空 deleted_at 后返回原资源
 * - 首次上传的文件名与上传者保持不变（游客复用管理员的资源时 uploaderId 仍是管理员）
 */
async function reuseExistingAsset(
  input: UploadStaticAssetInput,
  existing: StaticAssetRow,
  fingerprint: string,
  connection: DbConnection,
): Promise<UploadStaticAssetResult> {
  const check = await inspectStoredFile({
    rootPath: env.staticFile.rootPath,
    relativePath: existing.path,
    expectedSize: Number(existing.size_bytes ?? 0),
    expectedFingerprint: fingerprint,
  })

  if (check.state !== 'ok') {
    await recordSystemLog({
      level: 'ERROR',
      operation: '静态资源指纹校验失败',
      module: 'static-file',
      operatorId: input.uploaderId,
      ip: input.ip,
      requestPath: input.requestPath,
      statusCode: 409,
      detail: `指纹命中但文件核对未通过（${check.reason}），未覆盖文件、未恢复记录，需人工核查；资源 ID=${existing.id}, 分类=${input.category}`,
    })
    throw new AppError(
      ErrorCode.RESOURCE_CONFLICT,
      '资源指纹校验失败，请稍后重试或联系管理员核查',
    )
  }

  // 命中软删除记录：清空 deleted_at 并返回原资源
  if (existing.deleted_at !== null) {
    await execute(
      'UPDATE static_assets SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL',
      [existing.id],
      connection,
    )
    const restored = await findAssetRow(existing.id, connection)
    return {
      asset: toMetadata(restored ?? { ...existing, deleted_at: null }),
      outcome: 'restored',
    }
  }

  return { asset: toMetadata(existing), outcome: 'reused' }
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
