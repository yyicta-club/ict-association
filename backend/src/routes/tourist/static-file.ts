/**
 * 游客端静态资源路由：POST /tourist/static-files/upload
 *
 * 安全约定：
 * - 公开入口，但只允许上传评论配图（comment）
 * - 提交其它合法分类 -> 403；未知分类 -> 400
 * - 与管理员入口共用同一个 IP 限流配额
 */
import { Hono } from 'hono'
import { uploadRateLimit } from '../../middlewares/upload-rate-limit'
import { SHARED_UPLOAD_CATEGORIES } from '../../services/static-file.service'
import type { HonoEnv } from '../../types'
import { createUploadHandler } from '../static-file-upload'

export const touristStaticFileRoutes = new Hono<HonoEnv>()

// 限流必须在鉴权与 multipart 解析之前；游客入口无需鉴权
touristStaticFileRoutes.use('/upload', uploadRateLimit)
touristStaticFileRoutes.post(
  '/upload',
  createUploadHandler({
    allowedCategories: SHARED_UPLOAD_CATEGORIES,
    // 游客上传：uploader_id 记为 NULL
    operatorId: () => null,
    operation: '游客上传静态资源',
  }),
)
