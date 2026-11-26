/**
 * IP 地址解析、CIDR 匹配与可信代理链解析（纯函数，无副作用，便于单测）。
 *
 * 安全约定：
 * - 只有显式配置的 IP / CIDR 才被视为可信代理；默认（未配置）时转发头一律不采信
 * - 仅当「连接的对端地址」本身可信时，才允许使用 X-Forwarded-For / X-Real-IP
 * - 代理链自右向左剥离可信节点，取第一个非可信地址作为真实客户端 IP
 * - 地址统一归一化（IPv4 去前导零、IPv4-mapped IPv6 折回 IPv4），避免同一地址多种写法绕过白名单
 */

/** 无法确定客户端 IP 时的占位值 */
export const UNKNOWN_IP = 'unknown'

/** IPv4 字节数 */
const IPV4_BYTE_LENGTH = 4
/** IPv6 字节数 */
const IPV6_BYTE_LENGTH = 16

/**
 * 解析 IPv4 四段十进制，返回 4 字节数组；非法返回 null。
 * 拒绝前导零（"01.2.3.4"），避免同一地址出现多种写法。
 */
export function parseIpv4(raw: string): number[] | null {
  const parts = raw.split('.')
  if (parts.length !== IPV4_BYTE_LENGTH) return null
  const bytes: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    if (part.length > 1 && part.startsWith('0')) return null
    const value = Number(part)
    if (!Number.isInteger(value) || value < 0 || value > 255) return null
    bytes.push(value)
  }
  return bytes
}

/**
 * 解析 IPv6（含 "::" 压缩写法与 "::ffff:1.2.3.4" 形式），返回 8 个 16 位分组；非法返回 null。
 */
export function parseIpv6(raw: string): number[] | null {
  if (!raw.includes(':')) return null

  let text = raw.trim()

  // 结尾的 IPv4 形式先折算成两个十六进制分组（::ffff:1.2.3.4 -> ::ffff:102:304）
  const lastColon = text.lastIndexOf(':')
  const lastSegment = text.slice(lastColon + 1)
  if (lastSegment.includes('.')) {
    const v4 = parseIpv4(lastSegment)
    if (!v4) return null
    const high = ((v4[0] << 8) | v4[1]).toString(16)
    const low = ((v4[2] << 8) | v4[3]).toString(16)
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`
  }

  const doubleColon = text.indexOf('::')
  if (doubleColon !== -1 && text.indexOf('::', doubleColon + 1) !== -1) return null

  const headText = doubleColon === -1 ? text : text.slice(0, doubleColon)
  const tailText = doubleColon === -1 ? '' : text.slice(doubleColon + 2)

  const parseGroups = (source: string): number[] | null => {
    if (source === '') return []
    const groups: number[] = []
    for (const item of source.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(item)) return null
      groups.push(Number.parseInt(item, 16))
    }
    return groups
  }

  const head = parseGroups(headText)
  const tail = parseGroups(tailText)
  if (!head || !tail) return null

  if (doubleColon === -1) {
    return head.length === 8 ? head : null
  }

  const missing = 8 - head.length - tail.length
  if (missing < 1) return null
  return [...head, ...new Array<number>(missing).fill(0), ...tail]
}

/** 判断 16 字节序列是否为 IPv4-mapped（::ffff:a.b.c.d） */
export function isIpv4Mapped(bytes: Uint8Array): boolean {
  if (bytes.length !== IPV6_BYTE_LENGTH) return false
  for (let index = 0; index < 10; index += 1) {
    if (bytes[index] !== 0) return false
  }
  return bytes[10] === 0xff && bytes[11] === 0xff
}

/** IPv4 字节数组 -> IPv4-mapped IPv6 字节数组 */
export function ipv4ToMappedBytes(v4: Uint8Array): Uint8Array {
  const mapped = new Uint8Array(IPV6_BYTE_LENGTH)
  mapped[10] = 0xff
  mapped[11] = 0xff
  mapped.set(v4, 12)
  return mapped
}

/** 把 8 个 16 位分组转成 16 字节 */
export function ipv6GroupsToBytes(groups: number[]): Uint8Array {
  const bytes = new Uint8Array(IPV6_BYTE_LENGTH)
  for (let index = 0; index < 8; index += 1) {
    bytes[index * 2] = (groups[index] >> 8) & 0xff
    bytes[index * 2 + 1] = groups[index] & 0xff
  }
  return bytes
}

/** 把 16 字节转回 8 个 16 位分组 */
export function ipv6BytesToGroups(bytes: Uint8Array): number[] {
  const groups: number[] = []
  for (let index = 0; index < 8; index += 1) {
    groups.push((bytes[index * 2] << 8) | bytes[index * 2 + 1])
  }
  return groups
}

/**
 * 按前缀长度对网络地址做掩码归一。
 * 例如 10.1.0.0/12 的实际网段是 10.0.0.0/12，掩码后主机位归零。
 */
export function maskNetworkBytes(bytes: Uint8Array, prefix: number): Uint8Array {
  const result = new Uint8Array(bytes)
  const fullBytes = Math.floor(prefix / 8)
  const remainingBits = prefix % 8
  for (let index = 0; index < result.length; index += 1) {
    if (index < fullBytes) continue
    if (index === fullBytes && remainingBits > 0) {
      result[index] = result[index] & ((0xff << (8 - remainingBits)) & 0xff)
      continue
    }
    result[index] = 0
  }
  return result
}

/** 把 8 个 16 位分组格式化成规范（压缩、小写）文本 */
export function formatIpv6(groups: number[]): string {
  let bestStart = -1
  let bestLength = 0
  let currentStart = -1
  let currentLength = 0
  for (let index = 0; index < groups.length; index += 1) {
    if (groups[index] === 0) {
      if (currentStart === -1) {
        currentStart = index
        currentLength = 1
      } else {
        currentLength += 1
      }
      if (currentLength > bestLength) {
        bestLength = currentLength
        bestStart = currentStart
      }
    } else {
      currentStart = -1
      currentLength = 0
    }
  }

  const hex = groups.map((group) => group.toString(16))
  if (bestLength < 2) return hex.join(':')
  const head = hex.slice(0, bestStart).join(':')
  const tail = hex.slice(bestStart + bestLength).join(':')
  return `${head}::${tail}`
}

/**
 * 归一化 IP 文本。
 * 支持 IPv4 / IPv6，去掉方括号、端口与 zone id；IPv4-mapped IPv6 折回 IPv4。
 * 非法输入返回 null。
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  let value = raw.trim()
  if (value === '') return null

  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end === -1) return null
    value = value.slice(1, end)
  } else {
    const colonCount = value.split(':').length - 1
    if (colonCount === 1) {
      const separator = value.indexOf(':')
      const port = value.slice(separator + 1)
      if (/^\d{1,5}$/.test(port)) value = value.slice(0, separator)
    }
  }

  const zoneIndex = value.indexOf('%')
  if (zoneIndex !== -1) value = value.slice(0, zoneIndex)
  value = value.trim()
  if (value === '') return null

  const v4 = parseIpv4(value)
  if (v4) return v4.join('.')

  const v6 = parseIpv6(value)
  if (!v6) return null
  const bytes = ipv6GroupsToBytes(v6)
  if (isIpv4Mapped(bytes)) {
    return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`
  }
  return formatIpv6(v6)
}

/** 归一化后的 IP -> 字节序列（IPv4 为 4 字节，IPv6 为 16 字节） */
export function ipToBytes(ip: string): Uint8Array | null {
  const v4 = parseIpv4(ip)
  if (v4) return new Uint8Array(v4)
  const v6 = parseIpv6(ip)
  if (!v6) return null
  return ipv6GroupsToBytes(v6)
}

/** 一条可信代理配置（单个 IP 或 CIDR） */
export type TrustedProxyEntry = {
  /** 配置原文，便于排错 */
  source: string
  /** 归一化后的地址 */
  address: string
  /** 地址字节序列 */
  bytes: Uint8Array
  /** 前缀长度（比特） */
  prefix: number
}

/**
 * 解析单条可信代理配置。
 * 支持 "1.2.3.4"、"10.0.0.0/8"、"2001:db8::/32"；非法返回 null。
 */
export function parseTrustedProxyEntry(raw: string): TrustedProxyEntry | null {
  const text = raw.trim()
  if (text === '') return null

  const slashIndex = text.indexOf('/')
  const addressText = slashIndex === -1 ? text : text.slice(0, slashIndex)

  const v4 = parseIpv4(addressText)
  const v6 = v4 ? null : parseIpv6(addressText)
  if (!v4 && !v6) return null

  const rawBytes = v4 ? new Uint8Array(v4) : ipv6GroupsToBytes(v6 as number[])
  let prefix = rawBytes.length * 8
  if (slashIndex !== -1) {
    const prefixText = text.slice(slashIndex + 1)
    if (!/^\d{1,3}$/.test(prefixText)) return null
    // 拒绝前导零：否则 "10.0.0.0/00" 会被当成 "/0"，把信任范围悄悄扩大到全部 IPv4
    if (prefixText.length > 1 && prefixText.startsWith('0')) return null
    prefix = Number(prefixText)
    if (prefix < 0 || prefix > rawBytes.length * 8) return null
  }

  // 网络地址按前缀掩码归一：10.1.0.0/12 的实际网段是 10.0.0.0/12
  const bytes = maskNetworkBytes(rawBytes, prefix)
  const address =
    rawBytes.length === IPV4_BYTE_LENGTH
      ? Array.from(bytes).join('.')
      : formatIpv6(ipv6BytesToGroups(bytes))

  return { source: text, address, bytes, prefix }
}

/**
 * 解析 TRUSTED_PROXIES 配置（逗号分隔）。
 * 出现非法条目直接抛错，避免"看起来配了但实际不生效"的静默失败。
 */
export function parseTrustedProxies(raw: string | null | undefined): TrustedProxyEntry[] {
  if (!raw) return []
  const entries: TrustedProxyEntry[] = []
  for (const part of raw.split(',')) {
    const text = part.trim()
    if (text === '') continue
    const entry = parseTrustedProxyEntry(text)
    if (!entry) {
      throw new Error(`TRUSTED_PROXIES 含有非法条目: ${text}（示例：1.2.3.4 / 10.0.0.0/8 / 2001:db8::/32）`)
    }
    entries.push(entry)
  }
  return entries
}

/** 前缀匹配：比较前 prefix 个比特 */
function prefixMatches(network: Uint8Array, candidate: Uint8Array, prefix: number): boolean {
  const fullBytes = Math.floor(prefix / 8)
  for (let index = 0; index < fullBytes; index += 1) {
    if (network[index] !== candidate[index]) return false
  }
  const remainingBits = prefix % 8
  if (remainingBits === 0) return true
  const mask = (0xff << (8 - remainingBits)) & 0xff
  return (network[fullBytes] & mask) === (candidate[fullBytes] & mask)
}

/** 判断 IP 是否落在可信代理条目内 */
export function isTrustedIp(ip: string, trustedProxies: readonly TrustedProxyEntry[]): boolean {
  const bytes = ipToBytes(ip)
  if (!bytes) return false
  return trustedProxies.some((entry) => {
    if (bytes.length === entry.bytes.length) {
      return prefixMatches(entry.bytes, bytes, entry.prefix)
    }
    if (entry.bytes.length === IPV6_BYTE_LENGTH && bytes.length === IPV4_BYTE_LENGTH) {
      // IPv4 客户端 vs IPv6 网段：折算成 v4-mapped 形式再比较
      return prefixMatches(entry.bytes, ipv4ToMappedBytes(bytes), entry.prefix)
    }
    if (entry.bytes.length === IPV4_BYTE_LENGTH && bytes.length === IPV6_BYTE_LENGTH) {
      // IPv6 客户端 vs IPv4 网段：仅 v4-mapped 地址可折回比较
      if (!isIpv4Mapped(bytes)) return false
      return prefixMatches(entry.bytes, bytes.slice(12), entry.prefix)
    }
    return false
  })
}

/** 客户端 IP 的来源，便于日志与排错 */
export type ClientIpSource = 'socket' | 'forwarded-for' | 'real-ip' | 'unknown'

export type ResolveClientIpInput = {
  /** 连接对端地址（Bun Server 提供） */
  remoteAddress?: string | null
  /** X-Forwarded-For 原始值 */
  forwardedFor?: string | null
  /** X-Real-IP 原始值 */
  realIp?: string | null
  /** 可信代理列表 */
  trustedProxies?: readonly TrustedProxyEntry[]
}

export type ResolvedClientIp = {
  /** 归一化后的客户端 IP；无法确定时为 unknown */
  ip: string
  /** IP 来源 */
  source: ClientIpSource
}

/** 解析 X-Forwarded-For 链：逐段归一化，丢弃非法段 */
export function parseForwardedChain(raw: string | null | undefined): string[] {
  if (!raw) return []
  const chain: string[] = []
  for (const part of raw.split(',')) {
    const normalized = normalizeIp(part)
    if (normalized) chain.push(normalized)
  }
  return chain
}

/**
 * 解析真实客户端 IP。
 *
 * 规则：
 * 1. 未配置可信代理 -> 只用连接对端地址，完全忽略转发头
 * 2. 连接对端地址不可信 -> 只用连接对端地址，完全忽略转发头
 * 3. 连接对端地址可信 -> 自右向左剥离可信代理，取第一个非可信地址；
 *    整条链都可信时取最左侧；没有 X-Forwarded-For 时回退 X-Real-IP
 */
export function resolveClientIp(input: ResolveClientIpInput): ResolvedClientIp {
  const trusted = input.trustedProxies ?? []
  const remote = normalizeIp(input.remoteAddress ?? null)

  if (trusted.length === 0) {
    return remote ? { ip: remote, source: 'socket' } : { ip: UNKNOWN_IP, source: 'unknown' }
  }

  if (!remote) {
    return { ip: UNKNOWN_IP, source: 'unknown' }
  }

  if (!isTrustedIp(remote, trusted)) {
    // 对端不可信：转发头可被任意伪造，直接忽略
    return { ip: remote, source: 'socket' }
  }

  const chain = parseForwardedChain(input.forwardedFor ?? null)
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const candidate = chain[index]
    if (!isTrustedIp(candidate, trusted)) {
      return { ip: candidate, source: 'forwarded-for' }
    }
  }
  if (chain.length > 0) {
    // 整条链都是可信代理：取最左侧（最早的客户端声明）
    return { ip: chain[0], source: 'forwarded-for' }
  }

  const realIp = normalizeIp(input.realIp ?? null)
  if (realIp) {
    return { ip: realIp, source: 'real-ip' }
  }

  return { ip: remote, source: 'socket' }
}
