import { afterEach, describe, expect, it, vi } from 'vitest'
import { dashboardApi } from './dashboard-api'

// 「管理模型」弹窗会同时拉 content / models / managed-providers：接管记录
// 的配置文件可能在 SSH 远端，每次调用都要现连一次（隧道 + 认证），三个并发
// 里最慢的那个轻松超过默认的 8s —— 之前就被砍成 AbortError，界面报
// 「无法连接后端：signal is aborted without reason」。这里锁定两件事：
// 接管记录的调用拿到更宽的超时，且超时要说成「请求超时（N 秒）」而不是
// 让人以为后端挂了。
function stubFetchThatAbortsOnSignal() {
  const signals: AbortSignal[] = []
  vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
    const signal = init?.signal as AbortSignal | undefined
    if (signal) signals.push(signal)
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        // 浏览器的 AbortError：文案就是这一句。
        const error = new Error('signal is aborted without reason')
        error.name = 'AbortError'
        reject(error)
      })
    })
  }))
  return signals
}

describe('dashboard request timeouts', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('lets 接管Agent reads outlive the default 8s while other calls still abort at 8s', async () => {
    const signals = stubFetchThatAbortsOnSignal()
    vi.useFakeTimers()

    void dashboardApi.getAgentConfigFileModels('record-1').catch(() => {})
    void dashboardApi.getUpdateStatus().catch(() => {})
    expect(signals).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(9000)
    expect(signals[0].aborted).toBe(false)
    expect(signals[1].aborted).toBe(true)
  })

  it('reports our own timeout as 请求超时（N 秒）instead of the raw AbortError', async () => {
    stubFetchThatAbortsOnSignal()
    vi.useFakeTimers()

    const pending = dashboardApi.getUpdateStatus()
    const assertion = expect(pending).rejects.toThrow(/请求超时|Request timed out/)
    await vi.advanceTimersByTimeAsync(9000)
    await assertion
    await expect(pending).rejects.not.toThrow(/signal is aborted/)
  })

  // 一轮对话是自由循环：后端跑到模型不再调工具为止，只受 30 分钟墙钟约束，
  // 默认 8s 会在中途掐断，而中断的请求连服务端 context 一起取消，多步写操作
  // 会半途而废（建供应商就踩到过）。这里锁定发送消息拿到更宽的超时。
  it('lets a chat turn outlive the default 8s', async () => {
    const signals = stubFetchThatAbortsOnSignal()
    vi.useFakeTimers()

    void dashboardApi
      .sendChatMessage('thread-1', { content: 'hi', model: 'm', providerId: '' })
      .catch(() => {})
    expect(signals).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(9000)
    expect(signals[0].aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(1980000)
    expect(signals[0].aborted).toBe(true)
  })
})
