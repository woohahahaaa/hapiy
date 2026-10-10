import { describe, expect, it } from 'vitest'
import { formatSshAddress, parseSshAddress } from './ssh-address'

// 回归：SSH 主机框从隧道工具整条粘贴（tcp://host:port）时，旧的实现把整串
// 当主机（再拼端口）交给后端，得到 "too many colons in address"。这里锁死
// 前缀/内嵌端口/IPv6 的解析与回显。
describe('parseSshAddress', () => {
  it('keeps a plain host and defaults to port 22', () => {
    expect(parseSshAddress('192.168.1.100')).toEqual({ host: '192.168.1.100', port: 22 })
  })

  it('strips the scheme and honors the embedded port', () => {
    expect(parseSshAddress('tcp://998pkkg09745.vicp.fun:34604')).toEqual({
      host: '998pkkg09745.vicp.fun',
      port: 34604,
    })
  })

  it('accepts an ssh url with user, host and port', () => {
    expect(parseSshAddress('ssh://wooh@192.168.31.200:2222')).toEqual({ host: '192.168.31.200', port: 2222 })
  })

  it('uses the embedded port over the default', () => {
    expect(parseSshAddress('gateway.example.com:2200')).toEqual({ host: 'gateway.example.com', port: 2200 })
  })

  it('tolerates a trailing slash', () => {
    expect(parseSshAddress('tcp://host.example/')).toEqual({ host: 'host.example', port: 22 })
  })

  it('parses bracketed ipv6 with and without a port', () => {
    expect(parseSshAddress('[2001:db8::1]:2200')).toEqual({ host: '2001:db8::1', port: 2200 })
    expect(parseSshAddress('[2001:db8::1]')).toEqual({ host: '2001:db8::1', port: 22 })
  })

  it('treats a bare ipv6 address as the host', () => {
    expect(parseSshAddress('2001:db8::1')).toEqual({ host: '2001:db8::1', port: 22 })
  })

  it('rejects invalid ports and empty hosts', () => {
    expect(parseSshAddress('host.example:0')).toBeNull()
    expect(parseSshAddress('host.example:99999')).toBeNull()
    expect(parseSshAddress('host.example:abc')).toBeNull()
    expect(parseSshAddress('')).toBeNull()
    expect(parseSshAddress('tcp://')).toBeNull()
  })
})

describe('formatSshAddress', () => {
  it('hides the default port and shows non-default ones', () => {
    expect(formatSshAddress('host.example', 22)).toBe('host.example')
    expect(formatSshAddress('host.example', 34604)).toBe('host.example:34604')
  })

  it('brackets ipv6 hosts when a port is shown', () => {
    expect(formatSshAddress('2001:db8::1', 22)).toBe('2001:db8::1')
    expect(formatSshAddress('2001:db8::1', 2222)).toBe('[2001:db8::1]:2222')
  })
})
