/**
 * 静态资源落盘：路径规划、独占写入、失败清理。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

/** 原始文件名的最大长度，对齐 static_assets.filename VARCHAR(255) */
export const MAX_ORIGINAL_FILENAME_LENGTH = 255

/** 落盘结果 */
export type StoredFile = {
  /** 相对路径（对外可见，不含根目录），如 article/2f1c....png */
  relativePath: string
  /** 绝对路径（仅内部使用，绝不返回给客户端） */
  absolutePath: string
  /** 落盘字节数 */
  size: number
}

/** 控制字符正则（用构造函数拼装，避免源码里出现裸控制字符） */
const CONTROL_CHARS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  'g',
)

/** 判断是否为"文件已存在"错误 */
function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'EEXIST'
  )
}

/** 判断是否为"文件不存在"错误 */
function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

/**
 * 断言目标路径落在上传根目录内。
 * 越界时抛出通用错误（不把路径写进错误信息，避免泄露内部目录）。
 */
export function assertInsideRoot(rootPath: string, targetPath: string): void {
  const root = resolve(rootPath)
  const target = resolve(targetPath)
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error('上传路径越界')
  }
}

/**
 * 清洗原始文件名：只作展示元数据，绝不参与路径拼接。
 * 去掉目录成分与控制字符，长度截断到 255。
 */
export function sanitizeOriginalFileName(raw: string | null | undefined): string {
  const text = typeof raw === 'string' ? raw : ''
  const base = text.split(/[\\/]/).pop() ?? ''
  const cleaned = base.replace(CONTROL_CHARS, '').trim()
  if (cleaned === '') return 'upload'
  return cleaned.length > MAX_ORIGINAL_FILENAME_LENGTH
    ? cleaned.slice(0, MAX_ORIGINAL_FILENAME_LENGTH)
    : cleaned
}

/**
 * 写入上传文件。
 *
 * 目录结构：<根目录>/<分类>/<随机 UUID>.<扩展名>
 * 使用独占创建（flag: 'wx'）：文件已存在时重新生成 UUID 重试，绝不覆盖。
 */
export async function writeStoredFile(params: {
  rootPath: string
  category: string
  extension: string
  data: Uint8Array
}): Promise<StoredFile> {
  const root = resolve(params.rootPath)
  const categoryDir = resolve(root, params.category)
  assertInsideRoot(root, categoryDir)
  await mkdir(categoryDir, { recursive: true })

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const fileName = `${randomUUID()}.${params.extension}`
    const absolutePath = join(categoryDir, fileName)
    assertInsideRoot(root, absolutePath)
    try {
      await writeFile(absolutePath, params.data, { flag: 'wx' })
      return {
        relativePath: `${params.category}/${fileName}`,
        absolutePath,
        size: params.data.byteLength,
      }
    } catch (error) {
      if (isFileExistsError(error)) continue
      throw error
    }
  }

  throw new Error('生成上传文件名失败')
}

/**
 * 删除已落盘的文件（用于失败补偿）。
 * 文件不存在时返回 false，不抛异常。
 */
export async function removeStoredFile(absolutePath: string): Promise<boolean> {
  try {
    await unlink(absolutePath)
    return true
  } catch (error) {
    if (isNotFoundError(error)) return false
    throw error
  }
}
