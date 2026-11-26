/**
 * 文章业务逻辑：创建、部分修改、软删除。
 *
 * 安全约定：
 * - 所有 SQL 参数化；SET / WHERE 片段只由服务端固定枚举拼装
 * - 关联资源先查后写：分类必须存在，封面必须是未软删除的 article 图片资源
 * - slug 唯一性双重防御：先查重给出友好提示，再用 ER_DUP_ENTRY 兜底并发冲突
 * - 软删除只写 deleted_at，文章、评论与标签关联数据全部保留
 * - 发布时间与浏览量由服务端管理，客户端无法直接写入
 */
import { execute, query } from '../db'
import type { SqlValue } from '../db'
import type { ArticleStatus } from '../utils/article-validation'
import { AppError, ErrorCode } from '../utils/response'

/** articles 表的查询列（顺序固定，回读时统一使用） */
const ARTICLE_COLUMNS =
  'id, title, slug, summary, content, cover_asset_id, category_id, status, is_top, view_count, published_at, created_at, updated_at, deleted_at'

/** articles 表行 */
export type ArticleRow = {
  id: number
  title: string
  slug: string
  summary: string | null
  content: string
  cover_asset_id: number | null
  category_id: number | null
  status: number
  is_top: number
  view_count: number
  published_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/** 对外暴露的文章元数据（不含正文，避免大字段回显） */
export type ArticleMetadata = {
  id: number
  title: string
  slug: string
  summary: string | null
  coverAssetId: number | null
  categoryId: number | null
  status: ArticleStatus
  isTop: boolean
  viewCount: number
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** 创建文章的输入（已完成格式校验） */
export type CreateArticleInput = {
  title: string
  slug: string
  content: string
  /** null 表示不填写摘要 */
  summary: string | null
  /** null 表示不设置封面 */
  coverAssetId: number | null
  /** null 表示不归类 */
  categoryId: number | null
  status: ArticleStatus
  isTop: boolean
}

/** 修改文章的输入：字段为 undefined 表示"不修改该字段" */
export type UpdateArticleInput = {
  title?: string
  slug?: string
  content?: string
  /** null 表示清空摘要；undefined 表示不修改 */
  summary?: string | null
  /** null 表示清空封面；undefined 表示不修改 */
  coverAssetId?: number | null
  /** null 表示清空分类；undefined 表示不修改 */
  categoryId?: number | null
  status?: ArticleStatus
  isTop?: boolean
}

/** 修改结果 */
export type UpdateArticleResult = {
  article: ArticleMetadata
  /** 本次实际发生变更的字段名 */
  changedFields: string[]
}

/** 更新计划：只包含真正发生变化的字段 */
export type ArticleUpdatePlan = {
  /** UPDATE 的 SET 子句（不含 updated_at / published_at） */
  sets: string[]
  /** 与 sets 一一对应的参数值 */
  values: SqlValue[]
  /** 发生变化的字段名 */
  changedFields: string[]
}

/**
 * 判断是否为 MySQL 唯一索引冲突。
 * mysql2 的错误对象上带有 code 属性。
 */
function isDuplicateEntryError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    return (error as { code?: unknown }).code === 'ER_DUP_ENTRY'
  }
  return false
}

/**
 * 把驱动层的唯一索引冲突翻译成友好业务错误。
 * 非冲突错误原样抛出，交给全局 onError 兜底 500。
 */
function translateDuplicateError(error: unknown): never {
  if (!isDuplicateEntryError(error)) {
    throw error
  }
  throw new AppError(ErrorCode.ARTICLE_SLUG_CONFLICT, 'slug 已被占用')
}

/** 数据库行 -> 对外元数据 */
function toMetadata(row: ArticleRow): ArticleMetadata {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    summary: row.summary ?? null,
    coverAssetId: row.cover_asset_id ?? null,
    categoryId: row.category_id ?? null,
    status: row.status as ArticleStatus,
    isTop: row.is_top === 1,
    viewCount: Number(row.view_count ?? 0),
    publishedAt: row.published_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
  }
}

/** 按 id 查询文章行（不过滤软删除） */
async function findArticleRow(id: number): Promise<ArticleRow | null> {
  const rows = await query<ArticleRow[]>(
    `SELECT ${ARTICLE_COLUMNS} FROM articles WHERE id = ? LIMIT 1`,
    [id],
  )
  return rows[0] ?? null
}

/** 按 id 查询未删除的文章行 */
async function findActiveArticleRow(id: number): Promise<ArticleRow | null> {
  const rows = await query<ArticleRow[]>(
    `SELECT ${ARTICLE_COLUMNS} FROM articles WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id],
  )
  return rows[0] ?? null
}

/**
 * 校验 slug 是否可用。
 *
 * 已软删除的文章仍然占用唯一索引 uk_slug，因此软删除后的 slug 也不能被复用。
 * excludeId 用于修改场景排除自身。
 */
async function assertSlugAvailable(slug: string, excludeId?: number): Promise<void> {
  const rows = await query<{ id: number }[]>(
    excludeId === undefined
      ? 'SELECT id FROM articles WHERE slug = ? LIMIT 1'
      : 'SELECT id FROM articles WHERE slug = ? AND id <> ? LIMIT 1',
    excludeId === undefined ? [slug] : [slug, excludeId],
  )
  if (rows.length > 0) {
    throw new AppError(ErrorCode.ARTICLE_SLUG_CONFLICT, 'slug 已被占用')
  }
}

/** 校验分类存在 */
async function assertCategoryExists(categoryId: number): Promise<void> {
  const rows = await query<{ id: number }[]>('SELECT id FROM categories WHERE id = ? LIMIT 1', [
    categoryId,
  ])
  if (rows.length === 0) {
    throw new AppError(ErrorCode.BAD_REQUEST, '分类不存在')
  }
}

/**
 * 校验封面资源可用。
 * 必须是存在的、未软删除的、分类为 article 的图片资源。
 */
async function assertCoverAssetUsable(coverAssetId: number): Promise<void> {
  const rows = await query<{ id: number; category: string; deleted_at: string | null }[]>(
    'SELECT id, category, deleted_at FROM static_assets WHERE id = ? LIMIT 1',
    [coverAssetId],
  )
  const asset = rows[0]
  if (!asset) {
    throw new AppError(ErrorCode.BAD_REQUEST, '封面资源不存在')
  }
  if (asset.deleted_at !== null) {
    throw new AppError(ErrorCode.BAD_REQUEST, '封面资源已删除')
  }
  if (asset.category !== 'article') {
    throw new AppError(ErrorCode.BAD_REQUEST, '封面资源必须是文章配图')
  }
}

/**
 * 纯函数：比对当前值与待更新值，生成只包含变化字段的更新计划。
 *
 * 规则：
 * - 字段值为 undefined -> 不修改该字段
 * - 字段值与当前值相同 -> 不修改该字段（避免无谓写库）
 * - cover_asset_id / category_id / summary 传 null -> 清空该字段
 */
export function buildArticleUpdatePlan(
  current: {
    title: string
    slug: string
    content: string
    summary: string | null
    coverAssetId: number | null
    categoryId: number | null
    status: ArticleStatus
    isTop: boolean
  },
  input: UpdateArticleInput,
): ArticleUpdatePlan {
  const sets: string[] = []
  const values: SqlValue[] = []
  const changedFields: string[] = []

  if (input.title !== undefined && input.title !== current.title) {
    sets.push('title = ?')
    values.push(input.title)
    changedFields.push('title')
  }

  if (input.slug !== undefined && input.slug !== current.slug) {
    sets.push('slug = ?')
    values.push(input.slug)
    changedFields.push('slug')
  }

  if (input.content !== undefined && input.content !== current.content) {
    sets.push('content = ?')
    values.push(input.content)
    changedFields.push('content')
  }

  if (input.summary !== undefined && input.summary !== current.summary) {
    sets.push('summary = ?')
    values.push(input.summary)
    changedFields.push('summary')
  }

  if (input.coverAssetId !== undefined && input.coverAssetId !== current.coverAssetId) {
    sets.push('cover_asset_id = ?')
    values.push(input.coverAssetId)
    changedFields.push('cover_asset_id')
  }

  if (input.categoryId !== undefined && input.categoryId !== current.categoryId) {
    sets.push('category_id = ?')
    values.push(input.categoryId)
    changedFields.push('category_id')
  }

  if (input.status !== undefined && input.status !== current.status) {
    sets.push('status = ?')
    values.push(input.status)
    changedFields.push('status')
  }

  if (input.isTop !== undefined && input.isTop !== current.isTop) {
    sets.push('is_top = ?')
    values.push(input.isTop ? 1 : 0)
    changedFields.push('is_top')
  }

  return { sets, values, changedFields }
}

/**
 * 创建文章。
 *
 * - 先校验关联资源（分类 / 封面）与 slug 唯一性，再落库
 * - status = 1（已发布）时由服务端写入 published_at；浏览量固定为 0
 */
export async function createArticle(input: CreateArticleInput): Promise<ArticleMetadata> {
  await assertSlugAvailable(input.slug)

  if (input.categoryId !== null) {
    await assertCategoryExists(input.categoryId)
  }

  if (input.coverAssetId !== null) {
    await assertCoverAssetUsable(input.coverAssetId)
  }

  // published_at 由服务端管理：仅"已发布"状态写入发布时间
  const insertSql =
    input.status === 1
      ? `INSERT INTO articles (title, slug, summary, content, cover_asset_id, category_id, status, is_top, view_count, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NOW())`
      : `INSERT INTO articles (title, slug, summary, content, cover_asset_id, category_id, status, is_top, view_count, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`

  try {
    const result = await execute(insertSql, [
      input.title,
      input.slug,
      input.summary,
      input.content,
      input.coverAssetId,
      input.categoryId,
      input.status,
      input.isTop ? 1 : 0,
    ])

    const row = await findArticleRow(result.insertId)
    if (row) return toMetadata(row)

    // 理论上读不到（刚插入就查不到）：返回兜底元数据，避免前端拿不到 id
    const now = new Date().toISOString()
    return {
      id: result.insertId,
      title: input.title,
      slug: input.slug,
      summary: input.summary,
      coverAssetId: input.coverAssetId,
      categoryId: input.categoryId,
      status: input.status,
      isTop: input.isTop,
      viewCount: 0,
      publishedAt: input.status === 1 ? now : null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }
  } catch (error) {
    // 并发写入时唯一索引会先于查重生效，这里兜底翻译
    translateDuplicateError(error)
  }
}

/**
 * 修改文章（部分更新）。
 *
 * - 只更新实际发生变化的字段，未变化的字段不进 SET 子句
 * - 已软删除的文章视为不存在
 * - status 变成 1（已发布）且此前没有发布时间时，由服务端补写 published_at
 */
export async function updateArticle(
  id: number,
  input: UpdateArticleInput,
): Promise<UpdateArticleResult> {
  const current = await findActiveArticleRow(id)
  if (!current) {
    throw new AppError(ErrorCode.ARTICLE_NOT_FOUND, '文章不存在')
  }

  const plan = buildArticleUpdatePlan(
    {
      title: current.title,
      slug: current.slug,
      content: current.content,
      summary: current.summary ?? null,
      coverAssetId: current.cover_asset_id ?? null,
      categoryId: current.category_id ?? null,
      status: current.status as ArticleStatus,
      isTop: current.is_top === 1,
    },
    input,
  )

  // 关联资源与 slug 的合法性校验（只对真正要改的字段做）
  if (plan.changedFields.includes('slug') && input.slug !== undefined) {
    await assertSlugAvailable(input.slug, id)
  }
  if (plan.changedFields.includes('category_id') && input.categoryId) {
    await assertCategoryExists(input.categoryId)
  }
  if (plan.changedFields.includes('cover_asset_id') && input.coverAssetId) {
    await assertCoverAssetUsable(input.coverAssetId)
  }

  // 没有任何变化：直接回显当前资料，不产生写操作
  if (plan.sets.length === 0) {
    return { article: toMetadata(current), changedFields: [] }
  }

  const sets = [...plan.sets]
  const values = [...plan.values]

  // 发布时间由服务端管理：首次变为"已发布"时补写发布时间
  if (plan.changedFields.includes('status') && input.status === 1 && current.published_at === null) {
    sets.push('published_at = NOW()')
  }

  sets.push('updated_at = NOW()')

  try {
    await execute(`UPDATE articles SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`, [
      ...values,
      id,
    ])
  } catch (error) {
    translateDuplicateError(error)
  }

  const updated = (await findActiveArticleRow(id)) ?? current

  return { article: toMetadata(updated), changedFields: plan.changedFields }
}

/**
 * 软删除文章。
 *
 * 只写 deleted_at 标记：文章行、评论（comments）与标签关联（article_tags）全部保留。
 * 文章不存在或已被软删除时都返回"文章不存在"。
 */
export async function softDeleteArticle(id: number): Promise<ArticleMetadata> {
  const result = await execute(
    'UPDATE articles SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
    [id],
  )

  if (result.affectedRows === 0) {
    throw new AppError(ErrorCode.ARTICLE_NOT_FOUND, '文章不存在')
  }

  const row = await findArticleRow(id)
  if (row) return toMetadata(row)

  // 读不到就返回兜底元数据
  return {
    id,
    title: '',
    slug: '',
    summary: null,
    coverAssetId: null,
    categoryId: null,
    status: 0,
    isTop: false,
    viewCount: 0,
    publishedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: new Date().toISOString(),
  }
}
