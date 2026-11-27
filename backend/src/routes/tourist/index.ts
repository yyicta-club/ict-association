/**
 * /tourist 路由组（游客端公开接口）。
 * 后续的评论、分类、轮播图等接口都在这里扩展。
 */
import { Hono } from 'hono'
import type { HonoEnv } from '../../types'
import { success } from '../../utils/response'
import { touristArticleRoutes } from './article'
import { touristStaticFileRoutes } from './static-file'

export const touristRoutes = new Hono<HonoEnv>()

touristRoutes.get('/', (c) => c.json(success({ module: 'tourist', status: 'ready' }, '游客端接口占位')))

touristRoutes.get('/ping', (c) => c.json(success({ pong: true }, 'pong')))

// 静态资源上传（公开入口，只允许评论配图）
touristRoutes.route('/static-files', touristStaticFileRoutes)

// 文章列表与详情（公开入口，只返回已发布且未删除的文章）
touristRoutes.route('/articles', touristArticleRoutes)
