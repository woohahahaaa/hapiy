// SSH 地址解析：主机输入框兼容从隧道 / 中转 / SSH URL 整条粘贴的地址。
// 支持 tcp:// / ssh:// / sftp:// 前缀、user@、IPv6（可带括号）；
// 地址里内嵌端口时以内嵌端口为准，未写端口按 22。端口非法（非数字、越界）
// 或主机为空时返回 null，由调用方给出校验提示。

export type SshAddress = {
  readonly host: string
  readonly port: number
}

export function parseSshAddress(raw: string): SshAddress | null {
  let rest = raw.trim().replace(/^(?:tcp|ssh|sftp):\/\//i, '')
  rest = rest.replace(/\/+$/, '')
  const at = rest.lastIndexOf('@')
  if (at >= 0) rest = rest.slice(at + 1)
  if (rest === '') return null

  // 带方括号的 IPv6：[addr] 或 [addr]:port
  if (rest.startsWith('[')) {
    const end = rest.indexOf(']')
    if (end < 0) return null
    const host = rest.slice(1, end)
    if (host === '') return null
    const tail = rest.slice(end + 1)
    if (tail === '') return { host, port: 22 }
    const match = /^:(\d+)$/.exec(tail)
    if (!match) return null
    const port = Number(match[1])
    return port >= 1 && port <= 65535 ? { host, port } : null
  }

  const colon = rest.indexOf(':')
  if (colon < 0) return { host: rest, port: 22 }
  // 多个冒号：裸 IPv6，整体当主机
  if (rest.indexOf(':', colon + 1) >= 0) return { host: rest, port: 22 }
  const host = rest.slice(0, colon)
  const portText = rest.slice(colon + 1)
  if (host === '' || !/^\d+$/.test(portText)) return null
  const port = Number(portText)
  return port >= 1 && port <= 65535 ? { host, port } : null
}

// 回显用：非默认端口拼回主机后面，IPv6 补方括号；默认 22 只显示主机。
export function formatSshAddress(host: string, port: number | undefined): string {
  if (!host) return ''
  if (!port || port === 22) return host
  const needsBrackets = host.includes(':') && !host.startsWith('[')
  return `${needsBrackets ? `[${host}]` : host}:${port}`
}
