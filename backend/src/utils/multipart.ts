/**
 * multipart/form-data 解析与请求体读取。
 *
 * 安全约定：
 * - 读取请求体时按"实际读到的字节数"限流，不信任 Content-Length（可能缺失或伪造）
 * - 解析前先拿到限长字节，避免超大请求体被整体读进内存
 * - 解析结果保留全部同名条目，由调用方判定"重复字段 / 多个文件"
 */
import { AppError, ErrorCode } from './response'

/** 解析出的文件部分 */
export type MultipartFilePart = {
  /** 表单字段名 */
  name: string
  /** 客户端提交的文件名（仅展示） */
  filename: string
  /** 字节数 */
  size: number
  /** 文件内容 */
  data: Uint8Array
}

/** 解析出的普通字段 */
export type MultipartField = {
  name: string
  value: string
}

/** 解析结果 */
export type MultipartPayload = {
  files: MultipartFilePart[]
  fields: MultipartField[]
}

/**
 * 按字节上限读取请求体。
 *
 * - Content-Length 只作为"快速失败"的预判，实际以读到的字节数为准
 * - 超限时立即中断读取并抛出 413
 */
export async function readLimitedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    const length = Number(declared)
    if (Number.isFinite(length) && length > maxBytes) {
      throw new AppError(
        ErrorCode.REQUEST_TOO_LARGE,
        `请求体不能超过 ${maxBytes} 字节`,
      )
    }
  }

  const body = request.body
  if (!body) return new Uint8Array(0)

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new AppError(
          ErrorCode.REQUEST_TOO_LARGE,
          `请求体不能超过 ${maxBytes} 字节`,
        )
      }
      chunks.push(value)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // 忽略：读取失败时锁可能已被释放
    }
  }

  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

/**
 * 解析 multipart 请求体。
 * 请求体已被 readLimitedBody 限长，因此解析阶段不再有额外的内存风险。
 */
export async function parseMultipartPayload(
  request: Request,
  body: Uint8Array,
): Promise<MultipartPayload> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!/^multipart\/form-data/i.test(contentType.trim())) {
    throw new AppError(ErrorCode.BAD_REQUEST, '请求必须是 multipart/form-data')
  }

  let form: Awaited<ReturnType<Request['formData']>>
  try {
    // 用已限长的字节重新构造请求，交给运行时解析 multipart
    const buffer = body.slice().buffer as unknown as ArrayBuffer
    const formRequest = new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: buffer,
    })
    form = await formRequest.formData()
  } catch {
    throw new AppError(ErrorCode.BAD_REQUEST, 'multipart 请求体解析失败')
  }

  const files: MultipartFilePart[] = []
  const fields: MultipartField[] = []

  for (const [name, value] of Array.from(form.entries())) {
    if (typeof value === 'string') {
      fields.push({ name, value })
      continue
    }
    files.push({
      name,
      filename: value.name,
      size: value.size,
      data: new Uint8Array(await value.arrayBuffer()),
    })
  }

  return { files, fields }
}
