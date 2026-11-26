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
