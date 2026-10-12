import { afterEach, describe, expect, it, vi } from 'vitest'
import { dashboardApi } from './dashboard-api'

// 「管理模型」弹窗会同时拉 content / models / managed-providers：接管记录
// 的配置文件可能在 SSH 远端，每次调用都要现连一次（隧道 + 认证），三个并发
// 里最慢的那个轻松超过默认的 8s —— 之前就被砍成 AbortError，界面报
// 「无法连接后端：signal is aborted without reason」。这里锁定接管记录的
// 调用拿到更宽的超时，其余 dashboard 调用仍然按 8s 收口。
describe('dashboard request timeouts', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('lets 接管Agent reads outlive the default 8s while other calls still abort at 8s', async () => {
    const signals: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal as AbortSignal)
      // 永不 settle：只观察超时定时器有没有 abort。
      return new Promise<Response>(() => {})
    }))
    vi.useFakeTimers()

    void dashboardApi.getAgentConfigFileModels('record-1')
    void dashboardApi.getUpdateStatus()
    expect(signals).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(9000)
    expect(signals[0].aborted).toBe(false)
    expect(signals[1].aborted).toBe(true)
  })
})
