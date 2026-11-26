/**
 * 文章接口的单元测试：入参校验（纯函数）+ 更新计划（纯函数）。
 *
 * 说明：
 * - 本文件只测试**不产生任何数据库读写**的逻辑
 * - 路由层的"参数校验失败在触碰数据库之前拒绝"由 parse*Request 的纯函数性质保证：
 *   校验函数只依赖入参，失败时直接返回，不调用任何 service
 * - 需要数据库的分支（slug 冲突、分类 / 封面存在性、软删除落库）由服务层负责，
 *   见 README 的验证状态说明
 */
import { describe, expect, test } from 'bun:test'
import { buildArticleUpdatePlan } from '../src/services/article.service'
import {
  ARTICLE_CONTENT_MAX_BYTES,
  ARTICLE_SUMMARY_MAX_LENGTH,
  ARTICLE_TITLE_MAX_LENGTH,
  parseCreateArticleRequest,
  parseDeleteArticleRequest,
  parseUpdateArticleRequest,
  validateArticleContent,
  validateArticleId,
  validateArticleIsTop,
  validateArticleSlug,
  validateArticleStatus,
  validateArticleSummary,
  validateArticleTitle,
  validateOptionalResourceId,
} from '../src/utils/article-validation'
import { ERROR_HTTP_STATUS, ErrorCode } from '../src/utils/response'

describe('文章错误码', () => {
  test('文章相关错误码与 HTTP 状态码映射', () => {
    expect(ERROR_HTTP_STATUS[ErrorCode.ARTICLE_NOT_FOUND]).toBe(404)
    expect(ERROR_HTTP_STATUS[ErrorCode.ARTICLE_SLUG_CONFLICT]).toBe(409)
    expect(ErrorCode.ARTICLE_NOT_FOUND).toBe(40403)
    expect(ErrorCode.ARTICLE_SLUG_CONFLICT).toBe(40904)
  })
})

describe('标题校验', () => {
  test('合法值去除首尾空白', () => {
    const result = validateArticleTitle('  协会公告  ')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('协会公告')
  })

  test('空值 / 非字符串 / 超长均失败', () => {
    expect(validateArticleTitle('').ok).toBe(false)
    expect(validateArticleTitle('   ').ok).toBe(false)
    expect(validateArticleTitle(undefined).ok).toBe(false)
    expect(validateArticleTitle(null).ok).toBe(false)
    expect(validateArticleTitle(123).ok).toBe(false)
    expect(validateArticleTitle('a'.repeat(ARTICLE_TITLE_MAX_LENGTH + 1)).ok).toBe(false)
  })

  test('长度边界：刚好 200 位合法', () => {
    expect(validateArticleTitle('a'.repeat(ARTICLE_TITLE_MAX_LENGTH)).ok).toBe(true)
  })
})

describe('slug 校验', () => {
  test('合法写法：小写字母、数字、单个连字符分隔', () => {
    for (const slug of ['news', 'news-2026', 'a1-b2-c3', '2026']) {
      expect(validateArticleSlug(slug).ok).toBe(true)
    }
  })

  test('非法写法一律拒绝', () => {
    const invalid = [
      'News', // 大写
      'news_2026', // 下划线
      'news 2026', // 空格
      '新闻', // 中文
      '-news', // 首连字符
      'news-', // 尾连字符
      'news--2026', // 连续连字符
      '', // 空
      '   ', // 纯空白
    ]
    for (const slug of invalid) {
      expect(validateArticleSlug(slug).ok).toBe(false)
    }
  })

  test('非字符串与超长均失败', () => {
    expect(validateArticleSlug(123).ok).toBe(false)
    expect(validateArticleSlug(null).ok).toBe(false)
    expect(validateArticleSlug('a'.repeat(201)).ok).toBe(false)
  })
})

describe('摘要校验', () => {
  test('undefined / null / 空串归一化为 null', () => {
    for (const raw of [undefined, null, '', '   ']) {
      const result = validateArticleSummary(raw)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toBeNull()
    }
  })

  test('合法值去除首尾空白', () => {
    const result = validateArticleSummary('  一段摘要  ')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('一段摘要')
  })

  test('非字符串与超长均失败', () => {
    expect(validateArticleSummary(123).ok).toBe(false)
    expect(validateArticleSummary('a'.repeat(ARTICLE_SUMMARY_MAX_LENGTH + 1)).ok).toBe(false)
  })
})

describe('正文校验', () => {
  test('空值 / 空白 / 非字符串均失败', () => {
    expect(validateArticleContent('').ok).toBe(false)
    expect(validateArticleContent('   \n  ').ok).toBe(false)
    expect(validateArticleContent(undefined).ok).toBe(false)
    expect(validateArticleContent(null).ok).toBe(false)
    expect(validateArticleContent(123).ok).toBe(false)
  })

  test('超长输入失败（UTF-8 编码后超过 100 KB）', () => {
    // 纯 ASCII：刚好 100 KB 合法，多 1 字节失败
    expect(validateArticleContent('a'.repeat(ARTICLE_CONTENT_MAX_BYTES)).ok).toBe(true)
    expect(validateArticleContent('a'.repeat(ARTICLE_CONTENT_MAX_BYTES + 1)).ok).toBe(false)
    // 中文按 3 字节计算：字符数没超限，字节数超限
    expect(validateArticleContent('中'.repeat(34_134)).ok).toBe(false)
  })

  test('原始 HTML 一律拒绝', () => {
    const samples = [
      '<script>alert(1)</script>',
      '<div onclick="x()">正文</div>',
      '<img src=x onerror=alert(1)>',
      '<!-- 注释 -->',
      '<!DOCTYPE html>',
      '正文中的 <b>加粗</b>',
    ]
    for (const content of samples) {
      expect(validateArticleContent(content).ok).toBe(false)
    }
  })

  test('不安全 URL scheme 一律拒绝', () => {
    const samples = [
      '[点我](javascript:alert(1))',
      '[点我](JAVASCRIPT:alert(1))',
      '[点我](vbscript:msgbox(1))',
      '[图片](data:text/html;base64,PHNjcmlwdD4=)',
      '[文件](file:///etc/passwd)',
      '裸链接 javascript:alert(1)',
    ]
    for (const content of samples) {
      expect(validateArticleContent(content).ok).toBe(false)
    }
  })

  test('混淆写法同样被拒绝（实体编码 / 控制字符 / 词内伪装）', () => {
    expect(validateArticleContent('[x](&#106;avascript:alert(1))').ok).toBe(false)
    expect(validateArticleContent('[x](java\tscript:alert(1))').ok).toBe(false)
    expect(validateArticleContent('profile: 主页').ok).toBe(true)
    expect(validateArticleContent('Data: 说明文字').ok).toBe(true)
  })

  test('正常 Markdown 合法', () => {
    const samples = [
      '# 标题\n\n正文段落。',
      '## 小节\n\n- 列表项\n- 列表项',
      '[链接](https://example.com/docs)',
      '![图片](https://example.com/a.png)',
      '> 引用\n\n```js\nconsole.log(1)\n```',
      '行内代码 `code` 与 **加粗**、*斜体*',
      '尖括号自动链接 <https://example.com>',
    ]
    for (const content of samples) {
      expect(validateArticleContent(content).ok).toBe(true)
    }
  })

  test('归一化：统一换行符并去掉首尾空白', () => {
    const result = validateArticleContent('\r\n  正文  \r\n')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('正文')
  })
})

describe('状态与置顶校验', () => {
  test('状态只接受 0 / 1 / 2', () => {
    for (const status of [0, 1, 2] as const) {
      const result = validateArticleStatus(status)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toBe(status)
    }
  })

  test('非法状态一律拒绝', () => {
    for (const status of [3, -1, 1.5, '1', 'published', true, null, undefined]) {
      expect(validateArticleStatus(status).ok).toBe(false)
    }
  })

  test('is_top 只接受布尔值', () => {
    expect(validateArticleIsTop(true).ok).toBe(true)
    expect(validateArticleIsTop(false).ok).toBe(true)
    for (const value of [0, 1, 'true', null, undefined]) {
      expect(validateArticleIsTop(value).ok).toBe(false)
    }
  })
})

describe('ID 校验', () => {
  test('文章 id 必须是正安全整数', () => {
    const result = validateArticleId(12)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(12)
    for (const value of [0, -1, 1.5, '12', null, undefined, Number.MAX_SAFE_INTEGER + 2]) {
      expect(validateArticleId(value).ok).toBe(false)
    }
  })

  test('关联资源 id 允许缺省与 null', () => {
    const missing = validateOptionalResourceId(undefined, 'category_id')
    expect(missing.ok).toBe(true)
    if (missing.ok) expect(missing.value).toBeNull()

    const explicitNull = validateOptionalResourceId(null, 'category_id')
    expect(explicitNull.ok).toBe(true)
    if (explicitNull.ok) expect(explicitNull.value).toBeNull()

    const valid = validateOptionalResourceId(7, 'category_id')
    expect(valid.ok).toBe(true)
    if (valid.ok) expect(valid.value).toBe(7)
  })

  test('关联资源 id 非法值失败', () => {
    for (const value of [0, -1, 1.5, '7', true]) {
      expect(validateOptionalResourceId(value, 'category_id').ok).toBe(false)
    }
  })
})

describe('创建请求解析', () => {
  test('必填字段缺失即失败', () => {
    expect(parseCreateArticleRequest({ slug: 'a', content: 'x' }).ok).toBe(false)
    expect(parseCreateArticleRequest({ title: '标题', content: 'x' }).ok).toBe(false)
    expect(parseCreateArticleRequest({ title: '标题', slug: 'a' }).ok).toBe(false)
  })

  test('可选字段缺省时取默认值', () => {
    const result = parseCreateArticleRequest({ title: '标题', slug: 'news-1', content: '正文' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.status).toBe(0)
    expect(result.value.isTop).toBe(false)
    expect(result.value.summary).toBeNull()
    expect(result.value.coverAssetId).toBeNull()
    expect(result.value.categoryId).toBeNull()
  })

  test('完整请求通过并归一化', () => {
    const result = parseCreateArticleRequest({
      title: '  标题  ',
      slug: 'news-1',
      content: '  正文  ',
      summary: '  摘要  ',
      cover_asset_id: 3,
      category_id: 2,
      status: 1,
      is_top: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({
      title: '标题',
      slug: 'news-1',
      content: '正文',
      summary: '摘要',
      coverAssetId: 3,
      categoryId: 2,
      status: 1,
      isTop: true,
    })
  })

  test('未知字段一律拒绝', () => {
    const result = parseCreateArticleRequest({
      title: '标题',
      slug: 'news-1',
      content: '正文',
      view_count: 100,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('view_count')
  })

  test('请求体不是 JSON 对象即失败', () => {
    expect(parseCreateArticleRequest(null).ok).toBe(false)
    expect(parseCreateArticleRequest([]).ok).toBe(false)
    expect(parseCreateArticleRequest('title').ok).toBe(false)
  })
})

describe('修改请求解析', () => {
  test('缺少 id 即失败', () => {
    expect(parseUpdateArticleRequest({ title: '标题' }).ok).toBe(false)
  })

  test('只有 id 而没有任何可修改字段即失败', () => {
    const result = parseUpdateArticleRequest({ id: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('至少需要提供一个要修改的字段')
  })

  test('部分更新：只返回请求中提供的字段', () => {
    const result = parseUpdateArticleRequest({ id: 5, status: 2 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({ id: 5, status: 2 })
    expect('title' in result.value).toBe(false)
    expect('content' in result.value).toBe(false)
  })

  test('清空摘要 / 封面 / 分类传 null', () => {
    const result = parseUpdateArticleRequest({
      id: 5,
      summary: '',
      cover_asset_id: null,
      category_id: null,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.summary).toBeNull()
    expect(result.value.coverAssetId).toBeNull()
    expect(result.value.categoryId).toBeNull()
  })

  test('未知字段一律拒绝', () => {
    const result = parseUpdateArticleRequest({ id: 5, published_at: '2026-01-01 00:00:00' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('published_at')
  })
})

describe('删除请求解析', () => {
  test('必须提供 id', () => {
    expect(parseDeleteArticleRequest({}).ok).toBe(false)
    expect(parseDeleteArticleRequest({ id: 0 }).ok).toBe(false)
  })

  test('合法 id 通过', () => {
    const result = parseDeleteArticleRequest({ id: 12 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.id).toBe(12)
  })

  test('未知字段一律拒绝', () => {
    const result = parseDeleteArticleRequest({ id: 12, force: true })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('force')
  })
})

describe('buildArticleUpdatePlan（只更新变化字段）', () => {
  const current = {
    title: '标题',
    slug: 'news-1',
    content: '正文',
    summary: '摘要',
    coverAssetId: 3,
    categoryId: 2,
    status: 0 as const,
    isTop: false,
  }

  test('未提供任何字段 -> 空计划', () => {
    const plan = buildArticleUpdatePlan(current, {})
    expect(plan.sets).toEqual([])
    expect(plan.changedFields).toEqual([])
  })

  test('字段值与当前值相同 -> 不进入 SET 子句', () => {
    const plan = buildArticleUpdatePlan(current, {
      title: '标题',
      status: 0,
      isTop: false,
    })
    expect(plan.sets).toEqual([])
    expect(plan.changedFields).toEqual([])
  })

  test('只改标题 -> 只含 title', () => {
    const plan = buildArticleUpdatePlan(current, { title: '新标题' })
    expect(plan.sets).toEqual(['title = ?'])
    expect(plan.values).toEqual(['新标题'])
    expect(plan.changedFields).toEqual(['title'])
  })

  test('清空摘要 / 封面 / 分类 -> 写入 null', () => {
    const plan = buildArticleUpdatePlan(current, {
      summary: null,
      coverAssetId: null,
      categoryId: null,
    })
    expect(plan.sets).toEqual(['summary = ?', 'cover_asset_id = ?', 'category_id = ?'])
    expect(plan.values).toEqual([null, null, null])
    expect(plan.changedFields).toEqual(['summary', 'cover_asset_id', 'category_id'])
  })

  test('置顶写入 1 / 0', () => {
    const on = buildArticleUpdatePlan(current, { isTop: true })
    expect(on.sets).toEqual(['is_top = ?'])
    expect(on.values).toEqual([1])

    const off = buildArticleUpdatePlan({ ...current, isTop: true }, { isTop: false })
    expect(off.values).toEqual([0])
  })

  test('同时改多个字段 -> 全部进入计划', () => {
    const plan = buildArticleUpdatePlan(current, { title: '新标题', status: 1, content: '新正文' })
    expect(plan.changedFields).toEqual(['title', 'content', 'status'])
    expect(plan.sets).toEqual(['title = ?', 'content = ?', 'status = ?'])
  })
})
