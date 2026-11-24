/**
 * 服务入口：配置校验 -> Bun.serve -> 启动日志。
 */
import { createApp } from './app'
import { assertRuntimeEnv, env } from './config/env'
import { closePool } from './db'

// 关键配置缺失直接拒绝启动（例如 JWT_SECRET 未设置）
assertRuntimeEnv(env)

const app = createApp()

const server = Bun.serve({
  port: env.port,
  hostname: '0.0.0.0',
  fetch: app.fetch,
  error(error) {
    console.error('[server] 请求处理异常:', error)
    return new Response('Internal Server Error', { status: 500 })
  },
})

console.log(`[server] ICT 协会后端已启动: http://127.0.0.1:${server.port}`)
console.log(
  `[server] 环境=${env.nodeEnv} 数据库=${env.db.user}@${env.db.host}:${env.db.port}/${env.db.database} CORS=${env.corsOrigins.join(',')}`,
)

let shuttingDown = false

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[server] 收到 ${signal}，正在优雅关闭...`)
  try {
    await server.stop(true)
    await closePool()
  } catch (error) {
    console.error('[server] 关闭时发生异常:', error)
  }
  process.exit(0)
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})
process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
