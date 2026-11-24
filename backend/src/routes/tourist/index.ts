/**
 * /tourist 路由组（游客端公开接口占位）。
 * 后续的新闻列表、文章详情、评论等接口都在这里扩展。
 */
import { Hono } from 'hono'
import type { HonoEnv } from '../../types'
import { success } from '../../utils/response'

export const touristRoutes = new Hono<HonoEnv>()

touristRoutes.get('/', (c) => c.json(success({ module: 'tourist', status: 'ready' }, '游客端接口占位')))

touristRoutes.get('/ping', (c) => c.json(success({ pong: true }, 'pong')))
