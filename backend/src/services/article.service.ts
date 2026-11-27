/**
 * 文章业务逻辑：创建、部分修改、软删除、列表、详情与批量软删除。
 *
 * 安全约定：
 * - 所有 SQL 参数化；SET / WHERE 片段只由服务端固定枚举拼装
 * - 关联资源先查后写：分类必须存在，封面必须是未软删除的 article 图片资源
 * - slug 唯一性双重防御：先查重给出友好提示，再用 ER_DUP_ENTRY 兜底并发冲突
 * - 软删除只写 deleted_at，文章、评论与标签关联数据全部保留
 * - 发布时间与浏览量由服务端管理，客户端无法直接写入
 * - 列表的可见范围（游客端只看已发布）由服务端固定，客户端无法覆盖
 * - 服务函数可以注入数据库句柄（默认直连连接池），便于在隔离环境下测试
 */
import { defaultDbStore, execute, query } from '../db'
import type { DbConnection, DbStore, SqlValue } from '../db'
import type { ArticleStatus } from '../utils/article-validation'
import { AppError, ErrorCode } from '../utils/response'

/** articles 表的查询列（顺序固定，回读时统一使用） */
const ARTICLE_COLUMNS =
  'id, title, slug, summary, content, cover_asset_id, category_id, status, is_top, view_count, published_at, created_at, updated_at, deleted_at'

/** articles 表行（不含正文：列表查询不读正文） */
export type ArticleRowBase = {
  id: number
  title: string
  slug: string
  summary: string | null
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

/** articles 表行（含正文） */
export type ArticleRow = ArticleRowBase & {
  content: string
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

/** 列表项附带的分类信息（精简，只取展示需要的字段） */
export type ArticleCategoryBrief = {
  id: number
  name: string
  slug: string
}

/** 列表项附带的封面信息（精简，不暴露磁盘绝对路径） */
export type ArticleCoverBrief = {
  id: number
  /** 存储相对路径，如 article/2f1c....png */
  path: string
  /** 对外访问地址；未接 CDN 时为 null（不拼接未经配置的访问域名） */
  url: string | null
}

/** 列表项：文章元数据 + 分类 / 封面（不含正文） */
export type ArticleListItem = ArticleMetadata & {
  category: ArticleCategoryBrief | null
  cover: ArticleCoverBrief | null
}

/** 文章详情：列表项 + 原始 Markdown 正文 */
export type ArticleDetail = ArticleListItem & {
  content: string
}

/** 列表查询结果 */
export type ArticleListResult = {
  items: ArticleListItem[]
  total: number
  page: number
  pageSize: number
}

/** 批量软删除结果 */
export type BatchDeleteArticlesResult = {
  /** 实际软删除成功的文章 id（按去重后的输入顺序） */
  deletedIds: number[]
  /** 被跳过的文章 id（不存在或已被软删除；按去重后的输入顺序） */
  skippedIds: number[]
  /** 实际删除数量 */
  deletedCount: number
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
function toMetadata(row: ArticleRowBase): ArticleMetadata {
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

/* ============================ 列表 / 详情 / 批量删除 ============================ */

/** 列表可见范围（由服务端固定，客户端无法覆盖） */
export type ArticleListScope =
  /** 游客端：只返回已发布且未删除的文章 */
  | 'public'
  /** 后台端：返回未删除的文章，状态可按需筛选 */
  | 'admin'

/** 列表筛选条件 */
export type ArticleListFilters = {
  /** 关键词：匹配标题或摘要；null 表示不筛选 */
  keyword: string | null
  /** 分类精确筛选；null 表示不限 */
  categoryId: number | null
  /** 状态筛选；null 表示不限（后台端省略状态时查询草稿 / 已发布 / 已下架） */
  status: ArticleStatus | null
}

/** 列表查询输入 */
export type ArticleListInput = ArticleListFilters & {
  page: number
  pageSize: number
}

/** WHERE 子句与配套参数 */
export type ArticleListWhere = {
  sql: string
  params: SqlValue[]
}

/**
 * LIKE 模式里需要转义的字符。
 *
 * 使用 `!` 作为转义字符（配合 SQL 的 `ESCAPE '!'`），
 * 这样 `%`、`_`、`!` 都按普通字符处理，
 * 也不会受 MySQL `NO_BACKSLASH_ESCAPES` 模式影响。
 */
const LIKE_SPECIAL_CHARS = /[!%_]/g

/**
 * 转义 LIKE 模式中的通配符。
 *
 * 关键词里的 `%` 与 `_` 会被当成普通字符，
 * 不会出现"搜索 `100%` 匹配到任意内容"这类越权放大。
 */
export function escapeLikePattern(value: string): string {
  return value.replace(LIKE_SPECIAL_CHARS, (char) => `!${char}`)
}

/**
 * 构建列表的 WHERE 子句。
 *
 * 安全约定：
 * - 条件片段只由服务端固定枚举拼装，值一律走占位符
 * - 软删除文章对所有列表都不可见（`deleted_at IS NULL`）
 * - 游客端的"只看已发布"由服务端写死，客户端无法覆盖
 */
export function buildArticleListWhere(
  scope: ArticleListScope,
  filters: ArticleListFilters,
): ArticleListWhere {
  const conditions: string[] = []
  const params: SqlValue[] = []

  // 软删除的文章在所有列表里都不可见
  conditions.push('a.deleted_at IS NULL')

  if (scope === 'public') {
    // 游客端只返回已发布文章：权限条件由服务端固定
    conditions.push('a.status = ?')
    params.push(1)
  } else if (filters.status !== null) {
    conditions.push('a.status = ?')
    params.push(filters.status)
  }

  // 分类精确匹配，不自动包含子分类
  if (filters.categoryId !== null) {
    conditions.push('a.category_id = ?')
    params.push(filters.categoryId)
  }

  // 关键词匹配标题或摘要；`%` / `_` 按普通字符处理
  if (filters.keyword !== null && filters.keyword !== '') {
    const pattern = `%${escapeLikePattern(filters.keyword)}%`
    conditions.push("(a.title LIKE ? ESCAPE '!' OR a.summary LIKE ? ESCAPE '!')")
    params.push(pattern, pattern)
  }

  return { sql: ` WHERE ${conditions.join(' AND ')}`, params }
}

/** 列表排序（固定枚举，不接受客户端指定） */
const ARTICLE_LIST_ORDER: Record<ArticleListScope, string> = {
  // 游客端：置顶优先，其次按发布时间倒序
  public: 'a.is_top DESC, a.published_at DESC, a.id DESC',
  // 后台端：置顶优先，其次按创建时间倒序
  admin: 'a.is_top DESC, a.created_at DESC, a.id DESC',
}

/** 列表与详情共用的关联列（LEFT JOIN，不读正文） */
const ARTICLE_RELATION_COLUMNS = `
       c.id   AS ref_category_id,
       c.name AS ref_category_name,
       c.slug AS ref_category_slug,
       s.id   AS ref_cover_id,
       s.path AS ref_cover_path,
       s.url  AS ref_cover_url`

/** 列表查询列（**不含正文**，避免大字段回显） */
const ARTICLE_LIST_COLUMNS = `
       a.id, a.title, a.slug, a.summary, a.cover_asset_id, a.category_id, a.status, a.is_top,
       a.view_count, a.published_at, a.created_at, a.updated_at, a.deleted_at`

/** 详情查询列（含正文） */
const ARTICLE_DETAIL_COLUMNS = `
       a.id, a.title, a.slug, a.summary, a.content, a.cover_asset_id, a.category_id, a.status,
       a.is_top, a.view_count, a.published_at, a.created_at, a.updated_at, a.deleted_at`

/** 列表行（含关联表字段） */
export type ArticleListRow = ArticleRowBase & {
  ref_category_id: number | null
  ref_category_name: string | null
  ref_category_slug: string | null
  ref_cover_id: number | null
  ref_cover_path: string | null
  ref_cover_url: string | null
}

/** 详情行（含关联表字段与正文） */
export type ArticleDetailRow = ArticleListRow & {
  content: string
}

/** 数据库行 -> 列表项 */
export function toListItem(row: ArticleListRow): ArticleListItem {
  return {
    ...toMetadata(row),
    category:
      row.ref_category_id === null || row.ref_category_id === undefined
        ? null
        : {
            id: Number(row.ref_category_id),
            name: String(row.ref_category_name ?? ''),
            slug: String(row.ref_category_slug ?? ''),
          },
    cover:
      row.ref_cover_id === null || row.ref_cover_id === undefined
        ? null
        : {
            id: Number(row.ref_cover_id),
            path: String(row.ref_cover_path ?? ''),
            url: row.ref_cover_url ?? null,
          },
  }
}

/** 数据库行 -> 详情（含正文） */
export function toDetail(row: ArticleDetailRow): ArticleDetail {
  return {
    ...toListItem(row),
    content: row.content ?? '',
  }
}

/**
 * 执行列表查询（游客端与后台端共用筛选构建与字段映射）。
 */
async function queryArticleList(
  scope: ArticleListScope,
  input: ArticleListInput,
  store: DbStore,
): Promise<ArticleListResult> {
  const where = buildArticleListWhere(scope, {
    keyword: input.keyword,
    categoryId: input.categoryId,
    status: input.status,
  })

  const rows = await store.query<ArticleListRow[]>(
    `SELECT ${ARTICLE_LIST_COLUMNS},${ARTICLE_RELATION_COLUMNS}
       FROM articles a
       LEFT JOIN categories c ON c.id = a.category_id
       LEFT JOIN static_assets s ON s.id = a.cover_asset_id${where.sql}
      ORDER BY ${ARTICLE_LIST_ORDER[scope]}
      LIMIT ? OFFSET ?`,
    [...where.params, input.pageSize, (input.page - 1) * input.pageSize],
  )

  const totalRows = await store.query<{ total: number }[]>(
    `SELECT COUNT(*) AS total FROM articles a${where.sql}`,
    where.params,
  )

  return {
    items: rows.map(toListItem),
    total: Number(totalRows[0]?.total ?? 0),
    page: input.page,
    pageSize: input.pageSize,
  }
}

/**
 * 游客端文章列表：只返回已发布且未删除的文章。
 *
 * 排序：置顶优先，其次发布时间倒序，最后按 id 倒序（保证分页稳定）。
 */
export async function listPublicArticles(
  input: {
    categoryId: number | null
    page: number
    pageSize: number
  },
  store: DbStore = defaultDbStore,
): Promise<ArticleListResult> {
  return queryArticleList(
    'public',
    {
      keyword: null,
      categoryId: input.categoryId,
      status: null,
      page: input.page,
      pageSize: input.pageSize,
    },
    store,
  )
}

/**
 * 后台端文章列表：始终排除软删除文章；省略状态时查询草稿 / 已发布 / 已下架。
 *
 * 排序：置顶优先，其次创建时间倒序，最后按 id 倒序（保证分页稳定）。
 */
export async function listAdminArticles(
  input: ArticleListInput,
  store: DbStore = defaultDbStore,
): Promise<ArticleListResult> {
  return queryArticleList('admin', input, store)
}

/**
 * 查询文章详情行（含正文与关联信息）。
 */
async function findArticleDetailRow(
  where: string,
  params: SqlValue[],
  store: DbStore,
  connection?: DbConnection,
): Promise<ArticleDetailRow | null> {
  const rows = await store.query<ArticleDetailRow[]>(
    `SELECT ${ARTICLE_DETAIL_COLUMNS},${ARTICLE_RELATION_COLUMNS}
       FROM articles a
       LEFT JOIN categories c ON c.id = a.category_id
       LEFT JOIN static_assets s ON s.id = a.cover_asset_id
      ${where}
      LIMIT 1`,
    params,
    connection,
  )
  return rows[0] ?? null
}

/**
 * 游客端文章详情（只读，不增加浏览量）。
 *
 * 草稿 / 已下架 / 已删除 / 不存在的文章统一返回 404 `40403`。
 */
export async function readPublicArticleDetail(
  slug: string,
  store: DbStore = defaultDbStore,
): Promise<ArticleDetail> {
  const row = await findArticleDetailRow(
    'WHERE a.slug = ? AND a.status = ? AND a.deleted_at IS NULL',
    [slug, 1],
    store,
  )
  if (!row) {
    throw new AppError(ErrorCode.ARTICLE_NOT_FOUND, '文章不存在')
  }
  return toDetail(row)
}

/** view_count 字段是 INT UNSIGNED，上限为 4294967295 */
export const VIEW_COUNT_MAX = 4294967295

/** 回滚失败不影响原始错误 */
async function safeRollback(connection: DbConnection): Promise<void> {
  try {
    await connection.rollback()
  } catch {
    // 忽略：连接可能已断开
  }
}

/** 归还连接失败不影响原始错误 */
function safeRelease(connection: DbConnection): void {
  try {
    connection.release()
  } catch {
    // 忽略：连接可能已失效
  }
}

/**
 * 游客端文章详情：短事务内锁定文章、自增浏览量并回读。
 *
 * 并发安全：
 * - `SELECT ... FOR UPDATE` 锁定符合条件的文章行，并发请求在这里排队
 * - 自增由数据库完成（`view_count = LEAST(view_count, 上限-1) + 1`），不会丢计数
 * - 达到无符号整数上限时保持上限，不会溢出报错
 * - 显式写 `updated_at = updated_at`，浏览量自增**不修改** `updated_at`
 * - 失败回滚并释放连接，绝不把锁留在事务里
 */
export async function readPublicArticleDetailWithViewCount(
  slug: string,
  store: DbStore = defaultDbStore,
): Promise<ArticleDetail> {
  const connection = await store.getConnection()
  let committed = false

  try {
    await connection.beginTransaction()

    // 1) 锁定符合条件的文章行（并发请求在这里串行）
    const locked = await store.query<{ id: number }[]>(
      'SELECT id FROM articles WHERE slug = ? AND status = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
      [slug, 1],
      connection,
    )

    const articleId = locked[0]?.id
    if (articleId === undefined) {
      throw new AppError(ErrorCode.ARTICLE_NOT_FOUND, '文章不存在')
    }

    // 2) 数据库自增浏览量：先压到上限-1 再加 1，避免无符号整数溢出
    await store.execute(
      `UPDATE articles SET view_count = LEAST(view_count, ${VIEW_COUNT_MAX - 1}) + 1, updated_at = updated_at WHERE id = ?`,
      [articleId],
      connection,
    )

    // 3) 回读自增后的浏览量
    const counter = await store.query<{ view_count: number }[]>(
      'SELECT view_count FROM articles WHERE id = ? LIMIT 1',
      [articleId],
      connection,
    )

    // 4) 回读完整详情
    const row = await findArticleDetailRow('WHERE a.id = ?', [articleId], store, connection)
    if (!row) {
      throw new AppError(ErrorCode.ARTICLE_NOT_FOUND, '文章不存在')
    }

    await connection.commit()
    committed = true

    return {
      ...toDetail(row),
      viewCount: Number(counter[0]?.view_count ?? row.view_count ?? 0),
    }
  } catch (error) {
    if (!committed) {
      await safeRollback(connection)
    }
    throw error
  } finally {
    safeRelease(connection)
  }
}

/**
 * 后台端文章详情：返回未删除文章的完整内容，**不增加浏览量**。
 *
 * 文章不存在或已被软删除统一返回 404 `40403`。
 */
export async function getArticleDetail(
  id: number,
  store: DbStore = defaultDbStore,
): Promise<ArticleDetail> {
  const row = await findArticleDetailRow(
    'WHERE a.id = ? AND a.deleted_at IS NULL',
    [id],
    store,
  )
  if (!row) {
    throw new AppError(ErrorCode.ARTICLE_NOT_FOUND, '文章不存在')
  }
  return toDetail(row)
}

/**
 * 批量软删除文章。
 *
 * - 只写 `articles.deleted_at`：文章行、评论与标签关联全部保留
 * - 同一事务内**按 id 升序**锁定有效文章，避免重叠批量删除互相等待形成死锁
 * - 不存在或已被软删除的 id 记入 `skippedIds`，不报错
 * - 全部跳过时同样返回成功（deletedCount = 0）
 * - 数据库异常时整批回滚
 */
export async function batchSoftDeleteArticles(
  ids: number[],
  store: DbStore = defaultDbStore,
): Promise<BatchDeleteArticlesResult> {
  const uniqueIds = [...new Set(ids)]
  if (uniqueIds.length === 0) {
    return { deletedIds: [], skippedIds: [], deletedCount: 0 }
  }

  const connection = await store.getConnection()
  let committed = false

  try {
    await connection.beginTransaction()

    // 升序锁定：重叠的批量删除请求不会形成死锁
    const ordered = [...uniqueIds].sort((a, b) => a - b)
    const locked = await store.query<{ id: number }[]>(
      `SELECT id FROM articles
        WHERE id IN (${ordered.map(() => '?').join(', ')})
          AND deleted_at IS NULL
        ORDER BY id ASC
        FOR UPDATE`,
      ordered,
      connection,
    )

    const existing = new Set(locked.map((row) => Number(row.id)))
    const deletable = ordered.filter((id) => existing.has(id))

    if (deletable.length > 0) {
      await store.execute(
        `UPDATE articles
            SET deleted_at = NOW()
          WHERE id IN (${deletable.map(() => '?').join(', ')})
            AND deleted_at IS NULL`,
        deletable,
        connection,
      )
    }

    await connection.commit()
    committed = true

    const deletedSet = new Set(deletable)
    // 返回数组按去重后的输入顺序排列
    return {
      deletedIds: uniqueIds.filter((id) => deletedSet.has(id)),
      skippedIds: uniqueIds.filter((id) => !deletedSet.has(id)),
      deletedCount: deletable.length,
    }
  } catch (error) {
    if (!committed) {
      await safeRollback(connection)
    }
    throw error
  } finally {
    safeRelease(connection)
  }
}
