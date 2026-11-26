/**
 * 静态资源指纹去重的底层能力：指纹计算、锁名生成、已存文件核对。
 *
 * 约定：
 * - 指纹对**实际保存的原始文件字节**计算（压缩、转码、改元数据都会得到不同指纹）
 * - 锁名由「数据库名 + 分类 + 指纹」派生，控制在 MySQL 命名锁 64 字符上限内
 * - 命中指纹后必须再核对磁盘上的真实文件（大小 + 字节），避免 MD5 碰撞误判
 * - 读取已存文件前先确认路径落在上传根目录内，绝不读取根目录之外的文件
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

/** MySQL 命名锁名长度上限 */
export const MAX_LOCK_NAME_LENGTH = 64

/** 获取命名锁的等待上限（秒） */
export const DEDUP_LOCK_TIMEOUT_SECONDS = 5

/** 锁名前缀，便于在 `SHOW PROCESSLIST` 里识别 */
const LOCK_NAME_PREFIX = 'ict-sf:'

/**
 * 计算文件指纹（MD5 十六进制）。
 * 对实际保存的原始字节计算，内容完全一致才会得到相同指纹。
 */
export function computeFingerprint(data: Uint8Array): string {
  return createHash('md5').update(data).digest('hex')
}

/**
 * 生成去重锁名。
 * 用「数据库名 + 分类 + 指纹」再做一次 MD5，保证长度固定且不泄露指纹。
 */
export function buildDedupLockName(params: {
  database: string
  category: string
  fingerprint: string
}): string {
  const digest = createHash('md5')
    .update(`${params.database}:${params.category}:${params.fingerprint}`)
    .digest('hex')
  const name = `${LOCK_NAME_PREFIX}${digest}`
  if (name.length > MAX_LOCK_NAME_LENGTH) {
    throw new Error(`去重锁名超长: ${name.length}`)
  }
  return name
}

/** 已存文件的核对结果 */
export type StoredFileState =
  /** 文件存在，大小与内容都与记录一致 */
  | 'ok'
  /** 文件不存在或读取失败 */
  | 'missing'
  /** 文件存在但大小或内容与记录不一致（可能是指纹碰撞或文件被改动） */
  | 'mismatch'
  /** 记录里的路径越出了上传根目录 */
  | 'unsafe-path'

export type StoredFileCheck = {
  state: StoredFileState
  /** 供日志使用的中文原因（不含绝对路径） */
  reason: string
}

/**
 * 核对数据库记录对应的磁盘文件。
 *
 * - 先校验路径是否落在上传根目录内，越界直接拒绝（绝不读取根目录之外的文件）
 * - 再比对文件大小与实际字节，防止 MD5 碰撞被误判成"重复"
 */
export async function inspectStoredFile(params: {
  rootPath: string
  /** 数据库里存的相对路径 */
  relativePath: string
  /** 记录中的文件大小 */
  expectedSize: number
  /** 期望的指纹 */
  expectedFingerprint: string
}): Promise<StoredFileCheck> {
  const root = resolve(params.rootPath)
  const absolute = resolve(root, params.relativePath)

  if (absolute !== root && !absolute.startsWith(root + sep)) {
    return { state: 'unsafe-path', reason: '记录路径越出上传根目录' }
  }

  let data: Buffer
  try {
    data = await readFile(absolute)
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : ''
    if (code === 'ENOENT') {
      return { state: 'missing', reason: '记录对应的文件已不存在' }
    }
    return { state: 'missing', reason: '记录对应的文件读取失败' }
  }

  if (data.byteLength !== params.expectedSize) {
    return { state: 'mismatch', reason: '文件大小与记录不一致' }
  }

  if (computeFingerprint(data) !== params.expectedFingerprint) {
    return { state: 'mismatch', reason: '文件内容与指纹不一致' }
  }

  return { state: 'ok', reason: '' }
}
