/**
 * 图片校验：文件头签名识别 + 完整解码验证 + 像素上限控制。
 *
 * 安全约定：
 * - 只接受 PNG / JPEG / WebP / GIF 四种格式，按文件头签名识别，不信任扩展名与 MIME
 * - 必须完成完整解码：截断、损坏、伪造的文件一律拒绝
 * - 累计解码像素有上限，避免"压缩炸弹"把内存打满
 * - 扩展名与 MIME 一律按识别结果生成，原始文件名只作展示元数据
 */
import sharp from 'sharp'
import type { Metadata } from 'sharp'
import { AppError, ErrorCode } from './response'

/** 允许的图片格式 */
export const ALLOWED_IMAGE_FORMATS = ['png', 'jpeg', 'webp', 'gif'] as const

export type AllowedImageFormat = (typeof ALLOWED_IMAGE_FORMATS)[number]

/** 格式 -> 规范扩展名 */
const FORMAT_EXTENSIONS: Record<AllowedImageFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
  gif: 'gif',
}

/** 格式 -> 规范 MIME */
const FORMAT_MIME_TYPES: Record<AllowedImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/** 格式对应的规范扩展名 */
export function extensionForFormat(format: AllowedImageFormat): string {
  return FORMAT_EXTENSIONS[format]
}

/** 格式对应的规范 MIME */
export function mimeTypeForFormat(format: AllowedImageFormat): string {
  return FORMAT_MIME_TYPES[format]
}

/** 读取字节序列里的 ASCII 片段 */
function readAscii(data: Uint8Array, start: number, length: number): string {
  if (data.length < start + length) return ''
  let result = ''
  for (let index = start; index < start + length; index += 1) {
    result += String.fromCharCode(data[index])
  }
  return result
}

/**
 * 按文件头签名识别图片格式。
 * 识别不出（SVG / BMP / 纯文本 / 伪造扩展名等）返回 null。
 */
export function detectImageFormat(data: Uint8Array): AllowedImageFormat | null {
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return 'png'
  }

  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'jpeg'
  }

  if (data.length >= 12 && readAscii(data, 0, 4) === 'RIFF' && readAscii(data, 8, 4) === 'WEBP') {
    return 'webp'
  }

  if (data.length >= 6) {
    const header = readAscii(data, 0, 6)
    if (header === 'GIF87a' || header === 'GIF89a') return 'gif'
  }

  return null
}

/** sharp 在像素数超过 limitInputPixels 时抛出的错误 */
function isPixelLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  // 不同 sharp 版本可能用 code 或 message 表达，兼容两种
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string' && code.toLowerCase().includes('pixel')) {
    return true
  }
  return error.message.toLowerCase().includes('pixel limit')
}

/** 图片校验结果 */
export type ImageInspection = {
  /** 识别出的真实格式 */
  format: AllowedImageFormat
  /** 规范扩展名（不含点） */
  extension: string
  /** 规范 MIME */
  mimeType: string
  width: number
  height: number
  /** 动画帧数，静态图为 1 */
  pages: number
  /** 累计解码像素（宽 × 高 × 帧数） */
  totalPixels: number
  /** 是否为动画图片 */
  animated: boolean
}

export type InspectImageOptions = {
  /** 累计解码像素上限 */
  maxTotalPixels: number
}

/**
 * 校验图片并返回元信息。
 * 失败时抛出 AppError（业务码 + HTTP 状态码），由路由层统一转成响应。
 */
export async function inspectImage(
  data: Uint8Array,
  options: InspectImageOptions,
): Promise<ImageInspection> {
  const format = detectImageFormat(data)
  if (!format) {
    throw new AppError(ErrorCode.UNSUPPORTED_IMAGE_FORMAT, '仅支持 PNG / JPEG / WebP / GIF 图片格式')
  }

  let metadata: Metadata
  try {
    metadata = await sharp(data, {
      limitInputPixels: options.maxTotalPixels,
      failOn: 'error',
    }).metadata()
  } catch (error) {
    if (isPixelLimitError(error)) {
      throw new AppError(
        ErrorCode.IMAGE_PIXEL_LIMIT_EXCEEDED,
        `图片像素总量不能超过 ${options.maxTotalPixels}`,
      )
    }
    throw new AppError(ErrorCode.IMAGE_DECODE_FAILED, '图片文件损坏或无法解析')
  }

  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  // 不加 animated 选项读取：此时 height 是单帧高度、pages 是总帧数，两者相乘才是累计像素
  const pages = metadata.pages ?? 1
  if (width <= 0 || height <= 0) {
    throw new AppError(ErrorCode.IMAGE_DECODE_FAILED, '图片尺寸无效')
  }

  const totalPixels = width * height * pages
  if (totalPixels > options.maxTotalPixels) {
    throw new AppError(
      ErrorCode.IMAGE_PIXEL_LIMIT_EXCEEDED,
      `图片像素总量不能超过 ${options.maxTotalPixels}`,
    )
  }

  // 完整解码校验：截断、损坏的文件在这里被拒绝
  try {
    await sharp(data, { limitInputPixels: options.maxTotalPixels, failOn: 'error' })
      .raw()
      .toBuffer()
  } catch (error) {
    if (isPixelLimitError(error)) {
      throw new AppError(
        ErrorCode.IMAGE_PIXEL_LIMIT_EXCEEDED,
        `图片像素总量不能超过 ${options.maxTotalPixels}`,
      )
    }
    throw new AppError(ErrorCode.IMAGE_DECODE_FAILED, '图片文件损坏或无法完整解码')
  }

  return {
    format,
    extension: extensionForFormat(format),
    mimeType: mimeTypeForFormat(format),
    width,
    height,
    pages,
    totalPixels,
    animated: pages > 1,
  }
}
