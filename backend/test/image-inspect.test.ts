/**
 * image-inspect 单元测试
 */
import { describe, expect, test } from 'bun:test'
import sharp from 'sharp'
import type { AllowedImageFormat, ImageInspection } from '../src/utils/image-inspect'
import {
  ALLOWED_IMAGE_FORMATS,
  detectImageFormat,
  extensionForFormat,
  inspectImage,
  mimeTypeForFormat,
} from '../src/utils/image-inspect'
import { AppError, ErrorCode } from '../src/utils/response'

// ---------- 测试素材生成（仅用 sharp 在内存中生成，不落盘、不连数据库） ----------

/** 拼接字节数组 */
function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

/** 生成纯色图片（按目标格式编码） */
async function createImage(
  format: 'png' | 'jpeg' | 'webp' | 'gif',
  width = 8,
  height = 8,
): Promise<Uint8Array> {
  const pipeline = sharp({
    create: { width, height, channels: 3, background: '#3366cc' },
  })
  const buffer =
    format === 'png'
      ? await pipeline.png().toBuffer()
      : format === 'jpeg'
        ? await pipeline.jpeg().toBuffer()
        : format === 'webp'
          ? await pipeline.webp().toBuffer()
          : await pipeline.gif().toBuffer()
  return new Uint8Array(buffer)
}

/** 生成纯色 PNG */
function createPng(width?: number, height?: number): Promise<Uint8Array> {
  return createImage('png', width, height)
}

/** 生成纯色 JPEG */
function createJpeg(width?: number, height?: number): Promise<Uint8Array> {
  return createImage('jpeg', width, height)
}

/** 生成纯色 WebP */
function createWebp(width?: number, height?: number): Promise<Uint8Array> {
  return createImage('webp', width, height)
}

/** 生成静态 GIF */
function createGif(width?: number, height?: number): Promise<Uint8Array> {
  return createImage('gif', width, height)
}

/** 生成多帧动画 GIF / WebP（帧内容为不同纯色） */
async function createAnimated(
  format: 'gif' | 'webp',
  frames = 3,
): Promise<Uint8Array> {
  const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff']
  const framesBuffer: Uint8Array[] = []
  for (let index = 0; index < frames; index += 1) {
    framesBuffer.push(
      new Uint8Array(
        await sharp({
          create: { width: 8, height: 8, channels: 3, background: colors[index % colors.length] },
        })
          .png()
          .toBuffer(),
      ),
    )
  }
  const pipeline = sharp(framesBuffer, { join: { animated: true } })
  const buffer =
    format === 'gif' ? await pipeline.gif().toBuffer() : await pipeline.webp({ loop: 0 }).toBuffer()
  return new Uint8Array(buffer)
}

/** 生成多帧动画 GIF */
function createAnimatedGif(frames?: number): Promise<Uint8Array> {
  return createAnimated('gif', frames)
}

/** 生成多帧动画 WebP */
function createAnimatedWebp(frames?: number): Promise<Uint8Array> {
  return createAnimated('webp', frames)
}

/**
 * 把 PNG 的 IHDR 宽高改成指定值（构造"声明像素超限"的图片）。
 * 只改头部的尺寸声明，不重新编码。
 */
function patchPngDimensions(
  png: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const patched = new Uint8Array(png)
  const view = new DataView(patched.buffer)
  view.setUint32(16, width, false)
  view.setUint32(20, height, false)
  return patched
}

/** 截断字节数组 */
function truncate(data: Uint8Array, size: number): Uint8Array {
  return data.slice(0, size)
}

/** 测试统一使用的像素上限（足够大，不干扰正常用例） */
const LARGE_PIXEL_LIMIT = 40_000_000

/** 把字节数组转成纯文本，便于构造非图片输入 */
const encoder = new TextEncoder()

/**
 * 断言某个 Promise 以指定的 AppError 失败。
 * 同时校验：确实是 AppError 实例、业务码（code）正确、HTTP 状态码（status）正确。
 */
async function expectAppError(
  promise: Promise<unknown>,
  expectedCode: number,
  expectedStatus: number,
): Promise<void> {
  await expect(promise).rejects.toThrow()
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(AppError)
  expect((error as AppError).code).toBe(expectedCode)
  // status 在源码里是 ContentfulStatusCode（数字字面量联合），此处放宽为 number 便于断言
  expect((error as AppError).status as number).toBe(expectedStatus)
}

describe('image-inspect / detectImageFormat（按文件头签名识别）', () => {
  test('允许的格式清单固定为 png / jpeg / webp / gif', () => {
    expect(ALLOWED_IMAGE_FORMATS).toEqual(['png', 'jpeg', 'webp', 'gif'])
    const formats: AllowedImageFormat[] = ['png', 'jpeg', 'webp', 'gif']
    expect(formats).toHaveLength(ALLOWED_IMAGE_FORMATS.length)
  })

  test('PNG 签名识别为 png', async () => {
    const png = await createPng(8, 8)
    expect(detectImageFormat(png)).toBe('png')
  })

  test('JPEG 签名识别为 jpeg', async () => {
    const jpeg = await createJpeg(8, 8)
    expect(detectImageFormat(jpeg)).toBe('jpeg')
  })

  test('WebP 签名识别为 webp', async () => {
    const webp = await createWebp(8, 8)
    expect(detectImageFormat(webp)).toBe('webp')
  })

  test('GIF 签名识别为 gif', async () => {
    const gif = await createGif(8, 8)
    expect(detectImageFormat(gif)).toBe('gif')
  })

  test('格式伪装：内容是 JPEG，即使当 PNG 用也识别为 jpeg', async () => {
    // 上传文件名与声明 MIME 完全不参与判定，只有内容签名参与
    const jpeg = await createJpeg(8, 8)
    expect(detectImageFormat(jpeg)).toBe('jpeg')

    // 进一步确认：按内容判定后，落库的扩展名/MIME 也是按真实格式生成的
    const inspection = await inspectImage(jpeg, { maxTotalPixels: LARGE_PIXEL_LIMIT })
    expect(inspection.format).toBe('jpeg')
    expect(inspection.extension).toBe('jpg')
    expect(inspection.mimeType).toBe('image/jpeg')
  })

  test('格式伪装：内容是 GIF，即使当 PNG 用也识别为 gif', async () => {
    const gif = await createGif(8, 8)
    expect(detectImageFormat(gif)).toBe('gif')

    const inspection = await inspectImage(gif, { maxTotalPixels: LARGE_PIXEL_LIMIT })
    expect(inspection.format).toBe('gif')
    expect(inspection.extension).toBe('gif')
    expect(inspection.mimeType).toBe('image/gif')
  })

  test('伪造：PNG 签名 + JPEG 内容 -> 签名识别为 png', async () => {
    const png = await createPng(8, 8)
    const jpeg = await createJpeg(8, 8)
    const spoofed = concatBytes([png.slice(0, 8), jpeg])
    // 签名优先，所以识别结果是 png（但这种文件在完整解码时会被拒绝）
    expect(detectImageFormat(spoofed)).toBe('png')
  })

  test('非图片：纯文本 -> null', () => {
    expect(detectImageFormat(encoder.encode('hello world, this is not an image'))).toBeNull()
  })

  test('非图片：SVG 文本 -> null', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'
    expect(detectImageFormat(encoder.encode(svg))).toBeNull()
  })

  test('非图片：BMP 头（BM）-> null', () => {
    expect(detectImageFormat(new Uint8Array([0x42, 0x4d, 0x36, 0x00, 0x00, 0x00]))).toBeNull()
  })

  test('非图片：RIFF 但不是 WEBP -> null', () => {
    expect(detectImageFormat(encoder.encode('RIFF____WAVEfmt '))).toBeNull()
  })

  test('空数组 -> null', () => {
    expect(detectImageFormat(new Uint8Array([]))).toBeNull()
  })

  test('字节长度不足以覆盖签名 -> null', () => {
    expect(detectImageFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
    expect(detectImageFormat(new Uint8Array([0xff, 0xd8]))).toBeNull()
  })
})

describe('image-inspect / extensionForFormat 与 mimeTypeForFormat', () => {
  test('规范扩展名：png / jpg / webp / gif', () => {
    expect(extensionForFormat('png')).toBe('png')
    expect(extensionForFormat('jpeg')).toBe('jpg')
    expect(extensionForFormat('webp')).toBe('webp')
    expect(extensionForFormat('gif')).toBe('gif')
  })

  test('规范 MIME：image/png / image/jpeg / image/webp / image/gif', () => {
    expect(mimeTypeForFormat('png')).toBe('image/png')
    expect(mimeTypeForFormat('jpeg')).toBe('image/jpeg')
    expect(mimeTypeForFormat('webp')).toBe('image/webp')
    expect(mimeTypeForFormat('gif')).toBe('image/gif')
  })

  test('四种格式的扩展名互不相同，且都对应唯一的 MIME', () => {
    const formats: AllowedImageFormat[] = ['png', 'jpeg', 'webp', 'gif']
    const extensions = formats.map((format) => extensionForFormat(format))
    const mimeTypes = formats.map((format) => mimeTypeForFormat(format))
    expect(new Set(extensions).size).toBe(formats.length)
    expect(new Set(mimeTypes).size).toBe(formats.length)
  })
})

describe('image-inspect / inspectImage 成功路径', () => {
  test('PNG：元信息完全正确（单帧、累计像素 = 宽 × 高 × 帧数）', async () => {
    const png = await createPng(100, 100)
    const inspection: ImageInspection = await inspectImage(png, {
      maxTotalPixels: LARGE_PIXEL_LIMIT,
    })
    expect(inspection.format).toBe('png')
    expect(inspection.extension).toBe('png')
    expect(inspection.mimeType).toBe('image/png')
    expect(inspection.width).toBe(100)
    expect(inspection.height).toBe(100)
    expect(inspection.pages).toBe(1)
    expect(inspection.animated).toBe(false)
    expect(inspection.totalPixels).toBe(100 * 100 * 1)
  })

  test('JPEG：元信息完全正确', async () => {
    const jpeg = await createJpeg(64, 32)
    const inspection = await inspectImage(jpeg, { maxTotalPixels: LARGE_PIXEL_LIMIT })
    expect(inspection.format).toBe('jpeg')
    expect(inspection.extension).toBe('jpg')
    expect(inspection.mimeType).toBe('image/jpeg')
    expect(inspection.width).toBe(64)
    expect(inspection.height).toBe(32)
    expect(inspection.pages).toBe(1)
    expect(inspection.animated).toBe(false)
    expect(inspection.totalPixels).toBe(64 * 32 * 1)
  })

  test('WebP：元信息完全正确', async () => {
    const webp = await createWebp(40, 20)
    const inspection = await inspectImage(webp, { maxTotalPixels: LARGE_PIXEL_LIMIT })
    expect(inspection.format).toBe('webp')
    expect(inspection.extension).toBe('webp')
    expect(inspection.mimeType).toBe('image/webp')
    expect(inspection.width).toBe(40)
    expect(inspection.height).toBe(20)
    expect(inspection.pages).toBe(1)
    expect(inspection.animated).toBe(false)
    expect(inspection.totalPixels).toBe(40 * 20 * 1)
  })

  test('GIF：元信息完全正确', async () => {
    const gif = await createGif(12, 6)
    const inspection = await inspectImage(gif, { maxTotalPixels: LARGE_PIXEL_LIMIT })
    expect(inspection.format).toBe('gif')
    expect(inspection.extension).toBe('gif')
    expect(inspection.mimeType).toBe('image/gif')
    expect(inspection.width).toBe(12)
    expect(inspection.height).toBe(6)
    expect(inspection.pages).toBe(1)
    expect(inspection.animated).toBe(false)
    expect(inspection.totalPixels).toBe(12 * 6 * 1)
  })

  test('动画 GIF：pages = 3、animated = true、累计像素 = 宽 × 高 × 帧数', async () => {
    const gif = await createAnimatedGif(3)
    const inspection = await inspectImage(gif, { maxTotalPixels: LARGE_PIXEL_LIMIT })
    expect(inspection.format).toBe('gif')
    expect(inspection.width).toBe(8)
    expect(inspection.height).toBe(8)
    expect(inspection.pages).toBe(3)
    expect(inspection.animated).toBe(true)
    expect(inspection.totalPixels).toBe(8 * 8 * 3)
  })

  test('动画 WebP：pages = 3、animated = true、累计像素 = 宽 × 高 × 帧数', async () => {
    const webp = await createAnimatedWebp(3)
    const inspection = await inspectImage(webp, { maxTotalPixels: LARGE_PIXEL_LIMIT })
    expect(inspection.format).toBe('webp')
    expect(inspection.width).toBe(8)
    expect(inspection.height).toBe(8)
    expect(inspection.pages).toBe(3)
    expect(inspection.animated).toBe(true)
    expect(inspection.totalPixels).toBe(8 * 8 * 3)
  })

  test('不同的 maxTotalPixels 只做限制，不改变校验结果', async () => {
    const png = await createPng(100, 100)
    const results = []
    for (const maxTotalPixels of [LARGE_PIXEL_LIMIT, 1_000_000, 10_000]) {
      results.push(await inspectImage(png, { maxTotalPixels }))
    }
    expect(results[0]).toEqual(results[1])
    expect(results[1]).toEqual(results[2])
    expect(results[0].totalPixels).toBe(10_000)
  })
})

describe('image-inspect / inspectImage 失败路径', () => {
  test('非允许格式：纯文本 -> UNSUPPORTED_IMAGE_FORMAT(41500) / HTTP 415', async () => {
    const data = encoder.encode('hello world, this is not an image')
    await expectAppError(
      inspectImage(data, { maxTotalPixels: LARGE_PIXEL_LIMIT }),
      ErrorCode.UNSUPPORTED_IMAGE_FORMAT,
      415,
    )
  })

  test('非允许格式：SVG -> UNSUPPORTED_IMAGE_FORMAT(41500) / HTTP 415', async () => {
    const data = encoder.encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    await expectAppError(
      inspectImage(data, { maxTotalPixels: LARGE_PIXEL_LIMIT }),
      ErrorCode.UNSUPPORTED_IMAGE_FORMAT,
      415,
    )
  })

  test('非允许格式：空内容 -> UNSUPPORTED_IMAGE_FORMAT(41500) / HTTP 415', async () => {
    await expectAppError(
      inspectImage(new Uint8Array([]), { maxTotalPixels: LARGE_PIXEL_LIMIT }),
      ErrorCode.UNSUPPORTED_IMAGE_FORMAT,
      415,
    )
  })

  test('截断的 PNG -> IMAGE_DECODE_FAILED(41501) / HTTP 415', async () => {
    const png = await createPng(100, 100)
    await expectAppError(
      inspectImage(truncate(png, 40), { maxTotalPixels: LARGE_PIXEL_LIMIT }),
      ErrorCode.IMAGE_DECODE_FAILED,
      415,
    )
  })

  test('伪造：PNG 签名 + JPEG 内容 -> IMAGE_DECODE_FAILED(41501) / HTTP 415', async () => {
    const png = await createPng(8, 8)
    const jpeg = await createJpeg(8, 8)
    const spoofed = concatBytes([png.slice(0, 8), jpeg])
    await expectAppError(
      inspectImage(spoofed, { maxTotalPixels: LARGE_PIXEL_LIMIT }),
      ErrorCode.IMAGE_DECODE_FAILED,
      415,
    )
  })

  test('像素超限：声明 7000×6000（4200 万像素）-> IMAGE_PIXEL_LIMIT_EXCEEDED(41302) / HTTP 413', async () => {
    const png = await createPng(100, 100)
    const patched = patchPngDimensions(png, 7000, 6000)
    await expectAppError(
      inspectImage(patched, { maxTotalPixels: 40_000_000 }),
      ErrorCode.IMAGE_PIXEL_LIMIT_EXCEEDED,
      413,
    )
  })

  test('像素刚好等于上限 -> 放行', async () => {
    const png = await createPng(100, 100)
    const inspection = await inspectImage(png, { maxTotalPixels: 10_000 })
    expect(inspection.totalPixels).toBe(10_000)
    expect(inspection.width).toBe(100)
    expect(inspection.height).toBe(100)
  })

  test('像素刚好超过上限 -> IMAGE_PIXEL_LIMIT_EXCEEDED(41302) / HTTP 413', async () => {
    const png = await createPng(100, 100)
    await expectAppError(
      inspectImage(png, { maxTotalPixels: 9_999 }),
      ErrorCode.IMAGE_PIXEL_LIMIT_EXCEEDED,
      413,
    )
  })

  test('动画图按累计像素计费：8×8×3 = 192，等于上限放行', async () => {
    const gif = await createAnimatedGif(3)
    const inspection = await inspectImage(gif, { maxTotalPixels: 192 })
    expect(inspection.totalPixels).toBe(192)
    expect(inspection.pages).toBe(3)
  })

  test('动画图按累计像素计费：8×8×3 = 192，超过上限 191 拒绝', async () => {
    const gif = await createAnimatedGif(3)
    await expectAppError(
      inspectImage(gif, { maxTotalPixels: 191 }),
      ErrorCode.IMAGE_PIXEL_LIMIT_EXCEEDED,
      413,
    )
  })
})
