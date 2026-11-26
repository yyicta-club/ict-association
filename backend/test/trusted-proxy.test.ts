/**
 * 可信代理与客户端 IP 解析单元测试（backend/src/utils/ip.ts）
 */
import { describe, expect, test } from 'bun:test'
import {
  UNKNOWN_IP,
  formatIpv6,
  ipToBytes,
  ipv4ToMappedBytes,
  ipv6GroupsToBytes,
  isIpv4Mapped,
  isTrustedIp,
  normalizeIp,
  parseForwardedChain,
  parseIpv4,
  parseIpv6,
  parseTrustedProxies,
  parseTrustedProxyEntry,
  resolveClientIp,
} from '../src/utils/ip'

/** 测试用可信代理列表：仅 10.0.0.0/8 与 127.0.0.1/32 可信 */
const TRUSTED = parseTrustedProxies('10.0.0.0/8,127.0.0.1/32')

describe('normalizeIp 归一化', () => {
  test('IPv4 原样返回', () => {
    expect(normalizeIp('1.2.3.4')).toBe('1.2.3.4')
  })

  test('IPv4 去除首尾空格', () => {
    expect(normalizeIp(' 1.2.3.4 ')).toBe('1.2.3.4')
  })

  test('IPv4 去除端口', () => {
    expect(normalizeIp('1.2.3.4:8080')).toBe('1.2.3.4')
  })

  test('IPv4 前导零被拒绝（避免同址多写法绕过白名单）', () => {
    expect(normalizeIp('01.2.3.4')).toBeNull()
  })

  test('非法 IPv4 返回 null', () => {
    expect(normalizeIp('1.2.3')).toBeNull()
    expect(normalizeIp('1.2.3.4.5')).toBeNull()
    expect(normalizeIp('256.1.1.1')).toBeNull()
    expect(normalizeIp('abc')).toBeNull()
  })

  test('IPv6 压缩为大写十六进制输入被规范化为小写压缩形式', () => {
    expect(normalizeIp('2001:0DB8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1')
  })

  test('IPv6 全零地址', () => {
    expect(normalizeIp('::')).toBe('::')
  })

  test('IPv6 环回地址', () => {
    expect(normalizeIp('0:0:0:0:0:0:0:1')).toBe('::1')
  })

  test('IPv6 带方括号与端口', () => {
    expect(normalizeIp('[::1]:8080')).toBe('::1')
  })

  test('IPv6 带方括号无端口', () => {
    expect(normalizeIp('[2001:db8::1]')).toBe('2001:db8::1')
  })

  test('IPv6 去掉 zone id', () => {
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1')
  })

  test('IPv4-mapped IPv6 折回 IPv4', () => {
    expect(normalizeIp('::ffff:1.2.3.4')).toBe('1.2.3.4')
  })

  test('空串 / null / undefined / 纯空白均返回 null', () => {
    expect(normalizeIp('')).toBeNull()
    expect(normalizeIp(null)).toBeNull()
    expect(normalizeIp(undefined)).toBeNull()
    expect(normalizeIp('   ')).toBeNull()
  })
})

describe('parseIpv4 解析', () => {
  test('合法 IPv4 返回四段字节', () => {
    expect(parseIpv4('1.2.3.4')).toEqual([1, 2, 3, 4])
    expect(parseIpv4('0.0.0.0')).toEqual([0, 0, 0, 0])
    expect(parseIpv4('255.255.255.255')).toEqual([255, 255, 255, 255])
  })

  test('前导零被拒绝', () => {
    expect(parseIpv4('01.2.3.4')).toBeNull()
    expect(parseIpv4('1.2.3.04')).toBeNull()
  })

  test('段数或取值非法返回 null', () => {
    expect(parseIpv4('1.2.3')).toBeNull()
    expect(parseIpv4('1.2.3.4.5')).toBeNull()
    expect(parseIpv4('1.2.3.')).toBeNull()
    expect(parseIpv4('256.1.1.1')).toBeNull()
    expect(parseIpv4('abc')).toBeNull()
  })

  test('不自带 trim：带空格的输入直接判非法', () => {
    expect(parseIpv4('1.2.3.4 ')).toBeNull()
  })
})

describe('parseIpv6 解析', () => {
  test('全展开的八分组', () => {
    expect(parseIpv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  test(':: 压缩写法', () => {
    expect(parseIpv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
    expect(parseIpv6('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(parseIpv6('1::')).toEqual([1, 0, 0, 0, 0, 0, 0, 0])
    expect(parseIpv6('2001:db8::1')).toEqual([0x2001, 0x0db8, 0, 0, 0, 0, 0, 1])
  })

  test('尾部 IPv4 形式被折算成两个十六进制分组', () => {
    expect(parseIpv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304])
  })

  test('分组个数不对返回 null', () => {
    expect(parseIpv6('1:2:3:4:5:6:7:8:9')).toBeNull()
    expect(parseIpv6('1:2:3:4:5:6:7')).toBeNull()
  })

  test('出现两个 :: 返回 null', () => {
    expect(parseIpv6('1::2::3')).toBeNull()
  })

  test('非十六进制字符返回 null', () => {
    expect(parseIpv6('gggg::1')).toBeNull()
  })

  test('缺少冒号或带 zone id 返回 null（zone id 只在 normalizeIp 层处理）', () => {
    expect(parseIpv6('1.2.3.4')).toBeNull()
    expect(parseIpv6('2001:db8::1%eth0')).toBeNull()
  })
})

describe('formatIpv6 格式化', () => {
  test('零压缩', () => {
    expect(formatIpv6([0, 0, 0, 0, 0, 0, 0, 0])).toBe('::')
    expect(formatIpv6([0, 0, 0, 0, 0, 0, 0, 1])).toBe('::1')
    expect(formatIpv6([1, 0, 0, 0, 0, 0, 0, 0])).toBe('1::')
    expect(formatIpv6([0x2001, 0x0db8, 0, 0, 0, 0, 0, 1])).toBe('2001:db8::1')
  })

  test('无连续零段时原样输出', () => {
    expect(formatIpv6([1, 2, 3, 4, 5, 6, 7, 8])).toBe('1:2:3:4:5:6:7:8')
  })

  test('单个零段不压缩', () => {
    expect(formatIpv6([0, 1, 2, 3, 4, 5, 6, 7])).toBe('0:1:2:3:4:5:6:7')
  })
})

describe('IPv4-mapped IPv6 字节工具', () => {
  test('isIpv4Mapped 识别 ::ffff:a.b.c.d', () => {
    expect(isIpv4Mapped(ipv4ToMappedBytes(new Uint8Array([1, 2, 3, 4])))).toBe(true)
    expect(isIpv4Mapped(ipv6GroupsToBytes([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]))).toBe(true)
  })

  test('isIpv4Mapped 对普通 IPv6 与非 16 字节序列返回 false', () => {
    expect(isIpv4Mapped(ipv6GroupsToBytes([0, 0, 0, 0, 0, 0, 0, 1]))).toBe(false)
    expect(isIpv4Mapped(new Uint8Array([1, 2, 3, 4]))).toBe(false)
  })

  test('ipv4ToMappedBytes 生成 16 字节且前 12 字节固定', () => {
    const mapped = ipv4ToMappedBytes(new Uint8Array([1, 2, 3, 4]))
    expect(mapped.length).toBe(16)
    expect(Array.from(mapped)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 1, 2, 3, 4])
  })

  test('ipv6GroupsToBytes 按大端展开为 16 字节', () => {
    const bytes = ipv6GroupsToBytes([0x2001, 0x0db8, 0, 0, 0, 0, 0, 1])
    expect(bytes.length).toBe(16)
    expect(Array.from(bytes)).toEqual([0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
  })
})

describe('ipToBytes', () => {
  test('IPv4 返回 4 字节，IPv6 返回 16 字节', () => {
    expect(Array.from(ipToBytes('1.2.3.4') as Uint8Array)).toEqual([1, 2, 3, 4])
    expect((ipToBytes('::1') as Uint8Array).length).toBe(16)
  })

  test('非法输入返回 null', () => {
    expect(ipToBytes('garbage')).toBeNull()
  })
})

describe('parseTrustedProxyEntry 单条可信代理解析', () => {
  test('IPv4 CIDR：prefix 与 address 正确', () => {
    const entry = parseTrustedProxyEntry('10.0.0.0/8')
    expect(entry).not.toBeNull()
    expect(entry?.source).toBe('10.0.0.0/8')
    expect(entry?.address).toBe('10.0.0.0')
    expect(entry?.prefix).toBe(8)
    expect(entry?.bytes.length).toBe(4)
  })

  test('不带斜杠的单个 IP：prefix 等于地址位数', () => {
    expect(parseTrustedProxyEntry('10.0.0.1')?.prefix).toBe(32)
    expect(parseTrustedProxyEntry('2001:db8::1')?.prefix).toBe(128)
    expect(parseTrustedProxyEntry('2001:db8::1')?.address).toBe('2001:db8::1')
  })

  test('IPv6 CIDR', () => {
    const entry = parseTrustedProxyEntry('2001:db8::/32')
    expect(entry?.prefix).toBe(32)
    expect(entry?.address).toBe('2001:db8::')
    expect(entry?.bytes.length).toBe(16)
  })

  test('首尾空格会被裁剪', () => {
    const entry = parseTrustedProxyEntry('  10.0.0.0/8  ')
    expect(entry?.source).toBe('10.0.0.0/8')
    expect(entry?.address).toBe('10.0.0.0')
    expect(entry?.prefix).toBe(8)
  })

  test('非法条目返回 null', () => {
    expect(parseTrustedProxyEntry('not-an-ip')).toBeNull()
    expect(parseTrustedProxyEntry('10.0.0.0/33')).toBeNull()
    expect(parseTrustedProxyEntry('10.0.0.0/abc')).toBeNull()
    expect(parseTrustedProxyEntry('/8')).toBeNull()
    expect(parseTrustedProxyEntry('10.0.0.0/8/9')).toBeNull()
    expect(parseTrustedProxyEntry('')).toBeNull()
  })

  test('前缀拒绝前导零：10.0.0.0/00 不得被当成 /0 而信任全部 IPv4', () => {
    expect(parseTrustedProxyEntry('10.0.0.0/00')).toBeNull()
    expect(parseTrustedProxyEntry('10.0.0.0/000')).toBeNull()
    expect(parseTrustedProxyEntry('10.0.0.0/01')).toBeNull()
    // 单独的 0 是合法的（表示信任全部），但必须显式书写
    expect(parseTrustedProxyEntry('0.0.0.0/0')?.prefix).toBe(0)
  })

  test('网络地址按前缀掩码归一：10.1.0.0/12 的实际网段是 10.0.0.0/12', () => {
    const entry = parseTrustedProxyEntry('10.1.0.0/12')
    expect(entry?.address).toBe('10.0.0.0')
    expect(entry?.prefix).toBe(12)
    expect(isTrustedIp('10.0.0.5', [entry!])).toBe(true)
    expect(isTrustedIp('10.16.0.5', [entry!])).toBe(false)
  })
})

describe('parseTrustedProxies 列表解析', () => {
  test('逗号分隔，忽略空段', () => {
    const entries = parseTrustedProxies('10.0.0.0/8, 192.168.1.1 ,,2001:db8::/32')
    expect(entries.length).toBe(3)
    expect(entries.map((entry) => entry.address)).toEqual(['10.0.0.0', '192.168.1.1', '2001:db8::'])
    expect(entries.map((entry) => entry.prefix)).toEqual([8, 32, 32])
  })

  test('空配置返回空数组', () => {
    expect(parseTrustedProxies('')).toEqual([])
    expect(parseTrustedProxies(null)).toEqual([])
    expect(parseTrustedProxies(undefined)).toEqual([])
    expect(parseTrustedProxies('   ')).toEqual([])
  })

  test('出现非法条目时抛异常（避免"配了但没生效"的静默失败）', () => {
    expect(() => parseTrustedProxies('10.0.0.0/8,bad-entry')).toThrow()
    expect(() => parseTrustedProxies('10.0.0.0/8,bad-entry')).toThrow(/非法条目/)
  })
})

describe('isTrustedIp CIDR 匹配', () => {
  test('IPv4 网段命中与不命中', () => {
    expect(isTrustedIp('10.1.2.3', parseTrustedProxies('10.0.0.0/8'))).toBe(true)
    expect(isTrustedIp('11.1.2.3', parseTrustedProxies('10.0.0.0/8'))).toBe(false)
  })

  test('IPv6 网段命中与不命中', () => {
    expect(isTrustedIp('2001:db8::1', parseTrustedProxies('2001:db8::/32'))).toBe(true)
    expect(isTrustedIp('2001:db9::1', parseTrustedProxies('2001:db8::/32'))).toBe(false)
  })

  test('精确 IP 只命中自身', () => {
    expect(isTrustedIp('192.168.1.1', parseTrustedProxies('192.168.1.1'))).toBe(true)
    expect(isTrustedIp('192.168.1.2', parseTrustedProxies('192.168.1.1'))).toBe(false)
  })

  test('IPv4 客户端与 IPv6 网段：折算成 v4-mapped 后比较', () => {
    const entries = parseTrustedProxies('::ffff:10.0.0.0/104')
    expect(isTrustedIp('10.1.2.3', entries)).toBe(true)
    expect(isTrustedIp('11.1.2.3', entries)).toBe(false)
  })

  test('IPv6 客户端与 IPv4 网段：仅 v4-mapped 地址可折回比较', () => {
    const entries = parseTrustedProxies('10.0.0.0/8')
    expect(isTrustedIp('::ffff:10.1.2.3', entries)).toBe(true)
    expect(isTrustedIp('2001:db8::1', entries)).toBe(false)
  })

  test('非法 IP 与空白名单均返回 false', () => {
    expect(isTrustedIp('not-an-ip', TRUSTED)).toBe(false)
    expect(isTrustedIp('10.1.2.3', [])).toBe(false)
  })
})

describe('parseForwardedChain 转发链解析', () => {
  test('合法段被归一化保留，非法段被丢弃', () => {
    expect(parseForwardedChain('1.2.3.4, garbage, ::ffff:5.6.7.8')).toEqual(['1.2.3.4', '5.6.7.8'])
  })

  test('空输入返回空数组', () => {
    expect(parseForwardedChain('')).toEqual([])
    expect(parseForwardedChain(null)).toEqual([])
    expect(parseForwardedChain(undefined)).toEqual([])
    expect(parseForwardedChain('   ')).toEqual([])
  })
})

describe('resolveClientIp 客户端 IP 解析', () => {
  test('默认不信任任何代理：伪造的转发头被忽略', () => {
    const result = resolveClientIp({
      remoteAddress: '203.0.113.5',
      forwardedFor: '1.2.3.4',
      trustedProxies: [],
    })
    expect(result.ip).toBe('203.0.113.5')
    expect(result.source).toBe('socket')
  })

  test('可信列表为空且没有 remoteAddress：返回 unknown', () => {
    const result = resolveClientIp({ forwardedFor: '1.2.3.4', trustedProxies: [] })
    expect(result.ip).toBe('unknown')
    expect(result.ip).toBe(UNKNOWN_IP)
    expect(result.source).toBe('unknown')
  })

  test('对端不可信时忽略转发头与 X-Real-IP', () => {
    const result = resolveClientIp({
      remoteAddress: '203.0.113.5',
      forwardedFor: '1.2.3.4',
      realIp: '5.6.7.8',
      trustedProxies: TRUSTED,
    })
    expect(result.ip).toBe('203.0.113.5')
    expect(result.source).toBe('socket')
  })

  test('对端可信时采信 X-Forwarded-For', () => {
    const result = resolveClientIp({
      remoteAddress: '10.0.0.1',
      forwardedFor: '203.0.113.9',
      trustedProxies: TRUSTED,
    })
    expect(result.ip).toBe('203.0.113.9')
    expect(result.source).toBe('forwarded-for')
  })

  test('多级可信代理链：自右向左剥离可信节点', () => {
    const result = resolveClientIp({
      remoteAddress: '10.0.0.2',
      forwardedFor: '203.0.113.9, 10.0.0.1',
      trustedProxies: TRUSTED,
    })
    expect(result.ip).toBe('203.0.113.9')
    expect(result.source).toBe('forwarded-for')
  })

  test('伪造的转发头不能绕过：最右侧非可信地址胜出', () => {
    const result = resolveClientIp({
      remoteAddress: '10.0.0.1',
      forwardedFor: '1.2.3.4, 203.0.113.77',
      trustedProxies: TRUSTED,
    })
    expect(result.ip).toBe('203.0.113.77')
    expect(result.source).toBe('forwarded-for')
  })

  test('整条链都可信：取最左侧地址', () => {
    const result = resolveClientIp({
      remoteAddress: '10.0.0.2',
      forwardedFor: '10.0.0.1',
      trustedProxies: TRUSTED,
    })
    expect(result.ip).toBe('10.0.0.1')
    expect(result.source).toBe('forwarded-for')
  })

  test('没有 X-Forwarded-For 时回退 X-Real-IP', () => {
    const result = resolveClientIp({
      remoteAddress: '10.0.0.1',
      realIp: '203.0.113.4',
      trustedProxies: TRUSTED,
    })
    expect(result.ip).toBe('203.0.113.4')
    expect(result.source).toBe('real-ip')
  })

  test('对端可信但没有任何转发头：回退到 remoteAddress', () => {
    const result = resolveClientIp({ remoteAddress: '10.0.0.1', trustedProxies: TRUSTED })
    expect(result.ip).toBe('10.0.0.1')
    expect(result.source).toBe('socket')
  })

  test('可信列表非空但缺少 remoteAddress：返回 unknown', () => {
    const result = resolveClientIp({ forwardedFor: '1.2.3.4', trustedProxies: TRUSTED })
    expect(result.ip).toBe(UNKNOWN_IP)
    expect(result.source).toBe('unknown')
  })

  test('127.0.0.1 作为可信代理同样可以采信转发头', () => {
    const result = resolveClientIp({
      remoteAddress: '127.0.0.1',
      forwardedFor: '203.0.113.11',
      trustedProxies: TRUSTED,
    })
    expect(result.ip).toBe('203.0.113.11')
    expect(result.source).toBe('forwarded-for')
  })
})
