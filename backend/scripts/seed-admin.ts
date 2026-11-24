/**
 * 初始管理员脚本：创建初始管理员，或重置已存在管理员的密码。
 *
 * 用法：
 *   bun run seed:admin
 *   bun run seed:admin -- --username=root --password=Passw0rd!
 *
 * 约定：
 * - 用户名来源：--username 参数 > ADMIN_INIT_USERNAME > admin
 * - 密码来源：--password 参数 > ADMIN_INIT_PASSWORD（两者都没有则直接报错退出）
 * - 密码至少 8 位，全程不打印密码与哈希
 */
import { env } from '../src/config/env'
import { closePool, execute, query } from '../src/db'
import type { AdminRow } from '../src/types'
import { hashPassword } from '../src/utils/password'

/** 初始管理员默认昵称 */
const DEFAULT_NICKNAME = '系统管理员'

/** 密码最小长度 */
const MIN_PASSWORD_LENGTH = 8

/** 命令行参数 */
type CliOptions = {
  username?: string
  password?: string
}

/** 脚本内部的可预期错误：只输出友好文案，不输出调用栈 */
class ScriptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScriptError'
  }
}

/** 提取异常的可读信息 */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** 提取驱动 / socket 层面的错误码 */
function codeOf(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

/**
 * 解析命令行参数，支持 `--key=value` 与 `--key value` 两种写法。
 */
function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {}

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('--username=')) {
      options.username = arg.slice('--username='.length)
    } else if (arg === '--username') {
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        options.username = next
        i += 1
      }
    } else if (arg.startsWith('--password=')) {
      options.password = arg.slice('--password='.length)
    } else if (arg === '--password') {
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        options.password = next
        i += 1
      }
    }
  }

  return options
}

/** 目标库不存在时给出明确指引 */
function isUnknownDatabaseError(error: unknown): boolean {
  if (codeOf(error) === 'ER_BAD_DB_ERROR') return true
  return /Unknown database/i.test(messageOf(error))
}

/** 是否属于连不上 MySQL 的错误 */
function isConnectionError(error: unknown): boolean {
  const code = codeOf(error)
  return (
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'ENOTFOUND' ||
    code === 'ER_ACCESS_DENIED_ERROR'
  )
}

/** 连接类错误的可操作提示 */
function describeConnectionError(error: unknown): string {
  const code = codeOf(error)
  const detail = messageOf(error)

  if (code === 'ER_ACCESS_DENIED_ERROR') {
    return [
      `MySQL 认证失败：${detail}`,
      '',
      '  请检查 backend/.env 中的 DB_USER / DB_PASSWORD 配置是否正确。',
    ].join('\n')
  }

  return [
    `MySQL 连接失败（${code}）：${detail}`,
    '',
    '  请先启动 MySQL 服务，然后检查 backend/.env 中的连接配置:',
    `    DB_HOST=${env.db.host}`,
    `    DB_PORT=${env.db.port}`,
    `    DB_USER=${env.db.user}`,
    '    DB_PASSWORD=（请自行核对是否正确）',
  ].join('\n')
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv)

  // 用户名：--username > ADMIN_INIT_USERNAME > admin
  const username = (options.username ?? '').trim() || (env.adminInit.username ?? '').trim() || 'admin'

  // 密码：--password > ADMIN_INIT_PASSWORD（空值视为未提供）
  const cliPassword = options.password ?? ''
  const password = cliPassword.length > 0 ? cliPassword : env.adminInit.password

  if (!password || password.trim().length === 0) {
    throw new ScriptError(
      [
        '未提供初始管理员密码，无法继续。',
        '',
        '  请使用以下任一方式提供密码:',
        '    1) 在 backend/.env 中配置 ADMIN_INIT_PASSWORD=你的密码',
        '    2) 命令行传入: bun run seed:admin -- --password=你的密码',
        '',
        '  密码长度至少 8 位。',
      ].join('\n'),
    )
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ScriptError(
      [
        `初始管理员密码长度不足：当前 ${password.length} 位，至少需要 ${MIN_PASSWORD_LENGTH} 位。`,
        '',
        '  请在 backend/.env 中配置更长的 ADMIN_INIT_PASSWORD，或使用 --password=xxx 传入。',
      ].join('\n'),
    )
  }

  console.log(`[seed:admin] 管理员用户名：${username}`)
  console.log('[seed:admin] 正在生成密码哈希 ...')
  const passwordHash = await hashPassword(password)

  try {
    const rows = await query<Pick<AdminRow, 'id'>[]>('SELECT id FROM admins WHERE username = ?', [username])

    if (rows.length === 0) {
      await execute(
        'INSERT INTO admins (username, password_hash, nickname, status) VALUES (?, ?, ?, 1)',
        [username, passwordHash, DEFAULT_NICKNAME],
      )
      console.log(`[seed:admin] ✅ 管理员 "${username}" 创建成功（账号状态：启用）`)
    } else {
      await execute(
        'UPDATE admins SET password_hash = ?, status = 1, updated_at = NOW() WHERE username = ?',
        [passwordHash, username],
      )
      console.log(`[seed:admin] ✅ 管理员 "${username}" 已存在，密码已重置并重新启用`)
    }
  } catch (error) {
    if (isUnknownDatabaseError(error)) {
      throw new ScriptError(
        [
          `数据库 "${env.db.database}" 不存在。`,
          '',
          '  请先执行: bun run db:init',
        ].join('\n'),
      )
    }
    if (isConnectionError(error)) {
      throw new ScriptError(describeConnectionError(error))
    }
    throw new ScriptError(`写入管理员数据失败：${messageOf(error)}`)
  }
}

try {
  await main()
} catch (error) {
  if (error instanceof ScriptError) {
    console.error(`[seed:admin] ❌ ${error.message}`)
  } else {
    console.error(`[seed:admin] ❌ 执行失败：${messageOf(error)}`)
  }
  process.exitCode = 1
} finally {
  try {
    await closePool()
  } catch {
    // 关闭连接池失败不影响脚本结果，忽略即可
  }
}
