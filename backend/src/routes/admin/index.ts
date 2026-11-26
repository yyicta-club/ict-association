/**
 * /admin 路由组。
 * 后续新增的后台接口都挂在这里，写操作记得挂 adminAuth 中间件。
 */
import { Hono } from 'hono'
import { adminAuth } from '../../middlewares/auth'
import type { HonoEnv } from '../../types'
import { success } from '../../utils/response'
import { adminAuthRoutes } from './auth'
import { adminStaticFileRoutes } from './static-file'
import { adminUserRoutes } from './user'

export const adminRoutes = new Hono<HonoEnv>()

// POST /admin/login
adminRoutes.route('/', adminAuthRoutes)

// 管理员账户管理
adminRoutes.route('/user', adminUserRoutes)

// 静态资源管理（上传 / 列表 / 软删除 / 恢复）
adminRoutes.route('/static-files', adminStaticFileRoutes)

// 受保护接口示例：校验 token 是否有效
adminRoutes.get('/me', adminAuth, (c) => {
  const admin = c.get('admin')
  return c.json(
    success(
      {
        id: Number(admin.sub),
        username: admin.username,
        nickname: admin.nickname,
        role: admin.role,
      },
      '当前登录管理员',
    ),
  )
})
