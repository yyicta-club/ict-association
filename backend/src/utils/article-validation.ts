/**
 * 文章入参校验（纯函数，无副作用，便于单测）。
 *
 * 约定：
 * - 返回值统一为 Result 形式：成功带 value，失败带可直接展示给用户的中文文案
 * - 长度上限与 articles 表结构对齐，避免写入时才发现超长
 * - 校验失败一律发生在任何数据库读写之前（路由层先跑本模块，再进服务层）
 * - 报错文案不回显用户输入，避免把正文 / 标题等原始内容写进日志
 */
import type { ValidationResult } from './validation'

/** 标题最大长度，对齐 articles.title VARCHAR(200) */
export const ARTICLE_TITLE_MAX_LENGTH = 200

/** slug 最大长度，对齐 articles.slug VARCHAR(200) */
export const ARTICLE_SLUG_MAX_LENGTH = 200

/** 摘要最大长度，对齐 articles.summary VARCHAR(500) */
export const ARTICLE_SUMMARY_MAX_LENGTH = 500

/** 正文最大字节数（UTF-8 编码后 100 KB），用于限制请求体大小 */
export const ARTICLE_CONTENT_MAX_BYTES = 100 * 1024

/** 文章状态枚举：0 草稿 / 1 已发布 / 2 已下架 */
export const ARTICLE_STATUSES = [0, 1, 2] as const

export type ArticleStatus = (typeof ARTICLE_STATUSES)[number]

/** 状态 -> 中文说明（仅用于提示文案，不入库） */
export const ARTICLE_STATUS_LABELS: Record<ArticleStatus, string> = {
  0: '草稿',
  1: '已发布',
  2: '已下架',
}

/**
 * slug 字符集：小写字母、数字，单个连字符分隔。
 * 不允许大写字母、空格、下划线、中文，也不允许首尾连字符与连续连字符。
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** HTML 注释 */
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/

/**
 * HTML 标签。
 *
 * 标签名后必须跟空白、`/` 或 `>`，因此 Markdown 的尖括号自动链接
 * （`<https://example.com>`）不会被误判为原始 HTML。
 */
const HTML_TAG_PATTERN = /<\s*\/?\s*[a-zA-Z][a-zA-Z0-9-]*(\s[^<>]*)?\/?>/

/** HTML 声明（DOCTYPE / CDATA） */
const HTML_DECLARATION_PATTERN = /<!\s*(?:DOCTYPE|CDATA|\[CDATA)/i

/** 不安全的 URL scheme：可执行脚本或可读取本地文件 */
const UNSAFE_URL_SCHEMES = ['javascript', 'vbscript', 'data', 'file'] as const

/**
 * 不安全 scheme 匹配。
 *
 * - 前置断言：前面不能紧跟字母 / 数字 / `+` / `.` / `-`，
 *   避免把 `profile:` 之类的普通单词误判成 `file:`
 * - 冒号后必须是紧贴的非空白字符，避免把 `Data: 说明` 这类中文散文误判
 */
const UNSAFE_URL_SCHEME_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}+.-])(?:${UNSAFE_URL_SCHEMES.join('|')})\\s*:(?=\\S)`,
  'iu',
)

/** UTF-8 字节长度（不依赖 Node 的 Buffer，浏览器 / Bun / Deno 通用） */
const textEncoder = new TextEncoder()

/** 计算字符串的 UTF-8 字节数 */
export function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).length
}

/**
 * 归一化正文，用于扫描不安全的 URL scheme。
 *
 * - 解码常见 HTML 实体（&#106; / &#x6A;），挡住实体编码绕过
 * - 去掉控制字符（制表符 / 换行 / 零宽字符），挡住 `java\tscript:` 这类混淆
 * - 转小写，挡住大小写混淆
 */
function normalizeForSchemeScan(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeFromCodePoint(Number(dec)))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .toLowerCase()
}

/** 把码点转成字符，非法码点一律退回空串 */
function safeFromCodePoint(codePoint: number): string {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return ''
  try {
    return String.fromCodePoint(codePoint)
  } catch {
    return ''
  }
}

/** 判断正文里是否出现不安全的 URL scheme */
export function hasUnsafeUrlScheme(content: string): boolean {
  return UNSAFE_URL_SCHEME_PATTERN.test(normalizeForSchemeScan(content))
}

/** 判断正文里是否出现原始 HTML */
export function hasRawHtml(content: string): boolean {
  return (
    HTML_COMMENT_PATTERN.test(content) ||
    HTML_TAG_PATTERN.test(content) ||
    HTML_DECLARATION_PATTERN.test(content)
  )
}

/**
 * 校验并归一化标题。
 * 去除首尾空白；长度上限对齐 articles.title。
 */
export function validateArticleTitle(raw: unknown): ValidationResult<string> {
  if (raw === undefined || raw === null) {
    return { ok: false, message: '标题不能为空' }
  }
  if (typeof raw !== 'string') {
    return { ok: false, message: '标题必须是字符串' }
  }
  const value = raw.trim()
  if (value === '') {
    return { ok: false, message: '标题不能为空' }
  }
  if (value.length > ARTICLE_TITLE_MAX_LENGTH) {
    return { ok: false, message: `标题长度不能超过 ${ARTICLE_TITLE_MAX_LENGTH} 位` }
  }
  return { ok: true, value }
}

/**
 * 校验并归一化 slug（URL 标识）。
 * 只允许小写字母、数字与连字符；不区分大小写地拒绝非法写法。
 */
export function validateArticleSlug(raw: unknown): ValidationResult<string> {
  if (raw === undefined || raw === null) {
    return { ok: false, message: 'slug 不能为空' }
  }
  if (typeof raw !== 'string') {
    return { ok: false, message: 'slug 必须是字符串' }
  }
  const value = raw.trim()
  if (value === '') {
    return { ok: false, message: 'slug 不能为空' }
  }
  if (value.length > ARTICLE_SLUG_MAX_LENGTH) {
    return { ok: false, message: `slug 长度不能超过 ${ARTICLE_SLUG_MAX_LENGTH} 位` }
  }
  if (!SLUG_PATTERN.test(value)) {
    return { ok: false, message: 'slug 只能包含小写字母、数字和连字符' }
  }
  return { ok: true, value }
}

/**
 * 校验并归一化摘要。
 * undefined / null / 空串 / 纯空白 -> null（不填摘要；修改时视为清空）。
 */
export function validateArticleSummary(raw: unknown): ValidationResult<string | null> {
  if (raw === undefined || raw === null) {
    return { ok: true, value: null }
  }
  if (typeof raw !== 'string') {
    return { ok: false, message: '摘要必须是字符串' }
  }
  const value = raw.trim()
  if (value === '') {
    return { ok: true, value: null }
  }
  if (value.length > ARTICLE_SUMMARY_MAX_LENGTH) {
    return { ok: false, message: `摘要长度不能超过 ${ARTICLE_SUMMARY_MAX_LENGTH} 位` }
  }
  return { ok: true, value }
}

/**
 * 校验并归一化正文（纯 Markdown）。
 *
 * 拒绝：空值、非字符串、超过 100 KB、原始 HTML、不安全的 URL scheme。
 * 归一化：统一换行符为 \n，并去掉首尾空白。
 */
export function validateArticleContent(raw: unknown): ValidationResult<string> {
  if (raw === undefined || raw === null) {
    return { ok: false, message: '正文不能为空' }
  }
  if (typeof raw !== 'string') {
    return { ok: false, message: '正文必须是字符串' }
  }
  const value = raw.replace(/\r\n/g, '\n').trim()
  if (value === '') {
    return { ok: false, message: '正文不能为空' }
  }
  // 字节数不少于字符数，先用长度快速判断，避免为超大正文分配编码缓冲
  if (value.length > ARTICLE_CONTENT_MAX_BYTES) {
    return { ok: false, message: `正文长度不能超过 ${ARTICLE_CONTENT_MAX_BYTES} 字节` }
  }
  if (utf8ByteLength(value) > ARTICLE_CONTENT_MAX_BYTES) {
    return { ok: false, message: `正文长度不能超过 ${ARTICLE_CONTENT_MAX_BYTES} 字节` }
  }
  if (hasRawHtml(value)) {
    return { ok: false, message: '正文只允许 Markdown，不允许原始 HTML' }
  }
  if (hasUnsafeUrlScheme(value)) {
    return { ok: false, message: '正文包含不安全的链接地址，只允许 http/https 等安全协议' }
  }
  return { ok: true, value }
}

/**
 * 校验文章状态。
 * 只接受数字 0 / 1 / 2；字符串、布尔值一律拒绝。
 */
export function validateArticleStatus(raw: unknown): ValidationResult<ArticleStatus> {
  if (raw === undefined || raw === null) {
    return { ok: false, message: '状态必须是数字 0 / 1 / 2' }
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    return { ok: false, message: '状态必须是数字 0 / 1 / 2' }
  }
  if (!(ARTICLE_STATUSES as readonly number[]).includes(raw)) {
    const hint = ARTICLE_STATUSES.map((s) => `${s}（${ARTICLE_STATUS_LABELS[s]}）`).join('/ ')
    return { ok: false, message: `状态只能是 ${hint}` }
  }
  return { ok: true, value: raw as ArticleStatus }
}

/**
 * 校验置顶标记。
 * 只接受布尔值 true / false；0 / 1 这类数字一律拒绝。
 */
export function validateArticleIsTop(raw: unknown): ValidationResult<boolean> {
  if (typeof raw !== 'boolean') {
    return { ok: false, message: 'is_top 必须是布尔值 true / false' }
  }
  return { ok: true, value: raw }
}

/**
 * 校验文章 id：必须是正安全整数（数字类型）。
 */
export function validateArticleId(raw: unknown): ValidationResult<number> {
  if (raw === undefined || raw === null) {
    return { ok: false, message: 'id 必须是正整数' }
  }
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) {
    return { ok: false, message: 'id 必须是正整数' }
  }
  return { ok: true, value: raw }
}

/**
 * 校验可选的关联资源 id（封面 / 分类）。
 *
 * - undefined / null -> null（不关联 / 清空关联）
 * - 正安全整数 -> 该 id
 * - 其它类型（字符串、小数、负数、布尔）-> 失败
 */
export function validateOptionalResourceId(
  raw: unknown,
  label: string,
): ValidationResult<number | null> {
  if (raw === undefined || raw === null) {
    return { ok: true, value: null }
  }
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) {
    return { ok: false, message: `${label} 必须是正整数` }
  }
  return { ok: true, value: raw }
}

/** 创建接口允许的字段 */
export const CREATE_ARTICLE_FIELDS = [
  'title',
  'slug',
  'content',
  'summary',
  'cover_asset_id',
  'category_id',
  'status',
  'is_top',
] as const

/** 修改接口允许的字段（id 为定位字段，不算可修改字段） */
export const UPDATE_ARTICLE_FIELDS = [
  'id',
  'title',
  'slug',
  'content',
  'summary',
  'cover_asset_id',
  'category_id',
  'status',
  'is_top',
] as const

/** 删除接口允许的字段 */
export const DELETE_ARTICLE_FIELDS = ['id'] as const

/** 批量删除接口允许的字段 */
export const BATCH_DELETE_ARTICLE_FIELDS = ['ids'] as const

/** 游客文章列表允许的查询参数 */
export const TOURIST_ARTICLE_LIST_FIELDS = ['category_id', 'page', 'pageSize'] as const

/** 后台文章列表允许的查询参数 */
export const ADMIN_ARTICLE_LIST_FIELDS = [
  'keyword',
  'category_id',
  'status',
  'page',
  'pageSize',
] as const

/** 后台文章详情允许的查询参数 */
export const ADMIN_ARTICLE_DETAIL_FIELDS = ['id'] as const

/** 关键词最大长度 */
export const ARTICLE_KEYWORD_MAX_LENGTH = 200

/** 列表默认页码 */
export const ARTICLE_PAGE_DEFAULT = 1

/** 列表默认每页条数 */
export const ARTICLE_PAGE_SIZE_DEFAULT = 20

/** 列表页码上限（避免 OFFSET 溢出） */
export const ARTICLE_PAGE_MAX = 1_000_000

/** 列表每页条数上限 */
export const ARTICLE_PAGE_SIZE_MAX = 100

/** 批量删除：原始数组最少项数 */
export const BATCH_DELETE_MIN_IDS = 1

/** 批量删除：原始数组最多项数（去重前的原始长度） */
export const BATCH_DELETE_MAX_IDS = 100

/** 批量删除请求体上限（8 KiB，按实际读取到的字节数判断） */
export const BATCH_DELETE_BODY_MAX_BYTES = 8 * 1024

/**
 * 拒绝未知字段。
 * 请求体只允许出现白名单里的字段，多余字段一律 400。
 */
export function rejectUnknownFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
): ValidationResult<true> {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    return { ok: false, message: `不支持的字段: ${unknown.join(', ')}` }
  }
  return { ok: true, value: true }
}

/** 判断请求体是否为 JSON 对象（排除数组与 null） */
function isJsonObject(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
}

/** 创建接口的解析结果 */
export type CreateArticleRequest = {
  title: string
  slug: string
  content: string
  summary: string | null
  coverAssetId: number | null
  categoryId: number | null
  status: ArticleStatus
  isTop: boolean
}

/** 修改接口的解析结果：字段缺省表示"不修改该字段" */
export type UpdateArticleRequest = {
  id: number
  title?: string
  slug?: string
  content?: string
  summary?: string | null
  coverAssetId?: number | null
  categoryId?: number | null
  status?: ArticleStatus
  isTop?: boolean
}

/** 批量删除接口的解析结果 */
export type BatchDeleteArticleRequest = {
  /** 去重后的文章 id（按首次出现顺序） */
  ids: number[]
}

/**
 * 解析并校验创建文章的请求体。
 *
 * 纯函数：任何失败都在这里返回，不会有任何数据库读写。
 */
export function parseCreateArticleRequest(body: unknown): ValidationResult<CreateArticleRequest> {
  if (!isJsonObject(body)) {
    return { ok: false, message: '请求体必须是 JSON 对象' }
  }

  const unknown = rejectUnknownFields(body, CREATE_ARTICLE_FIELDS)
  if (!unknown.ok) return unknown

  const title = validateArticleTitle(body.title)
  if (!title.ok) return title

  const slug = validateArticleSlug(body.slug)
  if (!slug.ok) return slug

  const content = validateArticleContent(body.content)
  if (!content.ok) return content

  const summary = validateArticleSummary(body.summary)
  if (!summary.ok) return summary

  const coverAssetId = validateOptionalResourceId(body.cover_asset_id, 'cover_asset_id')
  if (!coverAssetId.ok) return coverAssetId

  const categoryId = validateOptionalResourceId(body.category_id, 'category_id')
  if (!categoryId.ok) return categoryId

  // 缺省状态为草稿（0）
  const status = validateArticleStatus(body.status === undefined ? 0 : body.status)
  if (!status.ok) return status

  // 缺省不置顶
  const isTop = validateArticleIsTop(body.is_top === undefined ? false : body.is_top)
  if (!isTop.ok) return isTop

  return {
    ok: true,
    value: {
      title: title.value,
      slug: slug.value,
      content: content.value,
      summary: summary.value,
      coverAssetId: coverAssetId.value,
      categoryId: categoryId.value,
      status: status.value,
      isTop: isTop.value,
    },
  }
}

/**
 * 解析并校验修改文章的请求体。
 *
 * 纯函数：任何失败都在这里返回，不会有任何数据库读写。
 */
export function parseUpdateArticleRequest(body: unknown): ValidationResult<UpdateArticleRequest> {
  if (!isJsonObject(body)) {
    return { ok: false, message: '请求体必须是 JSON 对象' }
  }

  const unknown = rejectUnknownFields(body, UPDATE_ARTICLE_FIELDS)
  if (!unknown.ok) return unknown

  const id = validateArticleId(body.id)
  if (!id.ok) return id

  const result: UpdateArticleRequest = { id: id.value }

  if (body.title !== undefined) {
    const title = validateArticleTitle(body.title)
    if (!title.ok) return title
    result.title = title.value
  }

  if (body.slug !== undefined) {
    const slug = validateArticleSlug(body.slug)
    if (!slug.ok) return slug
    result.slug = slug.value
  }

  if (body.content !== undefined) {
    const content = validateArticleContent(body.content)
    if (!content.ok) return content
    result.content = content.value
  }

  if (body.summary !== undefined) {
    const summary = validateArticleSummary(body.summary)
    if (!summary.ok) return summary
    result.summary = summary.value
  }

  if (body.cover_asset_id !== undefined) {
    const coverAssetId = validateOptionalResourceId(body.cover_asset_id, 'cover_asset_id')
    if (!coverAssetId.ok) return coverAssetId
    result.coverAssetId = coverAssetId.value
  }

  if (body.category_id !== undefined) {
    const categoryId = validateOptionalResourceId(body.category_id, 'category_id')
    if (!categoryId.ok) return categoryId
    result.categoryId = categoryId.value
  }

  if (body.status !== undefined) {
    const status = validateArticleStatus(body.status)
    if (!status.ok) return status
    result.status = status.value
  }

  if (body.is_top !== undefined) {
    const isTop = validateArticleIsTop(body.is_top)
    if (!isTop.ok) return isTop
    result.isTop = isTop.value
  }

  // 至少要有一个可修改字段
  const updatableKeys = Object.keys(result).filter((key) => key !== 'id')
  if (updatableKeys.length === 0) {
    return { ok: false, message: '至少需要提供一个要修改的字段' }
  }

  return { ok: true, value: result }
}

/**
 * 解析并校验删除文章的请求体。
 * 纯函数：任何失败都在这里返回，不会有任何数据库读写。
 */
export function parseDeleteArticleRequest(body: unknown): ValidationResult<{ id: number }> {
  if (!isJsonObject(body)) {
    return { ok: false, message: '请求体必须是 JSON 对象' }
  }

  const unknown = rejectUnknownFields(body, DELETE_ARTICLE_FIELDS)
  if (!unknown.ok) return unknown

  const id = validateArticleId(body.id)
  if (!id.ok) return id

  return { ok: true, value: { id: id.value } }
}

/**
 * 解析并校验批量软删除文章的请求体。
 *
 * 规则：
 * - 请求体必须是 JSON 对象，且只允许 `ids` 一个字段
 * - `ids` 必须是数组，原始长度 1..100（**按原始数组长度判断**，去重前）
 * - 每一项都必须是**数字类型**的正安全整数（字符串、小数、负数、布尔一律拒绝）
 * - 先完整校验，再按**首次出现顺序**去重
 */
export function parseBatchDeleteArticleRequest(
  body: unknown,
): ValidationResult<BatchDeleteArticleRequest> {
  if (!isJsonObject(body)) {
    return { ok: false, message: '请求体必须是 JSON 对象' }
  }

  const unknown = rejectUnknownFields(body, BATCH_DELETE_ARTICLE_FIELDS)
  if (!unknown.ok) return unknown

  const raw = body.ids
  if (!Array.isArray(raw)) {
    return { ok: false, message: 'ids 必须是数组' }
  }

  if (raw.length < BATCH_DELETE_MIN_IDS || raw.length > BATCH_DELETE_MAX_IDS) {
    return {
      ok: false,
      message: `ids 的数量必须在 ${BATCH_DELETE_MIN_IDS} 到 ${BATCH_DELETE_MAX_IDS} 之间`,
    }
  }

  const ids: number[] = []
  const seen = new Set<number>()
  for (const item of raw) {
    const id = validateArticleId(item)
    if (!id.ok) return id
    if (seen.has(id.value)) continue
    seen.add(id.value)
    ids.push(id.value)
  }

  return { ok: true, value: { ids } }
}

/* ============================ 查询参数解析 ============================ */

/** 查询参数条目（保留重复出现的参数） */
export type QueryEntries = Map<string, string[]>

/**
 * 解析查询字符串，**保留重复参数**。
 *
 * Hono 的 `c.req.query()` 对同名参数只返回第一个值，
 * 这里自己解析，才能识别"重复查询参数"这类非法输入。
 */
export function parseQueryEntries(search: string): QueryEntries {
  const entries: QueryEntries = new Map()
  const raw = search.startsWith('?') ? search.slice(1) : search
  if (raw === '') return entries

  for (const [key, value] of new URLSearchParams(raw).entries()) {
    const list = entries.get(key)
    if (list) {
      list.push(value)
    } else {
      entries.set(key, [value])
    }
  }
  return entries
}

/**
 * 校验查询参数的结构：未知参数与重复参数一律拒绝。
 */
function validateQueryShape(
  entries: QueryEntries,
  allowed: readonly string[],
): ValidationResult<true> {
  const unknown = [...entries.keys()].filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    return { ok: false, message: `不支持的参数: ${unknown.join(', ')}` }
  }
  for (const [key, values] of entries) {
    if (values.length > 1) {
      return { ok: false, message: `参数 ${key} 不能重复` }
    }
  }
  return { ok: true, value: true }
}

/**
 * 解析带范围的整数查询参数。
 *
 * 只接受十进制整数字符串（`"1"` 合法；`"1.5"` / `"abc"` / `"-1"` / `""` 一律拒绝）。
 */
function parseBoundedIntParam(
  raw: string,
  name: string,
  min: number,
  max: number,
): ValidationResult<number> {
  const value = raw.trim()
  if (!/^\d+$/.test(value)) {
    return { ok: false, message: `${name} 必须是整数` }
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    return { ok: false, message: `${name} 必须在 ${min} 到 ${max} 之间` }
  }
  return { ok: true, value: parsed }
}

/** 解析分页参数（缺省 page=1 / pageSize=20，超界一律失败） */
function parsePagingParams(
  entries: QueryEntries,
): ValidationResult<{ page: number; pageSize: number }> {
  const pageRaw = entries.get('page')?.[0]
  const pageSizeRaw = entries.get('pageSize')?.[0]

  const page =
    pageRaw === undefined
      ? ({ ok: true, value: ARTICLE_PAGE_DEFAULT } as const)
      : parseBoundedIntParam(pageRaw, 'page', 1, ARTICLE_PAGE_MAX)
  if (!page.ok) return page

  const pageSize =
    pageSizeRaw === undefined
      ? ({ ok: true, value: ARTICLE_PAGE_SIZE_DEFAULT } as const)
      : parseBoundedIntParam(pageSizeRaw, 'pageSize', 1, ARTICLE_PAGE_SIZE_MAX)
  if (!pageSize.ok) return pageSize

  return { ok: true, value: { page: page.value, pageSize: pageSize.value } }
}

/** 解析分类筛选参数（精确匹配，不自动包含子分类） */
function parseCategoryIdParam(entries: QueryEntries): ValidationResult<number | null> {
  const raw = entries.get('category_id')?.[0]
  if (raw === undefined) return { ok: true, value: null }
  const parsed = parseBoundedIntParam(raw, 'category_id', 1, Number.MAX_SAFE_INTEGER)
  if (!parsed.ok) return parsed
  return { ok: true, value: parsed.value }
}

/** 解析关键词参数（去首尾空白；空值视为不筛选） */
function parseKeywordParam(entries: QueryEntries): ValidationResult<string | null> {
  const raw = entries.get('keyword')?.[0]
  if (raw === undefined) return { ok: true, value: null }
  const value = raw.trim()
  if (value === '') return { ok: true, value: null }
  if (value.length > ARTICLE_KEYWORD_MAX_LENGTH) {
    return { ok: false, message: `关键词长度不能超过 ${ARTICLE_KEYWORD_MAX_LENGTH} 位` }
  }
  return { ok: true, value }
}

/** 解析状态筛选参数（只接受 0 / 1 / 2） */
function parseStatusParam(entries: QueryEntries): ValidationResult<ArticleStatus | null> {
  const raw = entries.get('status')?.[0]
  if (raw === undefined) return { ok: true, value: null }
  const value = raw.trim()
  if (!/^[0-2]$/.test(value)) {
    return { ok: false, message: 'status 只能是 0（草稿）/ 1（已发布）/ 2（已下架）' }
  }
  return { ok: true, value: Number(value) as ArticleStatus }
}

/** 游客文章列表的查询参数 */
export type TouristArticleListQuery = {
  categoryId: number | null
  page: number
  pageSize: number
}

/**
 * 解析游客文章列表的查询参数。
 *
 * 只接受 `category_id` / `page` / `pageSize`；未知参数、重复参数一律 400。
 */
export function parseTouristArticleListQuery(
  search: string,
): ValidationResult<TouristArticleListQuery> {
  const entries = parseQueryEntries(search)

  const shape = validateQueryShape(entries, TOURIST_ARTICLE_LIST_FIELDS)
  if (!shape.ok) return shape

  const paging = parsePagingParams(entries)
  if (!paging.ok) return paging

  const categoryId = parseCategoryIdParam(entries)
  if (!categoryId.ok) return categoryId

  return {
    ok: true,
    value: {
      categoryId: categoryId.value,
      page: paging.value.page,
      pageSize: paging.value.pageSize,
    },
  }
}

/** 后台文章列表的查询参数 */
export type AdminArticleListQuery = {
  keyword: string | null
  categoryId: number | null
  status: ArticleStatus | null
  page: number
  pageSize: number
}

/**
 * 解析后台文章列表的查询参数。
 *
 * 只接受 `keyword` / `category_id` / `status` / `page` / `pageSize`；
 * 未知参数、重复参数一律 400。
 */
export function parseAdminArticleListQuery(
  search: string,
): ValidationResult<AdminArticleListQuery> {
  const entries = parseQueryEntries(search)

  const shape = validateQueryShape(entries, ADMIN_ARTICLE_LIST_FIELDS)
  if (!shape.ok) return shape

  const paging = parsePagingParams(entries)
  if (!paging.ok) return paging

  const keyword = parseKeywordParam(entries)
  if (!keyword.ok) return keyword

  const categoryId = parseCategoryIdParam(entries)
  if (!categoryId.ok) return categoryId

  const status = parseStatusParam(entries)
  if (!status.ok) return status

  return {
    ok: true,
    value: {
      keyword: keyword.value,
      categoryId: categoryId.value,
      status: status.value,
      page: paging.value.page,
      pageSize: paging.value.pageSize,
    },
  }
}

/** 后台文章详情的查询参数 */
export type AdminArticleDetailQuery = {
  id: number
}

/**
 * 解析后台文章详情的查询参数（`id` 必填，必须是正安全整数）。
 */
export function parseArticleDetailQuery(
  search: string,
): ValidationResult<AdminArticleDetailQuery> {
  const entries = parseQueryEntries(search)

  const shape = validateQueryShape(entries, ADMIN_ARTICLE_DETAIL_FIELDS)
  if (!shape.ok) return shape

  const raw = entries.get('id')?.[0]
  if (raw === undefined) {
    return { ok: false, message: 'id 必须是正整数' }
  }

  const parsed = parseBoundedIntParam(raw, 'id', 1, Number.MAX_SAFE_INTEGER)
  if (!parsed.ok) {
    return { ok: false, message: 'id 必须是正整数' }
  }

  return { ok: true, value: { id: parsed.value } }
}
