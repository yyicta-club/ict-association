/**
 * 日志脱敏工具。
 *
 * 安全约定：
 * - 绝不把数据库 / 文件系统异常对象原样打印出来：
 *   驱动异常的 message 里可能带 SQL 片段、参数与内部绝对路径
 * - 只输出异常类型与驱动错误码（ER_* / ENOENT 等），不带 message、SQL、参数与堆栈
 * - 非驱动异常只输出类型与截断后的 message，并抹掉疑似绝对路径
 */

/** 单条日志详情的最大长度，避免超长文本撑爆日志表 */
export const LOG_DETAIL_MAX_LENGTH = 500

/** 控制字符（换行、制表符等）正则，用于把详情压成单行 */
const CONTROL_CHARS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  'g',
)

/** 读取异常上的驱动错误码（mysql2 / fs 都有） */
function readErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code !== '') return code
  }
  return undefined
}

/** 抹掉文本里疑似绝对路径的部分（Windows 盘符路径与 POSIX 绝对路径） */
export function redactAbsolutePaths(text: string): string {
  return text
    .replace(/[A-Za-z]:\\[^\s"'<>|]+/g, '<path>')
    .replace(/(?:^|\s)\/(?:[\w.@+-]+\/)+[\w.@+-]*/g, (match) => match.replace(/\S+$/, '<path>'))
}

/**
 * 生成脱敏后的错误描述（单行）。
 * 驱动异常（带 code）只保留类型与错误码；其它异常保留类型与截断 message。
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = readErrorCode(error)
    if (code) {
      // 驱动异常的 message 可能包含 SQL、参数与内部路径，一律不输出
      return `${error.name}[${code}]`
    }
    const message = redactAbsolutePaths(error.message).replace(/\s+/g, ' ').trim()
    if (message === '') return error.name
    return `${error.name}: ${message.slice(0, 200)}`
  }
  if (error === null || error === undefined) return 'UnknownError'
  return redactAbsolutePaths(String(error)).slice(0, 200)
}

/**
 * 生成可入库的日志详情：去掉控制字符、抹掉绝对路径、截断长度。
 */
export function sanitizeLogDetail(detail: string | null | undefined): string | null {
  if (detail === null || detail === undefined) return null
  const cleaned = redactAbsolutePaths(detail)
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned === '') return null
  return cleaned.length > LOG_DETAIL_MAX_LENGTH
    ? `${cleaned.slice(0, LOG_DETAIL_MAX_LENGTH)}…`
    : cleaned
}
