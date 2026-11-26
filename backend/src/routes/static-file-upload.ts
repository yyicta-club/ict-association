/**
 * 上传处理逻辑（管理员入口与游客入口共用）。
 *
 * 两个入口共用同一段业务处理，只通过"允许的分类"和"操作者"两个参数区分，
 * 避免两份实现产生行为差异。
 *
 * 处理顺序：
 * 1. 读取请求体（按实际字节数限长，不信任 Content-Length）
 * 2. 解析 multipart，校验字段（只接受一个 file 与一个 category）
 * 3. 校验分类（未知分类 400；无权限的合法分类 403）
 * 4. 图片校验 -> 落盘 -> 落库
 * 5. 写审计日志（操作、结果、资源 ID、IP）
 */
import type { Context } from 'hono'
import { env } from '../config/env'
import { recordSystemLog } from '../services/system-log.service'
import {
  resolveUploadCategory,
  uploadStaticAsset,
} from '../services/static-file.service'
import type { UploadCategory } from '../services/static-file.service'
import type { HonoEnv } from '../types'
import { parseMultipartPayload, readLimitedBody } from '../utils/multipart'
import { getClientIp, getRequestPath } from '../utils/request'
import { AppError, ErrorCode, failure, success } from '../utils/response'

export type UploadHandlerOptions = {
  /** 该入口允许的分类白名单 */
  allowedCategories: readonly UploadCategory[]
  /** 操作者 admins.id；游客入口返回 null */
  operatorId: (c: Context<HonoEnv>) => number | null
  /** 审计日志里的操作名 */
  operation: string
}

/** 统一的 multipart 字段校验结果 */
type FieldCheck = { ok: true } | { ok: false; message: string }

/**
 * 校验 multipart 字段：只接受一个 file 与一个 category。
 * 缺失、重复、多文件、多余字段全部拒绝。
 */
function checkUploadFields(payload: {
  files: { name: string }[]
  fields: { name: string }[]
}): FieldCheck {
  const fileParts = payload.files.filter((item) => item.name === 'file')
  const otherFiles = payload.files.filter((item) => item.name !== 'file')
  const categoryFields = payload.fields.filter((item) => item.name === 'category')
  const otherFields = payload.fields.filter((item) => item.name !== 'category')

  if (otherFiles.length > 0) {
    return { ok: false, message: '只允许上传一个名为 file 的文件' }
  }
  if (fileParts.length === 0) {
    return { ok: false, message: '缺少上传文件（字段名必须为 file）' }
  }
  if (fileParts.length > 1) {
    return { ok: false, message: '一次只能上传一个文件' }
  }
  if (otherFields.length > 0) {
    return { ok: false, message: '只接受 file 与 category 两个字段' }
  }
  if (categoryFields.length === 0) {
    return { ok: false, message: '缺少分类（字段名必须为 category）' }
  }
  if (categoryFields.length > 1) {
    return { ok: false, message: 'category 字段不能重复' }
  }

  return { ok: true }
}

/** 创建上传处理器 */
export function createUploadHandler(options: UploadHandlerOptions) {
  return async (c: Context<HonoEnv>) => {
    const ip = getClientIp(c)
    const requestPath = getRequestPath(c)
    const operatorId = options.operatorId(c)

    const writeLog = (level: 'INFO' | 'WARN' | 'ERROR', statusCode: number, detail: string) =>
      recordSystemLog({
        level,
        operation: options.operation,
        module: 'static-file',
        operatorId,
        ip,
        requestPath,
        statusCode,
        detail,
      })

    // 1. 读取请求体（限长）
    let body: Uint8Array
    try {
      body = await readLimitedBody(c.req.raw, env.staticFile.maxRequestBytes)
    } catch (error) {
      if (error instanceof AppError) {
        await writeLog('WARN', error.status, `上传失败: ${error.message}`)
        return c.json(failure(error.code, error.message), error.status)
      }
      throw error
    }

    // 2. 解析 multipart
    let payload: Awaited<ReturnType<typeof parseMultipartPayload>>
    try {
      payload = await parseMultipartPayload(c.req.raw, body)
    } catch (error) {
      if (error instanceof AppError) {
        await writeLog('WARN', error.status, `上传失败: ${error.message}`)
        return c.json(failure(error.code, error.message), error.status)
      }
      throw error
    }

    // 3. 字段校验
    const fieldCheck = checkUploadFields(payload)
    if (!fieldCheck.ok) {
      await writeLog('WARN', 400, `上传失败: ${fieldCheck.message}`)
      return c.json(failure(ErrorCode.BAD_REQUEST, fieldCheck.message), 400)
    }

    const filePart = payload.files[0]
    const categoryField = payload.fields.find((item) => item.name === 'category')
    if (!filePart || !categoryField) {
      await writeLog('WARN', 400, '上传失败: 缺少文件或分类')
      return c.json(failure(ErrorCode.BAD_REQUEST, '缺少上传文件或分类'), 400)
    }

    // 4. 分类校验（未知分类 400；无权限 403）
    let category: UploadCategory
    try {
      category = resolveUploadCategory(categoryField.value, options.allowedCategories)
    } catch (error) {
      if (error instanceof AppError) {
        await writeLog('WARN', error.status, `上传失败: ${error.message}`)
        return c.json(failure(error.code, error.message), error.status)
      }
      throw error
    }

    // 5. 业务处理
    try {
      const { asset, outcome } = await uploadStaticAsset({
        category,
        originalFileName: filePart.filename,
        data: filePart.data,
        uploaderId: operatorId,
        ip,
        requestPath,
      })

      // 三种结果对应不同的响应文案与审计日志；指纹本身不返回给客户端
      const outcomeLabel =
        outcome === 'created' ? '新建' : outcome === 'reused' ? '复用' : '恢复'
      const message =
        outcome === 'created'
          ? '上传成功'
          : outcome === 'reused'
            ? '文件已存在，已复用原资源'
            : '文件已存在，已恢复原资源'

      await writeLog(
        'INFO',
        200,
        `上传成功（${outcomeLabel}）: 资源 ID=${asset.id}, 分类=${asset.category}, 类型=${asset.mimeType}, 大小=${asset.sizeBytes} 字节`,
      )
      return c.json(success(asset, message), 200)
    } catch (error) {
      if (error instanceof AppError) {
        await writeLog('WARN', error.status, `上传失败: ${error.message}`)
        return c.json(failure(error.code, error.message), error.status)
      }
      await writeLog('ERROR', 500, '上传失败: 服务器内部错误')
      throw error
    }
  }
}
